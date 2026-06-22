import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildReferralSummary } from "../../src/lib/fhir/normalize";
import {
  buildGroupableRecords,
  compactRecordsForModel,
  deterministicPatientGrouping,
  type GroupableResourceType
} from "../../src/lib/fhir/patient-groups";
import {
  lookupPatientFriendlyName,
  type PatientFriendlyLookup,
  type PatientFriendlyLookupSystem
} from "../../src/lib/fhir/patient-friendly-lookup";
import type { FhirResource } from "../../src/lib/smart/data";

const RESOURCE_TYPES: GroupableResourceType[] = ["MedicationRequest", "Condition", "Observation", "Immunization"];
const LOOKUP_SYSTEMS: PatientFriendlyLookupSystem[] = ["loinc", "rxnorm", "icd10cm", "snomed", "cvx", "cpt", "hcpcs"];
const BASE_PATIENT_ID = "fhir4px-sandbox-patient";
const PATIENT_SCOPED_RESOURCE_TYPES = new Set([
  "AllergyIntolerance",
  "Condition",
  "DiagnosticReport",
  "Encounter",
  "Immunization",
  "MedicationRequest",
  "Observation",
  "Procedure"
]);
const LARGE_FIXTURE_CASES = [
  {
    path: "tests/fixtures/fhir/large-patient-r4.json",
    patientId: "fhir4px-large-sandbox-patient",
    minConditionCount: 3,
    minObservationCount: 425
  },
  {
    path: "tests/fixtures/fhir/large-cardiorenal-patient-r4.json",
    patientId: "fhir4px-large-cardiorenal-patient",
    minConditionCount: 10,
    minObservationCount: 400
  },
  {
    path: "tests/fixtures/fhir/large-respiratory-immune-patient-r4.json",
    patientId: "fhir4px-large-respiratory-immune-patient",
    minConditionCount: 10,
    minObservationCount: 250
  }
];

async function loadLocalPatientFriendlyLookup(): Promise<PatientFriendlyLookup> {
  const systemFileMap: Record<string, string> = {
    loinc: "patient_friendly_lnc.json",
    rxnorm: "patient_friendly_rxnorm.json",
    icd10cm: "patient_friendly_icd10cm.json",
    snomed: "patient_friendly_snomedct_us.json",
    cvx: "patient_friendly_cvx.json",
    cpt: "patient_friendly_cpt.json",
    hcpcs: "patient_friendly_hcpcs.json"
  };
  const entries = await Promise.all(
    LOOKUP_SYSTEMS.map(async (system) => {
      const fileName = systemFileMap[system] || `patient_friendly_${system}.json`;
      const raw = JSON.parse(await readFile(`public/terminology/${fileName}`, "utf8")) as Record<
        string,
        { name: string; friendly_source: string; match_type: string; cui?: string }
      >;
      return [
        system,
        new Map(
          Object.entries(raw).map(([code, entry]) => [
            code,
            { system, code, name: entry.name, friendlySource: entry.friendly_source, matchType: entry.match_type, cui: entry.cui }
          ])
        )
      ] as const;
    })
  );

  return Object.fromEntries(entries) as PatientFriendlyLookup;
}

describe("large patient fixture", () => {
  it("adds multiple large sandbox patients without reusing patient-scoped resource ids", async () => {
    const seenPatientScopedIds = new Map<string, string>();

    for (const fixtureCase of LARGE_FIXTURE_CASES) {
      const fixture = JSON.parse(await readFile(fixtureCase.path, "utf8")) as {
        entry: Array<{ resource: FhirResource }>;
      };
      const patient = fixture.entry.find((entry) => entry.resource.resourceType === "Patient")?.resource;
      const counts = fixture.entry.reduce<Record<string, number>>((summary, entry) => {
        summary[entry.resource.resourceType] = (summary[entry.resource.resourceType] ?? 0) + 1;
        return summary;
      }, {});

      expect(patient?.id).toBe(fixtureCase.patientId);
      expect(counts.Condition).toBeGreaterThanOrEqual(fixtureCase.minConditionCount);
      expect(counts.Observation).toBeGreaterThanOrEqual(fixtureCase.minObservationCount);

      for (const entry of fixture.entry) {
        const resource = entry.resource;
        const serialized = JSON.stringify(resource);
        expect(serialized).not.toContain(`Patient/${BASE_PATIENT_ID}`);
        if (!PATIENT_SCOPED_RESOURCE_TYPES.has(resource.resourceType)) continue;
        const resourceKey = `${resource.resourceType}/${resource.id}`;
        expect(seenPatientScopedIds.get(resourceKey), `${resourceKey} reused by ${fixtureCase.path}`).toBeUndefined();
        seenPatientScopedIds.set(resourceKey, fixtureCase.path);
      }
    }
  });

  it("keeps many repeated clinical resources compact enough for model grouping", async () => {
    const fixture = JSON.parse(await readFile("tests/fixtures/fhir/large-patient-r4.json", "utf8")) as {
      entry: Array<{ resource: FhirResource }>;
    };
    const summary = buildReferralSummary(fixture.entry.map((entry) => entry.resource));
    const records = buildGroupableRecords(summary);
    const counts = Object.fromEntries(
      RESOURCE_TYPES.map((resourceType) => [
        resourceType,
        records.filter((record) => record.resourceType === resourceType).length
      ])
    ) as Record<GroupableResourceType, number>;
    const compactCounts = Object.fromEntries(
      RESOURCE_TYPES.map((resourceType) => [
        resourceType,
        compactRecordsForModel(records.filter((record) => record.resourceType === resourceType)).length
      ])
    ) as Record<GroupableResourceType, number>;

    expect(counts).toMatchObject({
      MedicationRequest: 11,
      Condition: 3,
      Observation: 425,
      Immunization: 5
    });
    expect(compactCounts.MedicationRequest).toBeLessThanOrEqual(5);
    expect(compactCounts.Observation).toBeLessThanOrEqual(40);
    expect(compactCounts.Immunization).toBeLessThanOrEqual(5);

    const medicationCompact = compactRecordsForModel(
      records.filter((record) => record.resourceType === "MedicationRequest")
    );
    expect(medicationCompact.find((record) => record.ingredients?.includes("Metformin"))?.memberResourceIds).toHaveLength(5);
    expect(medicationCompact.find((record) => record.ingredients?.includes("Albuterol"))?.memberResourceIds).toHaveLength(4);

    const observationGroups = deterministicPatientGrouping(
      records.filter((record) => record.resourceType === "Observation")
    ).groups;
    expect(observationGroups.some((group) => group.groupId.startsWith("observation-measure-"))).toBe(false);
    expect(observationGroups.some((group) => group.groupId.includes("4548-4"))).toBe(true);
  });

  it("recognizes Jordan Longitudinal concepts in the patient-friendly lookup without unsafe medication matches", async () => {
    const fixture = JSON.parse(await readFile("tests/fixtures/fhir/large-patient-r4.json", "utf8")) as {
      entry: Array<{ resource: FhirResource }>;
    };
    const summary = buildReferralSummary(fixture.entry.map((entry) => entry.resource));
    const records = buildGroupableRecords(summary);
    const compactObservations = compactRecordsForModel(records.filter((record) => record.resourceType === "Observation"));
    const compactMedications = compactRecordsForModel(
      records.filter((record) => record.resourceType === "MedicationRequest")
    );
    const lookup = await loadLocalPatientFriendlyLookup();

    const observationResultByCode = (code: string) => {
      const record = compactObservations.find((candidate) => candidate.codingKeys?.includes(`loinc:${code}`));
      return record ? lookupPatientFriendlyName(record, lookup) : null;
    };
    const medicationResultByIngredient = (ingredient: string) => {
      const record = compactMedications.find((candidate) => candidate.ingredients?.includes(ingredient));
      return record ? lookupPatientFriendlyName(record, lookup) : null;
    };

    expect(observationResultByCode("4548-4")?.patientFriendlyName).toBe("Hemoglobin A1c/Hemoglobin.Total");
    expect(observationResultByCode("2339-0")?.patientFriendlyName).toBe("Glucose");
    expect(observationResultByCode("62292-8")?.patientFriendlyName).toBe("25-Hydroxyvitamin D3+25-Hydroxyvitamin D2");
    expect(medicationResultByIngredient("Albuterol")?.patientFriendlyName).toBe("Albuterol Inhalant Product");
    expect(medicationResultByIngredient("Albuterol")?.patientFriendlyName).not.toContain("Hydroxychloroquine");
  });
});
