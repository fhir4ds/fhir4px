import { describe, expect, it, vi } from "vitest";
import { resolveDirectoryOrigin, searchProviders } from "../../src/lib/directory/client";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" }
  });
}

describe("directory search", () => {
  it("searches the public directory artifact by specialty and endpoint brand", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse([
        {
          npi: "1234567890",
          displayName: "JANE SMITH",
          providerType: "individual",
          specialty: "Cardiology",
          specialtyTerms: "cardiology,cardiovascular disease",
          zip5: "60611",
          state: "IL",
          practiceOrganizationNames: "Lakeview Cardiology Group",
          lat: 41.89,
          lon: -87.62,
          endpointOptions: [
            {
              accessBrand: "Northwestern Medicine",
              fhirBaseUrl: "https://epic.example.test/FHIR/R4",
              confidence: 0.7179,
              matchMethod: "practice_location_endpoint",
              evidence: "Synthetic test record",
              rawAccessBrand: "Northwestern Memorial HealthCare",
              patientDisplayPolicy: "top_recommendation",
              recommendationTier: "recommended_confirm",
              recommendationScore: 0.7179,
              empiricalPrecisionAt1: 0.7179,
              empiricalRecallAt3: 0.7308,
              evidencePathClass: "practice_location_endpoint"
            }
          ]
        }
      ])
    ) as unknown as typeof fetch;

    const results = await searchProviders("cardiology northwestern", {
      includeSandbox: false,
      fetcher
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: "JANE SMITH",
      specialty: "Cardiology",
      accessBrand: "Northwestern Medicine",
      endpointStatus: "candidate",
      recommendationTier: "recommended_confirm",
      empiricalPrecisionAt1: 0.7179,
      clientId: ""
    });
  });

  it("searches cleaned practice and group names from the public artifact", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse([
        {
          npi: "1234567890",
          displayName: "JANE SMITH",
          providerType: "individual",
          specialty: "Cardiology",
          specialtyTerms: "cardiology,cardiovascular disease",
          zip5: "60611",
          state: "IL",
          practiceOrganizationNames: "Lakeview Cardiology Group",
          lat: 41.89,
          lon: -87.62,
          endpointOptions: [
            {
              accessBrand: "Northwestern Medicine",
              fhirBaseUrl: "https://epic.example.test/FHIR/R4",
              confidence: 0.95,
              matchMethod: "reviewed_public_assertion",
              evidence: "Synthetic test record"
            }
          ]
        }
      ])
    ) as unknown as typeof fetch;

    const results = await searchProviders("lakeview group", {
      includeSandbox: false,
      fetcher
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      name: "JANE SMITH",
      practiceOrganizationNames: "Lakeview Cardiology Group"
    });
  });

  it("returns provider-only records when no endpoint association is known", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse([
        {
          npi: "1234567890",
          displayName: "JANE SMITH",
          directoryStatus: "provider_only",
          providerType: "individual",
          specialty: "Cardiology",
          specialtyTerms: "cardiology,cardiovascular disease",
          zip5: "60611",
          state: "IL",
          practiceLine1: "123 Main St",
          practiceCity: "Chicago",
          practiceState: "IL",
          practiceZip5: "60611",
          lat: 41.89,
          lon: -87.62,
          endpointOptions: []
        }
      ])
    ) as unknown as typeof fetch;

    const results = await searchProviders("jane smith", {
      includeSandbox: false,
      fetcher
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "directory-1234567890-provider",
      name: "JANE SMITH",
      endpointStatus: "provider_only",
      accessBrand: "Portal unknown",
      fhirBaseUrl: "",
      clientId: "",
      location: "123 Main St Chicago, IL 60611"
    });
  });

  it("sorts directory artifact matches by distance when coordinates are available", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse([
        {
          npi: "1",
          displayName: "FAR CARDIOLOGY",
          providerType: "organization",
          specialty: "Cardiology",
          specialtyTerms: "cardiology",
          zip5: "60540",
          state: "IL",
          lat: 41.76,
          lon: -88.14,
          endpointOptions: [
            {
              accessBrand: "Far System",
              fhirBaseUrl: "https://far.example.test/fhir/r4",
              confidence: 0.75,
              matchMethod: "location_match",
              evidence: "Synthetic test record"
            }
          ]
        },
        {
          npi: "2",
          displayName: "NEAR CARDIOLOGY",
          providerType: "organization",
          specialty: "Cardiology",
          specialtyTerms: "cardiology",
          zip5: "60611",
          state: "IL",
          lat: 41.89,
          lon: -87.62,
          endpointOptions: [
            {
              accessBrand: "Near System",
              fhirBaseUrl: "https://near.example.test/fhir/r4",
              confidence: 0.75,
              matchMethod: "location_match",
              evidence: "Synthetic test record"
            }
          ]
        }
      ])
    ) as unknown as typeof fetch;

    const results = await searchProviders("cardiology", {
      includeSandbox: false,
      fetcher,
      sort: "distance",
      origin: { lat: 41.89, lon: -87.62 }
    });

    expect(results.map((result) => result.name)).toEqual(["NEAR CARDIOLOGY", "FAR CARDIOLOGY"]);
    expect(results[0].distanceMiles).toBeLessThan(1);
  });

  it("resolves an entered ZIP to a directory-derived coordinate origin", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse([
        {
          npi: "1",
          displayName: "A",
          providerType: "organization",
          specialty: "Cardiology",
          specialtyTerms: "cardiology",
          zip5: "60611",
          state: "IL",
          lat: 41.9,
          lon: -87.6,
          endpointOptions: []
        },
        {
          npi: "2",
          displayName: "B",
          providerType: "organization",
          specialty: "Cardiology",
          specialtyTerms: "cardiology",
          zip5: "60611",
          state: "IL",
          lat: 41.8,
          lon: -87.7,
          endpointOptions: []
        }
      ])
    ) as unknown as typeof fetch;

    const origin = await resolveDirectoryOrigin("60611", { fetcher });
    expect(origin?.lat).toBeCloseTo(41.85);
    expect(origin?.lon).toBeCloseTo(-87.65);
  });
});
