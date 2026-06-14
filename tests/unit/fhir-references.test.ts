import { describe, expect, it, vi } from "vitest";
import { collectMissingReferences, createResourceIndex, fetchMissingReferences, resolveReference } from "../../src/lib/fhir/references";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/fhir+json" }
  });
}

describe("FHIR reference resolution", () => {
  it("indexes relative references and detects missing same-server display references", () => {
    const resources = [
      { resourceType: "MedicationRequest", id: "rx-1", medicationReference: { reference: "Medication/med-1" } },
      { resourceType: "Condition", id: "condition-1" }
    ];
    const index = createResourceIndex(resources, "https://ehr.example.test/fhir");

    expect(resolveReference("Condition/condition-1", index)?.id).toBe("condition-1");

    const { missing } = collectMissingReferences(resources, "https://ehr.example.test/fhir", {
      scope: "patient/Medication.read"
    });

    expect(missing).toMatchObject([
      {
        resourceType: "Medication",
        id: "med-1",
        url: "https://ehr.example.test/fhir/Medication/med-1"
      }
    ]);
  });

  it("fetches allowed missing references directly from the source FHIR server", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        resourceType: "Medication",
        id: "med-1",
        code: { text: "Metformin" }
      })
    ) as unknown as typeof fetch;

    const resolved = await fetchMissingReferences(
      [{ resourceType: "MedicationRequest", id: "rx-1", medicationReference: { reference: "Medication/med-1" } }],
      {
        fhirBaseUrl: "https://ehr.example.test/fhir",
        headers: { Authorization: "Bearer token" },
        scope: "patient/Medication.read",
        fetcher
      }
    );

    expect(resolved.fetched).toHaveLength(1);
    expect(resolved.resources.map((resource) => `${resource.resourceType}/${resource.id}`)).toContain(
      "Medication/med-1"
    );
    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe("https://ehr.example.test/fhir/Medication/med-1");
  });

  it("skips references when scopes do not allow the resource type", () => {
    const { missing, skipped } = collectMissingReferences(
      [{ resourceType: "MedicationRequest", id: "rx-1", medicationReference: { reference: "Medication/med-1" } }],
      "https://ehr.example.test/fhir",
      { scope: "patient/MedicationRequest.read" }
    );

    expect(missing).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  it("does not guess optional reference scope when the token has no scope value", () => {
    const { missing, skipped } = collectMissingReferences(
      [{ resourceType: "MedicationRequest", id: "rx-1", medicationReference: { reference: "Medication/med-1" } }],
      "https://ehr.example.test/fhir",
      { scope: "" }
    );

    expect(missing).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });
});
