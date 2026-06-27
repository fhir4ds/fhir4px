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
      return {
        ok: true,
        async json() {
          // New format: flat dict keyed by code → { name, friendly_source, match_type, cui }
          if (url.includes("patient_friendly_lnc.json")) {
            return {
              "4548-4": { name: "Hemoglobin A1c", friendly_source: "CHV", match_type: "broader", cui: "C4519732" }
            };
          }
          return {};
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
    expect(fetchMock.mock.calls[0][0]).toContain("/terminology/patient_friendly_lnc.json");
    expect(result).toMatchObject({
      patientFriendlyName: "Hemoglobin A1c",
      system: "loinc",
      code: "4548-4",
      friendlySource: "CHV",
      matchType: "broader",
      fallback: false,
      needsModelFallback: false
    });
    expect(PATIENT_FRIENDLY_LOOKUP_MODEL).toBe("patient-friendly-lookup-v2");
  });

  it("reads the generated LOINC file in new format", async () => {
    const data = JSON.parse(await readFile("public/terminology/patient_friendly_lnc.json", "utf8"));

    // New format: flat dict { code: { name, friendly_source, match_type, cui } }
    const entry = data["4548-4"];
    expect(entry).toBeTruthy();
    expect(typeof entry.name).toBe("string");
    expect(typeof entry.friendly_source).toBe("string");
    expect(typeof entry.match_type).toBe("string");
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

  it("prefers RxNorm SCD (specific drug) over IN (ingredient) by TTY", () => {
    const lookup: PatientFriendlyLookup = {
      rxnorm: new Map([
        [
          "860975",
          {
            system: "rxnorm",
            code: "860975",
            name: "Metformin 500 MG Oral Tablet",
            friendlySource: "RXNORM",
            matchType: "exact",
            tty: "SCD"
          }
        ],
        [
          "6809",
          {
            system: "rxnorm",
            code: "6809",
            name: "Metformin",
            friendlySource: "RXNORM",
            matchType: "ingredient",
            tty: "IN"
          }
        ]
      ])
    };

    const medication = record({
      id: "med-metformin",
      resourceType: "MedicationRequest",
      sourceLabel: "Metformin 500mg tablet",
      codingKeys: ["rxnorm:860975", "rxnorm:6809"]
    });

    const result = lookupPatientFriendlyName(medication, lookup);
    expect(result?.code).toBe("860975");
    expect(result?.patientFriendlyName).toBe("Metformin 500 MG Oral Tablet");
  });

  it("prefers RxNorm GPCK (pack) over SCD (specific drug) by TTY", () => {
    const lookup: PatientFriendlyLookup = {
      rxnorm: new Map([
        [
          "1000000",
          {
            system: "rxnorm",
            code: "1000000",
            name: "Metformin + Glipizide Pack",
            friendlySource: "RXNORM",
            matchType: "group",
            tty: "GPCK"
          }
        ],
        [
          "860975",
          {
            system: "rxnorm",
            code: "860975",
            name: "Metformin 500 MG Oral Tablet",
            friendlySource: "RXNORM",
            matchType: "exact",
            tty: "SCD"
          }
        ]
      ])
    };

    const medication = record({
      id: "med-pack",
      resourceType: "MedicationRequest",
      sourceLabel: "Metformin/Glipizide pack",
      codingKeys: ["rxnorm:1000000", "rxnorm:860975"]
    });

    const result = lookupPatientFriendlyName(medication, lookup);
    expect(result?.code).toBe("1000000");
  });

  it("prefers more specific ICD-10 code (E11.22 over E11.9)", () => {
    const lookup: PatientFriendlyLookup = {
      icd10cm: new Map([
        [
          "E11.9",
          {
            system: "icd10cm",
            code: "E11.9",
            name: "Type 2 Diabetes",
            friendlySource: "CHV",
            matchType: "broader"
          }
        ],
        [
          "E11.22",
          {
            system: "icd10cm",
            code: "E11.22",
            name: "Type 2 Diabetes with CKD",
            friendlySource: "CHV",
            matchType: "broader"
          }
        ]
      ])
    };

    const condition = record({
      id: "cond-diabetes",
      resourceType: "Condition",
      sourceLabel: "Type 2 diabetes with CKD",
      codingKeys: ["icd10cm:E11.9", "icd10cm:E11.22"]
    });

    const result = lookupPatientFriendlyName(condition, lookup);
    expect(result?.code).toBe("E11.22");
    expect(result?.patientFriendlyName).toBe("Type 2 Diabetes with CKD");
  });

  it("prefers full-length ICD-10 code over 3-character category", () => {
    const lookup: PatientFriendlyLookup = {
      icd10cm: new Map([
        [
          "E11",
          {
            system: "icd10cm",
            code: "E11",
            name: "Type 2 Diabetes",
            friendlySource: "CHV",
            matchType: "broader"
          }
        ],
        [
          "E11.65",
          {
            system: "icd10cm",
            code: "E11.65",
            name: "Type 2 Diabetes with hyperglycemia",
            friendlySource: "CHV",
            matchType: "broader"
          }
        ]
      ])
    };

    const condition = record({
      id: "cond-diabetes",
      resourceType: "Condition",
      sourceLabel: "Type 2 diabetes mellitus with hyperglycemia",
      codingKeys: ["icd10cm:E11", "icd10cm:E11.65"]
    });

    const result = lookupPatientFriendlyName(condition, lookup);
    expect(result?.code).toBe("E11.65");
  });
});
