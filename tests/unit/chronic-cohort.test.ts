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

interface ManifestPatient {
  id: string;
  tier: string;
  focus: string;
  total: number;
  counts: Record<string, number>;
}

const RESOURCE_TYPES: GroupableResourceType[] = ["MedicationRequest", "Condition", "Observation", "Immunization"];
const LOOKUP_SYSTEMS: PatientFriendlyLookupSystem[] = ["loinc", "rxnorm", "icd10cm", "snomed", "cvx", "cpt", "hcpcs"];

const PROFILE_BY_TYPE: Record<string, string> = {
  Patient: "us-core-patient",
  Condition: "us-core-condition",
  Medication: "us-core-medication",
  MedicationRequest: "us-core-medicationrequest",
  Observation: "us-core-observation-lab",
  Procedure: "us-core-procedure",
  Encounter: "us-core-encounter",
  Immunization: "us-core-immunization",
  AllergyIntolerance: "us-core-allergyintolerance",
  DiagnosticReport: "us-core-diagnosticreport-lab"
};

async function loadManifest(): Promise<ManifestPatient[]> {
  const manifest = JSON.parse(await readFile("tests/fixtures/fhir/chronic/manifest.json", "utf8"));
  return manifest.patients;
}

async function loadBundle(id: string): Promise<FhirResource[]> {
  const fixture = JSON.parse(await readFile(`tests/fixtures/fhir/chronic/${id}.json`, "utf8"));
  return fixture.entry.map((entry: { resource: FhirResource }) => entry.resource);
}

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
      const raw = JSON.parse(await readFile(`public/terminology/${systemFileMap[system]}`, "utf8")) as Record<
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

function collectReferences(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectReferences(item, out);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "reference" && typeof value === "string") out.push(value);
      else collectReferences(value, out);
    }
  }
}

describe("chronic cohort fixtures", () => {
  it("manifest matches bundles with unique ids and intact references", async () => {
    const patients = await loadManifest();
    expect(patients).toHaveLength(27);

    const seenIds = new Set<string>();
    for (const manifestPatient of patients) {
      const resources = await loadBundle(manifestPatient.id);
      expect(resources, manifestPatient.id).toHaveLength(manifestPatient.total);

      const ids = new Set<string>();
      for (const resource of resources) {
        ids.add(`${resource.resourceType}/${resource.id}`);
        expect(resource.id, `${manifestPatient.id} id charset`).toMatch(/^[A-Za-z0-9.-]{1,64}$/);
      }
      expect(ids.size, manifestPatient.id).toBe(resources.length);

      for (const resource of resources) {
        const refs: string[] = [];
        collectReferences(resource, refs);
        for (const ref of refs) {
          if (ref.startsWith("Patient/") || ref.includes("://")) continue;
          expect(ids.has(ref), `${manifestPatient.id}: dangling ${ref} in ${resource.resourceType}/${resource.id}`).toBe(true);
        }
        if (!seenIds.has(`${resource.resourceType}/${resource.id}`)) seenIds.add(`${resource.resourceType}/${resource.id}`);
      }

      const conditions = resources.filter((r) => r.resourceType === "Condition");
      expect(conditions.length, manifestPatient.id).toBeGreaterThanOrEqual(2);
      expect(resources.filter((r) => r.resourceType === "MedicationRequest").length, manifestPatient.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("declares US Core profiles and required elements", async () => {
    const patients = await loadManifest();
    for (const manifestPatient of patients) {
      const resources = await loadBundle(manifestPatient.id);
      for (const resource of resources) {
        const expectedProfile = PROFILE_BY_TYPE[resource.resourceType];
        if (resource.resourceType === "Observation") {
          // vitals intentionally omit profiles (base vitalsigns slicing requires BP panels only)
          const category = (resource as { category?: Array<{ coding?: Array<{ code?: string }> }> }).category?.[0]?.coding?.[0]?.code;
          if (category === "vital-signs" || category === "survey" || category === "social-history") continue;
          const profiles = ((resource as { meta?: { profile?: string[] } }).meta?.profile ?? []).join(",");
          if (profiles.includes("us-core-smokingstatus")) continue;
        }
        if (expectedProfile) {
          const profiles = ((resource as { meta?: { profile?: string[] } }).meta?.profile ?? []).join(",");
          expect(profiles, `${manifestPatient.id} ${resource.resourceType}`).toContain(expectedProfile);
        }
        if (resource.resourceType === "Condition") {
          const cond = resource as unknown as Record<string, unknown>;
          expect(cond.clinicalStatus).toBeDefined();
          expect(cond.verificationStatus).toBeDefined();
          expect(cond.category).toBeDefined();
        }
        if (resource.resourceType === "MedicationRequest") {
          const medReq = resource as unknown as Record<string, unknown>;
          expect(medReq.requester).toBeDefined();
          expect(medReq.authoredOn).toBeDefined();
        }
      }
    }
  });

  it("keeps the messy tier-4 fraction near 10% of observations", async () => {
    const manifest = JSON.parse(await readFile("tests/fixtures/fhir/chronic/manifest.json", "utf8"));
    let coded = 0;
    let codeless = 0;
    for (const p of manifest.patients) {
      for (const o of p.groundTruth.observations) {
        if (o.coded) coded += 1;
        else codeless += 1;
      }
    }
    expect(codeless).toBeGreaterThan(0);
    expect(codeless / (coded + codeless)).toBeGreaterThan(0.05);
    expect(codeless / (coded + codeless)).toBeLessThan(0.15);
  });

  it("groups and compacts a complex multimorbidity patient", async () => {
    const resources = await loadBundle("fhir4px-chronic-walt-multimorbid");
    const summary = buildReferralSummary(resources);
    const records = buildGroupableRecords(summary);
    const counts = Object.fromEntries(
      RESOURCE_TYPES.map((t) => [t, records.filter((r) => r.resourceType === t).length])
    ) as Record<GroupableResourceType, number>;

    expect(counts.MedicationRequest).toBeGreaterThanOrEqual(12);
    expect(counts.Condition).toBeGreaterThanOrEqual(10);
    expect(counts.Observation).toBeGreaterThanOrEqual(700);

    const observationGroups = deterministicPatientGrouping(
      records.filter((r) => r.resourceType === "Observation")
    ).groups;
    expect(observationGroups.some((g) => g.groupId.includes("4548-4"))).toBe(true);

    const compact = compactRecordsForModel(records.filter((r) => r.resourceType === "Observation"));
    expect(compact.length).toBeLessThanOrEqual(60);
  });

  it("resolves chronic-cohort codes in the patient-friendly lookup", async () => {
    const lookup = await loadLocalPatientFriendlyLookup();
    const compactFor = async (id: string) => {
      const resources = await loadBundle(id);
      const records = buildGroupableRecords(buildReferralSummary(resources));
      return compactRecordsForModel(records.filter((r) => r.resourceType === "Observation"));
    };
    const byCode = (compact: Awaited<ReturnType<typeof compactFor>>, code: string) => {
      const record = compact.find((c) => c.codingKeys?.includes(`loinc:${code}`));
      return record ? lookupPatientFriendlyName(record, lookup) : null;
    };

    const tessa = await compactFor("fhir4px-chronic-tessa-t1d");
    expect(byCode(tessa, "4548-4")?.patientFriendlyName).toBe("Hemoglobin A1c/Hemoglobin.Total");
    const tony = await compactFor("fhir4px-chronic-tony-transplant");
    expect(byCode(tony, "2160-0")?.patientFriendlyName).toBe("Creatinine");
  });
});
