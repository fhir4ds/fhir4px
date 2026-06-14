import { sha256Base64Url, randomBase64Url } from "./crypto";
import { discoverEndpoints } from "./discovery";
import { REFERRAL_SUMMARY_SCOPES } from "./scopes";
import { markPopupAuthPending, saveTransientState } from "./transient-state";
import type { SmartProvider } from "./types";
import { SmartAuthError } from "./types";

const AUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface BuildAuthorizeUrlOptions {
  provider: SmartProvider;
  redirectUri: string;
  scopes?: string;
  storage?: Storage;
  now?: number;
  fetcher?: typeof fetch;
  popupLaunch?: boolean;
}

export async function buildAuthorizeUrl({
  provider,
  redirectUri,
  scopes,
  storage,
  now = Date.now(),
  fetcher = fetch,
  popupLaunch = false
}: BuildAuthorizeUrlOptions): Promise<string> {
  if (!provider.clientId) {
    throw new SmartAuthError(`Missing client ID for ${provider.name}`);
  }

  const fhirBaseUrl = provider.fhirBaseUrl.replace(/\/$/, "");
  const endpoints = await discoverEndpoints(fhirBaseUrl, fetcher);
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const state = randomBase64Url(32);
  const requestedScopes = scopes || provider.scopes || REFERRAL_SUMMARY_SCOPES;

  saveTransientState(
    {
      codeVerifier,
      state,
      fhirBaseUrl,
      vendor: provider.vendor,
      clientId: provider.clientId,
      providerId: provider.id,
      providerName: provider.name,
      tokenEndpoint: endpoints.tokenEndpoint,
      redirectUri,
      requestedScopes,
      expiresAt: now + AUTH_STATE_TTL_MS,
      popupLaunch
    },
    storage
  );
  if (popupLaunch) markPopupAuthPending(storage);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    scope: requestedScopes,
    state,
    aud: fhirBaseUrl,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });

  const authorizationEndpoint = provider.customAuthorizeEndpoint || endpoints.authorizationEndpoint;
  return `${authorizationEndpoint}?${params.toString()}`;
}
