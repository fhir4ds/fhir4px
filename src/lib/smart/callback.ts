import { clearTransientState, loadTransientState, removeSmartCallbackParams } from "./transient-state";
import type { SmartCallbackResult, SmartToken } from "./types";
import { SmartAuthError } from "./types";
import { fetchWithContext } from "./fetch-errors";

export interface HandleSmartCallbackOptions {
  url?: string;
  storage?: Storage;
  fetcher?: typeof fetch;
  now?: number;
  onToken?: (result: SmartCallbackResult) => Promise<void> | void;
  cleanUrl?: boolean;
}

let inFlightCallback: { key: string; promise: Promise<SmartCallbackResult> } | null = null;

export function isSmartCallback(url = window.location.href): boolean {
  const parsed = new URL(url);
  return parsed.searchParams.has("code") && parsed.searchParams.has("state");
}

function callbackKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.searchParams.get("code") || ""}:${parsed.searchParams.get("state") || ""}`;
}

function sanitizeOAuthError(responseText: string): string {
  if (!responseText) return "";

  try {
    const parsed = JSON.parse(responseText) as { error?: unknown; error_description?: unknown };
    const error = typeof parsed.error === "string" ? parsed.error : "";
    const description = typeof parsed.error_description === "string" ? parsed.error_description : "";
    return [error, description]
      .filter(Boolean)
      .join(": ")
      .replace(/[A-Za-z0-9_-]{48,}/g, "[redacted]")
      .slice(0, 300);
  } catch {
    return "non-JSON error response";
  }
}

export function handleSmartCallback(options: HandleSmartCallbackOptions = {}): Promise<SmartCallbackResult> {
  const url = options.url ?? window.location.href;
  const key = callbackKey(url);

  if (inFlightCallback?.key === key) return inFlightCallback.promise;

  const promise = Promise.resolve().then(() => performSmartCallback({ ...options, url }));
  inFlightCallback = { key, promise };
  return promise;
}

async function performSmartCallback({
  url = window.location.href,
  storage,
  fetcher = fetch,
  now = Date.now(),
  onToken,
  cleanUrl = true
}: HandleSmartCallbackOptions): Promise<SmartCallbackResult> {
  const parsedUrl = new URL(url);
  const code = parsedUrl.searchParams.get("code");
  const returnedState = parsedUrl.searchParams.get("state");

  if (!code || !returnedState) {
    throw new SmartAuthError("SMART callback is missing code or state");
  }

  const transientState = loadTransientState(storage, now);
  if (!transientState) {
    throw new SmartAuthError("SMART authorization state expired or was not found");
  }

  if (transientState.state !== returnedState) {
    clearTransientState(storage);
    throw new SmartAuthError("SMART state mismatch");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: transientState.redirectUri,
    client_id: transientState.clientId,
    code_verifier: transientState.codeVerifier
  });

  const response = await fetchWithContext(
    fetcher,
    transientState.tokenEndpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      cache: "no-store"
    },
    "SMART token exchange"
  );

  if (!response.ok) {
    const detail = sanitizeOAuthError(await response.text().catch(() => ""));
    clearTransientState(storage);
    throw new SmartAuthError(
      `SMART token exchange failed (${response.status})${detail ? `: ${detail}` : ""}`
    );
  }

  const tokenResponse = await response.json();
  const token: SmartToken = {
    accessToken: tokenResponse.access_token,
    idToken: tokenResponse.id_token,
    tokenType: tokenResponse.token_type || "Bearer",
    expiresAt: now + (tokenResponse.expires_in || 3600) * 1000,
    patientId: tokenResponse.patient || null,
    scope: tokenResponse.scope || transientState.requestedScopes || ""
  };

  const result: SmartCallbackResult = {
    token,
    session: {
      fhirBaseUrl: transientState.fhirBaseUrl,
      vendor: transientState.vendor,
      clientId: transientState.clientId,
      requestedScopes: transientState.requestedScopes,
      providerId: transientState.providerId,
      providerName: transientState.providerName
    },
    popupLaunch: Boolean(transientState.popupLaunch)
  };

  await onToken?.(result);
  clearTransientState(storage);

  if (cleanUrl && typeof window !== "undefined") {
    window.history.replaceState({}, "", removeSmartCallbackParams(new URL(window.location.href)));
  }

  return result;
}
