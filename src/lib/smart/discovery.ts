import type { SmartEndpoints } from "./types";
import { SmartAuthError } from "./types";
import { fetchWithContext } from "./fetch-errors";

interface SmartConfiguration {
  authorization_endpoint?: string;
  token_endpoint?: string;
}

export async function discoverEndpoints(fhirBaseUrl: string, fetcher: typeof fetch = fetch): Promise<SmartEndpoints> {
  const base = fhirBaseUrl.replace(/\/$/, "");

  try {
    const response = await fetchWithContext(
      fetcher,
      `${base}/.well-known/smart-configuration`,
      {
        headers: { Accept: "application/json" },
        cache: "no-store"
      },
      "SMART discovery"
    );
    if (response.ok) {
      const config = (await response.json()) as SmartConfiguration;
      if (config.authorization_endpoint && config.token_endpoint) {
        return {
          authorizationEndpoint: config.authorization_endpoint,
          tokenEndpoint: config.token_endpoint
        };
      }
    }
  } catch {
    // CapabilityStatement fallback below.
  }

  const metadataResponse = await fetchWithContext(
    fetcher,
    `${base}/metadata`,
    {
      headers: { Accept: "application/fhir+json" },
      cache: "no-store"
    },
    "FHIR metadata discovery"
  );

  if (!metadataResponse.ok) {
    throw new SmartAuthError(`FHIR server did not expose SMART discovery metadata (${metadataResponse.status})`);
  }

  const metadata = await metadataResponse.json();
  const security = metadata?.rest?.[0]?.security;
  const oauthExtension = security?.extension?.find(
    (extension: { url?: string }) =>
      extension.url === "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris"
  );

  const authorizationEndpoint = oauthExtension?.extension?.find(
    (extension: { url?: string }) => extension.url === "authorize"
  )?.valueUri;
  const tokenEndpoint = oauthExtension?.extension?.find(
    (extension: { url?: string }) => extension.url === "token"
  )?.valueUri;

  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new SmartAuthError("FHIR server metadata did not include complete SMART OAuth endpoints");
  }

  return { authorizationEndpoint, tokenEndpoint };
}
