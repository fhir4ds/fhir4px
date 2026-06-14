import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  loadPatientFriendlyLookupForRecords,
  lookupPatientFriendlyName,
  PATIENT_FRIENDLY_LOOKUP_MODEL,
  patientFriendlyLookupSystemsForRecords,
  type PatientFriendlyLookup
} from "../../src/lib/fhir/patient-friendly-lookup";
import type { GroupableRecord } from "../../src/lib/fhir/patient-groups";

function record(overrides: Partial<GroupableRecord> & Pick<GroupableRecord, "id" | "resourceType" | "sourceLabel">): GroupableRecord {
  return {
    source: "provider",
    ...overrides
  };
}

describe("patient-friendly lookup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes app coding keys into supported lookup systems", () => {
    const systems = patientFriendlyLookupSystemsForRecords([
      record({
        id: "obs-a1c",
        resourceType: "Observation",
        sourceLabel: "Hemoglobin A1c/Hemoglobin.total in Blood",
        codingKeys: ["loinc:4548-4", "local:a1c"]
      }),
      record({
        id: "cond-diabetes",
        resourceType: "Condition",
        sourceLabel: "Type 2 diabetes mellitus with hyperglycemia",
        codingKeys: ["icd10:E11.65", "snomed:44054006"]
      })
    ]);

    expect(systems).toEqual(["icd10cm", "loinc", "snomed"]);
  });

  it("loads only needed shards and returns the best patient-friendly name", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const system = url.match(/\/([^/]+)\.json$/)?.[1];
      return {
        ok: true,
        async json() {
          return {
            version: 1,
            system,
            entries:
              system === "loinc"
                ? {
                    "4548-4": ["Hemoglobin A1c", "CHV", "broader"]
                  }
                : {}
          };
        }
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const records = [
      record({
        id: "obs-a1c",
        resourceType: "Observation",
        sourceLabel: "Hemoglobin A1c/Hemoglobin.total in Blood",
        codingKeys: ["loinc:4548-4"]
      })
    ];
    const lookup = await loadPatientFriendlyLookupForRecords(records);
    const result = lookupPatientFriendlyName(records[0], lookup);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/terminology/patient-friendly/loinc.json");
    expect(result).toMatchObject({
      patientFriendlyName: "Hemoglobin A1c",
      system: "loinc",
      code: "4548-4",
      friendlySource: "CHV",
      matchType: "broader",
      fallback: false,
      needsModelFallback: false
    });
    expect(PATIENT_FRIENDLY_LOOKUP_MODEL).toBe("patient-friendly-lookup-v1");
  });

  it("includes CSV names that differ from technical names in the generated LOINC shard", async () => {
    const shard = JSON.parse(await readFile("public/terminology/patient-friendly/loinc.json", "utf8")) as {
      entries: Record<string, [string, string, string]>;
    };

    expect(shard.entries["4548-4"]).toEqual(["Hemoglobin A1c/Hemoglobin.Total", "LNC", "first_axis"]);
  });

  it("prefers resource-specific target systems and uses generated lookup entries directly", () => {
    const lookup: PatientFriendlyLookup = {
      icd10cm: new Map([
        [
          "E11.65",
          {
            system: "icd10cm",
            code: "E11.65",
            name: "Type 2 Diabetes",
            friendlySource: "CHV",
            matchType: "broader"
          }
        ]
      ]),
      snomed: new Map([
        [
          "44054006",
          {
            system: "snomed",
            code: "44054006",
            name: "Diabetes mellitus type 2",
            friendlySource: "SNOMEDCT_US",
            matchType: "original"
          }
        ]
      ])
    };

    const condition = record({
      id: "cond-diabetes",
      resourceType: "Condition",
      sourceLabel: "Type 2 diabetes mellitus with hyperglycemia",
      codingKeys: ["snomed:44054006", "icd10cm:E11.65"]
    });
    expect(lookupPatientFriendlyName(condition, lookup)).toMatchObject({
      patientFriendlyName: "Type 2 Diabetes",
      system: "icd10cm",
      needsModelFallback: false
    });

    const originalOnly = record({
      id: "cond-snomed",
      resourceType: "Condition",
      sourceLabel: "Diabetes mellitus type 2",
      codingKeys: ["snomed:44054006"]
    });
    expect(lookupPatientFriendlyName(originalOnly, lookup)).toMatchObject({
      patientFriendlyName: "Diabetes mellitus type 2",
      fallback: false,
      needsModelFallback: false
    });
  });

  it("rejects medication lookup entries that conflict with source ingredients", () => {
    const lookup: PatientFriendlyLookup = {
      rxnorm: new Map([
        [
          "979092",
          {
            system: "rxnorm",
            code: "979092",
            name: "Hydroxychloroquine Oral Product",
            friendlySource: "RXNORM",
            matchType: "group"
          }
        ]
      ])
    };

    const medication = record({
      id: "medreq-albuterol",
      resourceType: "MedicationRequest",
      sourceLabel: "Albuterol nebulizer solution",
      codingKeys: ["rxnorm:979092"],
      codeTexts: ["Albuterol nebulizer solution"],
      codeCodings: [{ code: "979092", display: "albuterol 2.5 MG/3 ML Inhalation Solution" }],
      ingredients: ["Albuterol"],
      route: "Inhaled"
    });

    expect(lookupPatientFriendlyName(medication, lookup)).toBeNull();
  });
});
