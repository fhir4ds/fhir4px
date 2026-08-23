import { afterEach, describe, expect, it, vi } from "vitest";
import { setAssociationsForTest } from "../../src/lib/associations/bundle";
import { resolveGroupConcept } from "../../src/lib/associations/resolve";
import { findRelatedGroups, relationshipLabel } from "../../src/lib/associations/matcher";
import type { AssociationBundle, Icd10Crosswalk, LabPartCrosswalk } from "../../src/lib/associations/types";
import type { GroupableRecord, PatientFriendlyGroup } from "../../src/lib/fhir/patient-groups";

vi.mock("../../src/lib/fhir/rxnorm-decomposition", () => ({
  getIngredientsForRxnormCode: async (code: string) =>
    code === "860975" ? [{ code: "6809", name: "metformin" }] : []
}));

const BUNDLE: AssociationBundle = {
  format: "fhir4px_associations_v1",
  version: "test",
  by_cid: {
    "RXNORM:860975": "metformin",
    "VAL-MED-RXNORM-6809": "metformin",
    "VAL-MED-RXNORM-29046": "lisinopril",
    "RXNORM:855332": "warfarin",
    "VAL-COND-SNOMED-44054006": "type 2 diabetes",
    "VAL-COND-ICD10CM-E11.65": "type 2 diabetes",
    "VAL-COND-ICD10CM-E11": "type 2 diabetes",
    "VAL-COND-SNOMED-38341003": "hypertension",
    "VAL-COND-SNOMED-49436004": "atrial fibrillation",
    "VAL-COND-SNOMED-999999": "osteoarthritis",
    "VAL-COND-SNOMED-888888": "asthma",
    "VAL-COND-SNOMED-73211009": "diabetes mellitus",
    "VAL-MED-RXNORM-99999": "insulin glargine"
  },
  by_name: {
    metformin: "VAL-MED-RXNORM-6809",
    "type 2 diabetes": "VAL-COND-SNOMED-44054006"
  },
  concepts: {
    metformin: {
      name: "metformin",
      buckets: {
        lab: [
          { cid: "VAL-LAB-LOINC-LP16413-4", name: "Hemoglobin A1c", provenance: "monitoring_recommendation" },
          { cid: "VAL-LAB-LOINC-LP14355-9", name: "Creatinine", provenance: "monitoring_recommendation" },
          { cid: "VAL-LAB-LOINC-LP15098-4", name: "Potassium", provenance: "monitoring_recommendation" },
          { cid: "VAL-LAB-LOINC-LP14635-4", name: "Glucose", provenance: "panel_cooccurrence" }
        ],
        vital: [{ cid: "VAL-VIT-LOINC-8480-6", name: "Systolic Blood Pressure" }],
        treats: [
          { cid: "VAL-COND-SNOMED-44054006", name: "Type 2 Diabetes", provenance: "direct_indication" },
          { cid: "VAL-COND-SNOMED-49436004", name: "Atrial Fibrillation", provenance: "event_prevention" },
          { cid: "VAL-COND-SNOMED-999999", name: "Osteoarthritis", provenance: "population_context" },
          { cid: "VAL-COND-SNOMED-888888", name: "Asthma", provenance: "comorbidity_section" }
        ]
      }
    },
    warfarin: {
      name: "warfarin",
      buckets: {
        lab: [{ cid: "VAL-LAB-LOINC-6301-6", name: "International Normalized Ratio (INR)" }],
        treats: [{ cid: "VAL-COND-SNOMED-49436004", name: "Atrial Fibrillation" }]
      }
    },
    lisinopril: {
      name: "lisinopril",
      buckets: {
        lab: [{ cid: "VAL-LAB-LOINC-LP15098-4", name: "Potassium" }]
      }
    },
    "type 2 diabetes": {
      name: "type 2 diabetes",
      buckets: {
        lab: [{ cid: "VAL-LAB-LOINC-LP16413-4", name: "Hemoglobin A1c" }],
        medication: [{ cid: "VAL-MED-RXNORM-6809", name: "metformin" }]
      },
      parent_cids: ["VAL-COND-SNOMED-73211009"]
    },
    "diabetes mellitus": {
      name: "diabetes mellitus",
      buckets: {
        lab: [{ cid: "VAL-LAB-LOINC-LP9999-9", name: "C Peptide", provenance: "monitoring_recommendation" }],
        medication: [{ cid: "VAL-MED-RXNORM-99999", name: "Insulin Glargine", provenance: "direct_indication" }]
      }
    },
    "insulin glargine": {
      name: "insulin glargine",
      buckets: {}
    },
    hypertension: {
      name: "hypertension",
      buckets: {}
    }
  }
};

const LAB_PARTS: LabPartCrosswalk = {
  "VAL-LAB-LOINC-4548-4": ["VAL-LAB-LOINC-LP16413-4"],
  "VAL-LAB-LOINC-2160-0": ["VAL-LAB-LOINC-LP14355-9"],
  "VAL-LAB-LOINC-2823-3": ["VAL-LAB-LOINC-LP15098-4"]
};

const ICD10_XWALK: Icd10Crosswalk = {
  "VAL-COND-ICD10CM-E11.9": "VAL-COND-SNOMED-44054006"
};

function group(overrides: Partial<PatientFriendlyGroup>): PatientFriendlyGroup {
  return {
    groupId: "g",
    patientFriendlyName: "Group",
    resourceIds: [],
    resourceTypes: ["Condition"],
    confidence: 0.9,
    reason: "",
    fallback: false,
    ...overrides
  };
}

function record(overrides: Partial<GroupableRecord> & Pick<GroupableRecord, "id" | "resourceType">): GroupableRecord {
  return { source: "provider", ...overrides };
}

describe("association resolution + matching", () => {
  afterEach(() => {
    setAssociationsForTest(null);
  });

  it("resolves a medication via product CID", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });
    const g = group({ groupId: "med", patientFriendlyName: "Metformin", resourceTypes: ["MedicationRequest"] });
    const r = record({ id: "m1", resourceType: "MedicationRequest", codingKeys: ["rxnorm:860975"] });
    const resolution = await resolveGroupConcept(g, [r]);
    expect(resolution.conceptKey).toBe("metformin");
    expect(resolution.resolvedVia).toBe("RXNORM:860975");
  });

  it("resolves a medication via ingredient decomposition when product code is unknown", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });
    const g = group({ groupId: "med2", patientFriendlyName: "Metformin ER", resourceTypes: ["MedicationRequest"] });
    const r = record({ id: "m2", resourceType: "MedicationRequest", codingKeys: ["rxnorm:860975"] });
    const resolution = await resolveGroupConcept(g, [r]);
    expect(resolution.conceptKey).toBe("metformin");
  });

  it("resolves a condition from SNOMED, exact ICD-10, category ICD-10, and crosswalk", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });

    const snomed = await resolveGroupConcept(
      group({ groupId: "c1", patientFriendlyName: "T2DM" }),
      [record({ id: "c1", resourceType: "Condition", codingKeys: ["snomed:44054006"] })]
    );
    expect(snomed.conceptKey).toBe("type 2 diabetes");

    const exact = await resolveGroupConcept(
      group({ groupId: "c2", patientFriendlyName: "T2DM", canonicalCode: { system: "icd10", code: "E11.65" } }),
      [record({ id: "c2", resourceType: "Condition", codingKeys: [] })]
    );
    expect(exact.conceptKey).toBe("type 2 diabetes");

    const category = await resolveGroupConcept(
      group({ groupId: "c3", patientFriendlyName: "T2DM", canonicalCode: { system: "icd10", code: "E11.69" } }),
      [record({ id: "c3", resourceType: "Condition", codingKeys: [] })]
    );
    expect(category.conceptKey).toBe("type 2 diabetes");
    expect(category.resolvedVia).toBe("VAL-COND-ICD10CM-E11");

    const viaCrosswalk = await resolveGroupConcept(
      group({ groupId: "c4", patientFriendlyName: "T2DM", canonicalCode: { system: "icd10", code: "E11.9" } }),
      [record({ id: "c4", resourceType: "Condition", codingKeys: [] })]
    );
    expect(viaCrosswalk.conceptKey).toBe("type 2 diabetes");
    expect(viaCrosswalk.resolvedVia).toBe("VAL-COND-SNOMED-44054006");
  });

  it("resolves labs to part CIDs plus identity CIDs via the crosswalk", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });
    const g = group({ groupId: "lab", patientFriendlyName: "Hemoglobin A1c", resourceTypes: ["Observation"] });
    const r = record({ id: "l1", resourceType: "Observation", codingKeys: ["loinc:4548-4"] });
    const resolution = await resolveGroupConcept(g, [r]);
    expect(resolution.conceptKey).toBeUndefined();
    expect(resolution.labPartCids).toEqual(
      expect.arrayContaining(["VAL-LAB-LOINC-LP16413-4", "VAL-LAB-LOINC-4548-4", "VAL-VIT-LOINC-4548-4"])
    );
  });

  it("emits identity CIDs for codes missing from the crosswalk (INR, vitals)", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });
    const inr = await resolveGroupConcept(
      group({ groupId: "inr", patientFriendlyName: "INR", resourceTypes: ["Observation"] }),
      [record({ id: "inr", resourceType: "Observation", codingKeys: ["loinc:6301-6"] })]
    );
    expect(inr.labPartCids).toContain("VAL-LAB-LOINC-6301-6");

    const sbp = await resolveGroupConcept(
      group({ groupId: "sbp", patientFriendlyName: "Systolic Blood Pressure", resourceTypes: ["Observation"] }),
      [record({ id: "sbp", resourceType: "Observation", codingKeys: ["loinc:8480-6"] })]
    );
    expect(sbp.labPartCids).toContain("VAL-VIT-LOINC-8480-6");
  });

  it("matches direct test-code lab members (warfarin -> INR) via identity CIDs", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });
    const matches = await findRelatedGroups(
      { groupId: "med-warf", resolution: { conceptKey: "warfarin" } },
      [
        {
          groupId: "lab-inr",
          groupName: "INR",
          resourceTypes: ["Observation"],
          resolution: { labPartCids: ["VAL-LAB-LOINC-6301-6", "VAL-VIT-LOINC-6301-6"] }
        }
      ]
    );
    expect(matches).toEqual([
      expect.objectContaining({ groupId: "lab-inr", relationship: "lab", matchedMemberName: "International Normalized Ratio (INR)" })
    ]);
  });

  it("matches vital bucket members (metformin -> Systolic Blood Pressure)", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });
    const matches = await findRelatedGroups(
      { groupId: "med", resolution: { conceptKey: "metformin" } },
      [
        {
          groupId: "obs-sbp",
          groupName: "Systolic Blood Pressure",
          resourceTypes: ["Observation"],
          resolution: { labPartCids: ["VAL-VIT-LOINC-8480-6"] }
        }
      ]
    );
    expect(matches).toEqual([
      expect.objectContaining({ groupId: "obs-sbp", relationship: "vital" })
    ]);
  });

  it("reverse-matches a vital click against vital buckets", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });
    const matches = await findRelatedGroups(
      { groupId: "obs-sbp", resolution: { labPartCids: ["VAL-VIT-LOINC-8480-6"] } },
      [
        { groupId: "med", groupName: "Metformin", resourceTypes: ["MedicationRequest"], resolution: { conceptKey: "metformin" } }
      ]
    );
    expect(matches).toEqual([
      expect.objectContaining({ groupId: "med", relationship: "vital" })
    ]);
  });

  it("matches labs and conditions when clicking a medication", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });
    const matches = await findRelatedGroups(
      { groupId: "med", resolution: { conceptKey: "metformin" } },
      [
        { groupId: "lab-a1c", groupName: "Hemoglobin A1c", resourceTypes: ["Observation"], resolution: { labPartCids: ["VAL-LAB-LOINC-LP16413-4"] } },
        { groupId: "lab-na", groupName: "Sodium", resourceTypes: ["Observation"], resolution: { labPartCids: ["VAL-LAB-LOINC-LP999"] } },
        { groupId: "cond-t2dm", groupName: "Type 2 Diabetes", resourceTypes: ["Condition"], resolution: { conceptKey: "type 2 diabetes" } },
        { groupId: "cond-htn", groupName: "Hypertension", resourceTypes: ["Condition"], resolution: { conceptKey: "hypertension" } }
      ]
    );
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: "lab-a1c", relationship: "lab", matchedMemberName: "Hemoglobin A1c" }),
        expect.objectContaining({ groupId: "cond-t2dm", relationship: "treats" })
      ])
    );
    expect(matches.find((m) => m.groupId === "lab-na")).toBeUndefined();
    expect(matches.find((m) => m.groupId === "cond-htn")).toBeUndefined();
  });

  it("matches dual-coded conditions at concept level regardless of bucket CID system", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });
    // metformin's treats bucket carries only the SNOMED anchor; a patient
    // condition resolved via the ICD-10 anchor must still match.
    const matches = await findRelatedGroups(
      { groupId: "med", resolution: { conceptKey: "metformin" } },
      [
        {
          groupId: "cond-icd",
          groupName: "T2DM",
          resourceTypes: ["Condition"],
          resolution: { conceptKey: "type 2 diabetes", resolvedVia: "VAL-COND-ICD10CM-E11.65" }
        }
      ]
    );
    expect(matches).toEqual([expect.objectContaining({ groupId: "cond-icd", relationship: "treats" })]);
  });

  it("matches medications when clicking a condition", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });
    const matches = await findRelatedGroups(
      { groupId: "cond", resolution: { conceptKey: "type 2 diabetes" } },
      [
        { groupId: "med", groupName: "Metformin", resourceTypes: ["MedicationRequest"], resolution: { conceptKey: "metformin" } },
        { groupId: "lab-a1c", groupName: "Hemoglobin A1c", resourceTypes: ["Observation"], resolution: { labPartCids: ["VAL-LAB-LOINC-LP16413-4"] } }
      ]
    );
    expect(matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: "med", relationship: "medication" }),
        expect.objectContaining({ groupId: "lab-a1c", relationship: "lab" })
      ])
    );
  });

  it("reverse-matches concepts when clicking a lab", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });
    const matches = await findRelatedGroups(
      { groupId: "lab-k", resolution: { labPartCids: ["VAL-LAB-LOINC-LP15098-4"] } },
      [
        { groupId: "med-lisi", groupName: "Lisinopril", resourceTypes: ["MedicationRequest"], resolution: { conceptKey: "lisinopril" } },
        { groupId: "cond-t2dm", groupName: "T2DM", resourceTypes: ["Condition"], resolution: { conceptKey: "type 2 diabetes" } }
      ]
    );
    expect(matches.map((m) => m.groupId)).toEqual(["med-lisi"]);
  });

  it("excludes population_context members from matching but keeps event_prevention", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });
    const candidates = [
      { groupId: "cond-t2dm", groupName: "Type 2 Diabetes", resourceTypes: ["Condition"], resolution: { conceptKey: "type 2 diabetes" } },
      { groupId: "cond-af", groupName: "Atrial Fibrillation", resourceTypes: ["Condition"], resolution: { conceptKey: "atrial fibrillation" } },
      { groupId: "cond-oa", groupName: "Osteoarthritis", resourceTypes: ["Condition"], resolution: { conceptKey: "osteoarthritis" } },
      { groupId: "cond-asthma", groupName: "Asthma", resourceTypes: ["Condition"], resolution: { conceptKey: "asthma" } }
    ];
    const matches = await findRelatedGroups(
      { groupId: "med", resolution: { conceptKey: "metformin" } },
      candidates
    );
    expect(matches.map((m) => m.groupId).sort()).toEqual(["cond-af", "cond-t2dm"]);
    expect(matches.find((m) => m.groupId === "cond-af")?.provenance).toBe("event_prevention");
    const loose = await findRelatedGroups({ groupId: "med", resolution: { conceptKey: "metformin" } }, candidates, {
      includeLooseProvenance: true
    });
    expect(loose.map((m) => m.groupId).sort()).toEqual(["cond-af", "cond-asthma", "cond-oa", "cond-t2dm"]);
  });

  it("excludes panel_cooccurrence labs by default and includes them in loose mode", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });
    const candidates = [
      { groupId: "lab-a1c", groupName: "Hemoglobin A1c", resourceTypes: ["Observation"], resolution: { labPartCids: ["VAL-LAB-LOINC-LP16413-4"] } },
      { groupId: "lab-glucose", groupName: "Glucose", resourceTypes: ["Observation"], resolution: { labPartCids: ["VAL-LAB-LOINC-LP14635-4"] } }
    ];
    const focus = { groupId: "med", resolution: { conceptKey: "metformin" } };

    const defaultMatches = await findRelatedGroups(focus, candidates);
    expect(defaultMatches.map((m) => m.groupId)).toEqual(["lab-a1c"]);

    const looseMatches = await findRelatedGroups(focus, candidates, { includeLooseProvenance: true });
    expect(looseMatches.map((m) => m.groupId).sort()).toEqual(["lab-a1c", "lab-glucose"]);
  });

  it("unions parent hub monitor buckets with attribution, excluding hub medications", async () => {
    setAssociationsForTest({ bundle: BUNDLE, labParts: LAB_PARTS, icd10: ICD10_XWALK });
    const matches = await findRelatedGroups(
      { groupId: "cond-t2dm", resolution: { conceptKey: "type 2 diabetes" } },
      [
        { groupId: "lab-cpep", groupName: "C Peptide", resourceTypes: ["Observation"], resolution: { labPartCids: ["VAL-LAB-LOINC-LP9999-9"] } },
        { groupId: "med-glargine", groupName: "Insulin Glargine", resourceTypes: ["MedicationRequest"], resolution: { conceptKey: "insulin glargine" } }
      ]
    );
    // Hub lab members surface with "via hub" attribution…
    const cpep = matches.find((m) => m.groupId === "lab-cpep");
    expect(cpep).toMatchObject({ relationship: "lab", viaHubName: "diabetes mellitus" });
    // …but hub treats/medication members never badge on a subtype click
    // (IS_A default-deny allowlist — insulins are not a T2DM direct treatment).
    expect(matches.find((m) => m.groupId === "med-glargine")).toBeUndefined();

    // Reverse direction: a lab click also unions candidates' hubs.
    const reverse = await findRelatedGroups(
      { groupId: "lab-cpep", resolution: { labPartCids: ["VAL-LAB-LOINC-LP9999-9"] } },
      [
        { groupId: "cond-t2dm", groupName: "Type 2 Diabetes", resourceTypes: ["Condition"], resolution: { conceptKey: "type 2 diabetes" } }
      ]
    );
    expect(reverse).toEqual([
      expect.objectContaining({ groupId: "cond-t2dm", relationship: "lab", viaHubName: "diabetes mellitus" })
    ]);
  });

  it("labels relationships by focus type and provenance", () => {
    expect(relationshipLabel("lab", false)).toBe("Lab to monitor");
    expect(relationshipLabel("medication", true)).toBe("Treats this");
    expect(relationshipLabel("medication", true, "event_prevention")).toBe("Helps prevent");
    expect(relationshipLabel("treats", false, "direct_indication")).toBe("Treats");
    expect(relationshipLabel("treats", false, "population_context")).toBe("Used for");
    expect(relationshipLabel("condition", false)).toBe("Adverse event");
    expect(relationshipLabel("condition", true)).toBe("Related condition");
  });
});
