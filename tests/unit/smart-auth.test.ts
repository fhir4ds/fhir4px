import { describe, expect, it, vi } from "vitest";
import { handleSmartCallback } from "../../src/lib/smart/callback";
import { buildAuthorizeUrl } from "../../src/lib/smart/oauth";
import { EPIC_SANDBOX_SCOPES } from "../../src/lib/smart/scopes";
import type { SmartProvider } from "../../src/lib/smart/types";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("SMART browser auth", () => {
  const provider: SmartProvider = {
    id: "test",
    name: "Test FHIR",
    vendor: "unknown",
    fhirBaseUrl: "https://ehr.example.test/fhir",
    clientId: "public-client",
    scopes: "launch/patient openid fhirUser patient/Patient.read"
  };

  it("keeps Epic sandbox launch scopes aligned with the fhir4ds demo", () => {
    expect(EPIC_SANDBOX_SCOPES).toContain("openid fhirUser");
    expect(EPIC_SANDBOX_SCOPES).not.toContain("launch/patient");
    expect(EPIC_SANDBOX_SCOPES).toContain("patient/Patient.read");
  });

  it("builds a PKCE authorize URL and stores only transient auth state", async () => {
    const storage = window.localStorage;
    storage.clear();
    const fetcher = vi.fn(async () =>
      jsonResponse({
        authorization_endpoint: "https://ehr.example.test/authorize",
        token_endpoint: "https://ehr.example.test/token"
      })
    ) as unknown as typeof fetch;

    const url = await buildAuthorizeUrl({
      provider,
      redirectUri: "http://localhost:3000",
      storage,
      fetcher,
      now: 1_000
    });

    expect(url).toContain("https://ehr.example.test/authorize?");
    expect(url).toContain("code_challenge_method=S256");
    expect(new URL(url).searchParams.get("redirect_uri")).toBe("http://localhost:3000");
    expect(new URL(url).searchParams.get("aud")).toBe("https://ehr.example.test/fhir");
    expect(storage.getItem("fhir4px_smart_state")).toContain("codeVerifier");
    expect(Array.from({ length: storage.length }, (_, index) => storage.key(index))).not.toContain(
      "fhir4px_smart_token"
    );
  });

  it("exchanges a callback code without writing token material to localStorage", async () => {
    const storage = window.localStorage;
    storage.clear();
    const discoveryFetch = vi.fn(async () =>
      jsonResponse({
        authorization_endpoint: "https://ehr.example.test/authorize",
        token_endpoint: "https://ehr.example.test/token"
      })
    ) as unknown as typeof fetch;

    const authorizeUrl = await buildAuthorizeUrl({
      provider,
      redirectUri: "http://localhost:3000",
      storage,
      fetcher: discoveryFetch,
      now: 10_000
    });
    const state = new URL(authorizeUrl).searchParams.get("state");
    const tokenFetch = vi.fn(async () =>
      jsonResponse({
        access_token: "access-token-secret",
        refresh_token: "refresh-token-secret",
        token_type: "Bearer",
        expires_in: 3600,
        patient: "patient-123",
        scope: provider.scopes
      })
    ) as unknown as typeof fetch;

    const persisted = vi.fn();
    const result = await handleSmartCallback({
      url: `http://localhost:3000?code=abc&state=${state}`,
      storage,
      fetcher: tokenFetch,
      now: 10_500,
      cleanUrl: false,
      onToken: persisted
    });

    expect(result.token.accessToken).toBe("access-token-secret");
    expect(result.token.refreshToken).toBeUndefined();
    expect(persisted).toHaveBeenCalledOnce();
    expect(storage.getItem("fhir4px_smart_state")).toBeNull();
    expect(JSON.stringify({ ...storage })).not.toContain("access-token-secret");
    expect(JSON.stringify({ ...storage })).not.toContain("refresh-token-secret");
  });

  it("marks popup launches and returns a popup callback result without storing token material in localStorage", async () => {
    const storage = window.localStorage;
    storage.clear();
    const discoveryFetch = vi.fn(async () =>
      jsonResponse({
        authorization_endpoint: "https://ehr.example.test/authorize",
        token_endpoint: "https://ehr.example.test/token"
      })
    ) as unknown as typeof fetch;

    const authorizeUrl = await buildAuthorizeUrl({
      provider,
      redirectUri: "http://localhost:3000",
      storage,
      fetcher: discoveryFetch,
      now: 12_000,
      popupLaunch: true
    });
    const state = new URL(authorizeUrl).searchParams.get("state");
    expect(storage.getItem("fhir4px_smart_popup_pending")).toBe("1");
    expect(storage.getItem("fhir4px_smart_state")).toContain('"popupLaunch":true');

    const tokenFetch = vi.fn(async () =>
      jsonResponse({
        access_token: "popup-token-secret",
        token_type: "Bearer",
        expires_in: 3600,
        patient: "patient-456",
        scope: provider.scopes
      })
    ) as unknown as typeof fetch;

    const result = await handleSmartCallback({
      url: `http://localhost:3000?code=popup-code&state=${state}`,
      storage,
      fetcher: tokenFetch,
      now: 12_500,
      cleanUrl: false
    });

    expect(result.popupLaunch).toBe(true);
    expect(storage.getItem("fhir4px_smart_popup_pending")).toBeNull();
    expect(JSON.stringify({ ...storage })).not.toContain("popup-token-secret");
    expect(JSON.stringify({ ...storage })).not.toContain("patient-456");
  });

  it("deduplicates concurrent callback handling for a single authorization code", async () => {
    const storage = window.localStorage;
    storage.clear();
    const discoveryFetch = vi.fn(async () =>
      jsonResponse({
        authorization_endpoint: "https://ehr.example.test/authorize",
        token_endpoint: "https://ehr.example.test/token"
      })
    ) as unknown as typeof fetch;

    const authorizeUrl = await buildAuthorizeUrl({
      provider,
      redirectUri: "http://localhost:3000",
      storage,
      fetcher: discoveryFetch,
      now: 15_000
    });
    const state = new URL(authorizeUrl).searchParams.get("state");
    const tokenFetch = vi.fn(async () =>
      jsonResponse({
        access_token: "single-use-token",
        token_type: "Bearer",
        expires_in: 3600,
        patient: "patient-123",
        scope: provider.scopes
      })
    ) as unknown as typeof fetch;

    const url = `http://localhost:3000?code=single-use-code&state=${state}`;
    const [first, second] = await Promise.all([
      handleSmartCallback({ url, storage, fetcher: tokenFetch, now: 15_500, cleanUrl: false }),
      handleSmartCallback({ url, storage, fetcher: tokenFetch, now: 15_500, cleanUrl: false })
    ]);

    expect(first.token.accessToken).toBe("single-use-token");
    expect(second.token.accessToken).toBe("single-use-token");
    expect(tokenFetch).toHaveBeenCalledOnce();
  });

  it("surfaces sanitized token endpoint errors", async () => {
    const storage = window.localStorage;
    storage.clear();
    const discoveryFetch = vi.fn(async () =>
      jsonResponse({
        authorization_endpoint: "https://ehr.example.test/authorize",
        token_endpoint: "https://ehr.example.test/token"
      })
    ) as unknown as typeof fetch;

    const authorizeUrl = await buildAuthorizeUrl({
      provider,
      redirectUri: "http://localhost:3000",
      storage,
      fetcher: discoveryFetch,
      now: 20_000
    });
    const state = new URL(authorizeUrl).searchParams.get("state");
    const tokenFetch = vi.fn(async () =>
      jsonResponse(
        {
          error: "invalid_grant",
          error_description:
            "authorization code was already used abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
        },
        { status: 400 }
      )
    ) as unknown as typeof fetch;

    await expect(
      handleSmartCallback({
        url: `http://localhost:3000?code=abc&state=${state}`,
        storage,
        fetcher: tokenFetch,
        now: 20_500,
        cleanUrl: false
      })
    ).rejects.toThrow("SMART token exchange failed (400): invalid_grant: authorization code was already used [redacted]");
  });

  it("adds token endpoint host context to browser network fetch failures", async () => {
    const storage = window.localStorage;
    storage.clear();
    const discoveryFetch = vi.fn(async () =>
      jsonResponse({
        authorization_endpoint: "https://ehr.example.test/authorize",
        token_endpoint: "https://ehr.example.test/token"
      })
    ) as unknown as typeof fetch;

    const authorizeUrl = await buildAuthorizeUrl({
      provider,
      redirectUri: "http://localhost:3000",
      storage,
      fetcher: discoveryFetch,
      now: 30_000
    });
    const state = new URL(authorizeUrl).searchParams.get("state");
    const tokenFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;

    await expect(
      handleSmartCallback({
        url: `http://localhost:3000?code=abc&state=${state}`,
        storage,
        fetcher: tokenFetch,
        now: 30_500,
        cleanUrl: false
      })
    ).rejects.toThrow(
      'SMART token exchange failed before an HTTP response from ehr.example.test. Browser reported "Failed to fetch".'
    );
  });
});
