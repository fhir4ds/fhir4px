import { describe, expect, it } from "vitest";
import { resolveGroupConcept } from "../../src/lib/associations/resolve";
import { setAssociationsForTest } from "../../src/lib/associations/bundle";
import type { GroupableRecord } from "../../src/lib/fhir/patient-groups";

function record(overrides: Partial<GroupableRecord>): GroupableRecord {
  return {
    id: "r1",
    resourceType: "Observation",
    sourceLabel: "x",
    status: "active",
    source: "provider",
    ...overrides
  } as GroupableRecord;
}

const bundle = {
  format: "fhir4px_associations_v1.2",
  version: "test-7.2",
  by_cid: {
    "VAL-PROC-CPT-90935": "hemodialysis",
    "VAL-PROC-HCPCS-G0257": "hemodialysis",
    "VAL-MED-SNOMED-318225005": "cod lactulose"
  },
  by_name: {},
  concepts: {
    hemodialysis: { name: "hemodialysis", buckets: {} },
    "cod lactulose": { name: "cod lactulose", buckets: {} }
  }
};

describe("§7.2 anchor key families", () => {
  it("resolves CPT- and HCPCS-coded procedures via VAL-PROC anchors", async () => {
    setAssociationsForTest({ bundle: bundle as never });
    const cpt = await resolveGroupConcept(
      { groupId: "p1", patientFriendlyName: "Hemodialysis", resourceIds: ["r1"], resourceTypes: ["Procedure"], confidence: 1, reason: "", fallback: false },
      [record({ id: "p1", resourceType: "Procedure", codingKeys: ["cpt:90935"] })]
    );
    expect(cpt.conceptKey).toBe("hemodialysis");
    expect(cpt.resolvedVia).toBe("VAL-PROC-CPT-90935");

    const hcpcs = await resolveGroupConcept(
      { groupId: "p2", patientFriendlyName: "Dialysis", resourceIds: ["r2"], resourceTypes: ["Procedure"], confidence: 1, reason: "", fallback: false },
      [record({ id: "r2", resourceType: "Procedure", codingKeys: ["hcpcs:G0257"] })]
    );
    expect(hcpcs.conceptKey).toBe("hemodialysis");
    expect(hcpcs.resolvedVia).toBe("VAL-PROC-HCPCS-G0257");
    setAssociationsForTest(null);
  });

  it("resolves SNOMED-coded medications via VAL-MED anchors after RxNorm misses", async () => {
    setAssociationsForTest({ bundle: bundle as never });
    const med = await resolveGroupConcept(
      { groupId: "m1", patientFriendlyName: "Lactulose", resourceIds: ["r3"], resourceTypes: ["MedicationRequest"], confidence: 1, reason: "", fallback: false },
      [record({ id: "r3", resourceType: "MedicationRequest", codingKeys: ["snomed:318225005"] })]
    );
    expect(med.conceptKey).toBe("cod lactulose");
    expect(med.resolvedVia).toBe("VAL-MED-SNOMED-318225005");
    setAssociationsForTest(null);
  });
});
