import { describe, expect, it, vi } from "vitest";
import { fetchAllPages, fetchPatientDataset } from "../../src/lib/smart/data";
import type { SmartSessionInfo, SmartToken } from "../../src/lib/smart/types";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/fhir+json" }
  });
}

describe("FHIR data fetching", () => {
  it("follows Bundle next links without using a backend proxy", async () => {
    const fetcher = (vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          resourceType: "Bundle",
          entry: [{ resource: { resourceType: "Observation", id: "a" } }],
          link: [{ relation: "next", url: "https://ehr.example.test/fhir/Observation?page=2" }]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          resourceType: "Bundle",
          entry: [{ resource: { resourceType: "Observation", id: "b" } }]
        })
      )) as unknown as typeof fetch;

    const resources = await fetchAllPages("https://ehr.example.test/fhir/Observation?patient=p", {}, { fetcher });

    expect(resources.map((resource) => resource.id)).toEqual(["a", "b"]);
    expect(vi.mocked(fetcher).mock.calls.map((call) => String(call[0]))).toEqual([
      "https://ehr.example.test/fhir/Observation?patient=p",
      "https://ehr.example.test/fhir/Observation?page=2"
    ]);
  });

  it("uses the source FHIR base URL for patient dataset reads", async () => {
    const session: SmartSessionInfo = {
      fhirBaseUrl: "https://ehr.example.test/fhir",
      vendor: "epic",
      clientId: "client-id"
    };
    const token: SmartToken = {
      accessToken: "token",
      tokenType: "Bearer",
      expiresAt: Date.now() + 1000,
      patientId: "patient-123",
      scope: "patient/Patient.read patient/MedicationRequest.read"
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ resourceType: "Patient", id: "patient-123" }))
      .mockResolvedValueOnce(jsonResponse({ resourceType: "Bundle", entry: [] })) as unknown as typeof fetch;

    await fetchPatientDataset(session, token, {
      fetcher,
      resourceTypes: ["Patient", "MedicationRequest"],
      maxPages: 1
    });

    expect(vi.mocked(fetcher).mock.calls[0][0]).toBe("https://ehr.example.test/fhir/Patient/patient-123");
    expect(vi.mocked(fetcher).mock.calls[1][0]).toBe(
      "https://ehr.example.test/fhir/MedicationRequest?patient=patient-123&_count=100"
    );
    expect(JSON.stringify(vi.mocked(fetcher).mock.calls)).not.toContain("fhir4px");
  });

  it("adds FHIR host context to browser network fetch failures", async () => {
    const session: SmartSessionInfo = {
      fhirBaseUrl: "https://ehr.example.test/fhir",
      vendor: "epic",
      clientId: "client-id"
    };
    const token: SmartToken = {
      accessToken: "token",
      tokenType: "Bearer",
      expiresAt: Date.now() + 1000,
      patientId: "patient-123",
      scope: "patient/Patient.read"
    };
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;

    await expect(
      fetchPatientDataset(session, token, {
        fetcher,
        resourceTypes: ["Patient"],
        maxPages: 1
      })
    ).rejects.toThrow(
      'FHIR Patient read failed before an HTTP response from ehr.example.test. Browser reported "Failed to fetch".'
    );
  });

  it("skips optional resource searches that were not granted by SMART scope", async () => {
    const session: SmartSessionInfo = {
      fhirBaseUrl: "https://ehr.example.test/fhir",
      vendor: "epic",
      clientId: "client-id"
    };
    const token: SmartToken = {
      accessToken: "token",
      tokenType: "Bearer",
      expiresAt: Date.now() + 1000,
      patientId: "patient-123",
      scope: "patient/Patient.read patient/Observation.read"
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ resourceType: "Patient", id: "patient-123" }))
      .mockResolvedValueOnce(jsonResponse({ resourceType: "Bundle", entry: [] })) as unknown as typeof fetch;

    await fetchPatientDataset(session, token, {
      fetcher,
      resourceTypes: ["Patient", "MedicationRequest", "Observation", "Immunization"],
      maxPages: 1
    });

    expect(vi.mocked(fetcher).mock.calls.map((call) => String(call[0]))).toEqual([
      "https://ehr.example.test/fhir/Patient/patient-123",
      "https://ehr.example.test/fhir/Observation?patient=patient-123&_count=100"
    ]);
  });

  it("can resolve display-critical references after primary patient resource fetches", async () => {
    const session: SmartSessionInfo = {
      fhirBaseUrl: "https://ehr.example.test/fhir",
      vendor: "epic",
      clientId: "client-id"
    };
    const token: SmartToken = {
      accessToken: "token",
      tokenType: "Bearer",
      expiresAt: Date.now() + 1000,
      patientId: "patient-123",
      scope: "patient/Patient.read patient/MedicationRequest.read patient/Medication.read"
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ resourceType: "Patient", id: "patient-123" }))
      .mockResolvedValueOnce(
        jsonResponse({
          resourceType: "Bundle",
          entry: [
            {
              resource: {
                resourceType: "MedicationRequest",
                id: "rx-1",
                medicationReference: { reference: "Medication/med-1" }
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(jsonResponse({ resourceType: "Medication", id: "med-1", code: { text: "Metformin" } }));
    const fetcher = fetchMock as unknown as typeof fetch;

    const dataset = await fetchPatientDataset(session, token, {
      fetcher,
      resourceTypes: ["Patient", "MedicationRequest"],
      maxPages: 1,
      resolveReferences: true
    });

    expect(dataset.referenceResolution?.fetched).toBe(1);
    expect(dataset.resources.map((resource) => `${resource.resourceType}/${resource.id}`)).toContain(
      "Medication/med-1"
    );
    expect(vi.mocked(fetcher).mock.calls[2][0]).toBe("https://ehr.example.test/fhir/Medication/med-1");
  });
});
