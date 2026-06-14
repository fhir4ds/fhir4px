import { describe, expect, it } from "vitest";
import { isPublicDirectoryUrl, shouldBypassServiceWorkerCache } from "../../src/lib/pwa/cache-policy";

describe("PWA cache policy", () => {
  it("bypasses cache for FHIR and OAuth URLs", () => {
    expect(shouldBypassServiceWorkerCache("https://ehr.example.test/fhir/Patient/123")).toBe(true);
    expect(shouldBypassServiceWorkerCache("https://ehr.example.test/fhir/Observation?patient=123")).toBe(true);
    expect(shouldBypassServiceWorkerCache("https://ehr.example.test/oauth2/token")).toBe(true);
    expect(shouldBypassServiceWorkerCache("http://localhost/smart/callback?code=abc&state=xyz")).toBe(true);
    expect(shouldBypassServiceWorkerCache("https://ehr.example.test/fhir/.well-known/smart-configuration")).toBe(
      true
    );
  });

  it("allows only public directory paths as public cache candidates", () => {
    expect(isPublicDirectoryUrl(new URL("/directory-public/providers.json", window.location.origin))).toBe(true);
    expect(isPublicDirectoryUrl(new URL("/Patient/123", window.location.origin))).toBe(false);
  });
});
