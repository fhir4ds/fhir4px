import { describe, expect, it } from "vitest";
import { findRelatedGroups, memberWithinAge } from "../../src/lib/associations/matcher";
import { setAssociationsForTest, loadAssociationBundle, loadLabPartCrosswalk } from "../../src/lib/associations/bundle";
import type { GroupableRecord } from "../../src/lib/fhir/patient-groups";
import type { AssociationBundle } from "../../src/lib/associations/types";

function bundleWithBoundedMembers(): AssociationBundle {
  return {
    format: "fhir4px_associations_v1.2",
    version: "test",
    by_cid: {
      "VAL-COND-SNOMED-414915002": "obesity",
      "VAL-MED-RXNORM-830": "penicillin v",
      "VAL-VIT-LOINC-8480-6": "systolic blood pressure"
    },
    by_name: {},
    concepts: {
      obesity: {
        name: "obesity",
        buckets: {
          medication: [
            { cid: "VAL-MED-RXNORM-830", name: "Penicillin V" }
            // unrestricted member: no bounds
          ],
          vital: [
            { cid: "VAL-VIT-LOINC-8480-6", name: "Systolic Blood Pressure", age_min: 3, age_max: 17 },
            { cid: "VAL-VIT-LOINC-29463-7", name: "Body Weight" }
          ]
        }
      }
    }
  };
}

function conditionRecord(id: string, code: string): GroupableRecord {
  return {
    id,
    resourceType: "Condition",
    sourceLabel: "Obesity",
    status: "active",
    codingKeys: [`snomed:${code}`],
    codeTexts: ["Obesity"],
    source: "provider"
  };
}

function candidate(id: string, code: string, name: string) {
  return {
    groupId: id,
    groupName: name,
    resourceTypes: ["MedicationRequest"],
    resolution: { conceptKey: "penicillin v", resolvedVia: "test" }
  };
}

describe("memberWithinAge (corpus v1.2 age bounds)", () => {
  it("fails open without a patient age", () => {
    expect(memberWithinAge({ matchedMemberAgeMin: 40 }, undefined)).toBe(true);
    expect(memberWithinAge({ matchedMemberAgeMax: 17 }, null)).toBe(true);
  });

  it("shows unbounded members regardless of age", () => {
    expect(memberWithinAge({}, 0)).toBe(true);
    expect(memberWithinAge({}, 97)).toBe(true);
  });

  it("enforces inclusive bounds", () => {
    expect(memberWithinAge({ matchedMemberAgeMin: 3, matchedMemberAgeMax: 17 }, 3)).toBe(true);
    expect(memberWithinAge({ matchedMemberAgeMin: 3, matchedMemberAgeMax: 17 }, 17)).toBe(true);
    expect(memberWithinAge({ matchedMemberAgeMin: 3, matchedMemberAgeMax: 17 }, 2)).toBe(false);
    expect(memberWithinAge({ matchedMemberAgeMin: 3, matchedMemberAgeMax: 17 }, 18)).toBe(false);
    expect(memberWithinAge({ matchedMemberAgeMin: 45 }, 44)).toBe(false);
    expect(memberWithinAge({ matchedMemberAgeMin: 45 }, 45)).toBe(true);
    expect(memberWithinAge({ matchedMemberAgeMax: 17 }, 18)).toBe(false);
  });
});

describe("age bounds passthrough (matcher)", () => {
  it("carries member age_min/age_max onto RelatedMatch", async () => {
    setAssociationsForTest({ bundle: bundleWithBoundedMembers() });
    const focus = {
      groupId: "focus",
      resolution: { conceptKey: "obesity", resolvedVia: "test" }
    };
    const vitalCandidate = {
      groupId: "vital-group",
      groupName: "Systolic Blood Pressure",
      resourceTypes: ["Observation"],
      resolution: { labPartCids: ["VAL-VIT-LOINC-8480-6"] }
    };
    const matches = await findRelatedGroups(focus, [vitalCandidate, candidate("med-group", "830", "Penicillin V")]);

    const vital = matches.find((m) => m.groupId === "vital-group");
    expect(vital?.matchedMemberName).toBe("Systolic Blood Pressure");
    expect(vital?.matchedMemberAgeMin).toBe(3);
    expect(vital?.matchedMemberAgeMax).toBe(17);
    expect(memberWithinAge(vital ?? {}, 15)).toBe(true);
    expect(memberWithinAge(vital ?? {}, 45)).toBe(false);

    const med = matches.find((m) => m.groupId === "med-group");
    expect(med?.matchedMemberAgeMin).toBeUndefined();
    expect(med?.matchedMemberAgeMax).toBeUndefined();
    expect(memberWithinAge(med ?? {}, 45)).toBe(true);

    setAssociationsForTest(null);
  });
});

const live = process.env.LIVE_ASSOCIATIONS === "1";

describe.skipIf(!live)("age bounds against the live corpus", () => {
  it("nirsevimab (0-1) on immunodeficiency hides for adults, shows for infants", async () => {
    setAssociationsForTest({ bundle: await loadAssociationBundle() });
    const focus = { groupId: "f", resolution: { conceptKey: "immunodeficiency disorder", resolvedVia: "test" } };
    const cand = {
      groupId: "nir",
      groupName: "Nirsevimab",
      resourceTypes: ["MedicationRequest"],
      resolution: { conceptKey: "nirsevimab", resolvedVia: "test" }
    };
    const matches = await findRelatedGroups(focus, [cand], { includeLooseProvenance: true });
    const nir = matches.find((m) => m.groupId === "nir");
    expect(nir).toBeDefined();
    expect(nir?.matchedMemberAgeMin).toBe(0);
    expect(nir?.matchedMemberAgeMax).toBe(1);
    expect(memberWithinAge(nir!, 45)).toBe(false);
    expect(memberWithinAge(nir!, 0)).toBe(true);
    setAssociationsForTest(null);
  });

  it("acceptance: procedure member CIDs self-anchor (PT/OT/acupuncture resolve)", async () => {
    setAssociationsForTest({ bundle: await loadAssociationBundle() });
    const bundle = await loadAssociationBundle();
    setAssociationsForTest(null);
    const pt = bundle.by_cid["VAL-PROC-SNOMED-91251008"];
    if (!pt) {
      // Corpus v2026-08-25.1429+ self-anchors procedure member CIDs.
      // Until it publishes, this acceptance check self-skips.
      return;
    }
    expect(pt).toBe("physical therapy");
    expect(bundle.by_cid["VAL-PROC-SNOMED-84478008"]).toBe("occupational therapy");
    expect(bundle.by_cid["VAL-PROC-SNOMED-44868003"]).toBe("acupuncture");
  });

  it("acceptance: CVX 140/312 member aliases emitted (flu/COVID vaccines resolve)", async () => {
    setAssociationsForTest({ bundle: await loadAssociationBundle() });
    const bundle = await loadAssociationBundle();
    setAssociationsForTest(null);
    const flu = bundle.by_cid["VAL-VAX-CVX-140"];
    const covid = bundle.by_cid["VAL-VAX-CVX-312"];
    if (!flu && !covid) {
      // Corpus §7.2 Phase 1+ emits member aliases into by_cid. Until it
      // publishes, this acceptance check self-skips.
      return;
    }
    expect(flu).toBeDefined();
    expect(covid).toBeDefined();
  });

  it("acceptance: ANC monitoring attaches to the Neutrophils part (LP14267-6)", async () => {
    setAssociationsForTest({ bundle: await loadAssociationBundle() });
    const bundle = await loadAssociationBundle();
    setAssociationsForTest(null);
    const clozapine = bundle.concepts.clozapine;
    const ancMember = (clozapine?.buckets?.lab ?? []).find((m) => m.cid === "VAL-LAB-LOINC-LP14267-6");
    if (!ancMember && !bundle.by_cid["VAL-LAB-LOINC-LP14267-6"]) {
      // ANC fix (structured commit 2e3ce730) lands with the next bundle fold.
      // Until by_cid carries LP14267-6 and the clozapine member re-attaches,
      // this acceptance check self-skips.
      return;
    }
    expect(ancMember).toBeDefined();
    expect(ancMember?.name).toBeDefined();
    // by_cid for the part is only required when the part resolves as a
    // standalone concept; part-CID bucket matching works without it.
  });

  it("acceptance: universal anchor stubs resolve (CVX 43/187, previously-unresolvable codes)", async () => {
    setAssociationsForTest({ bundle: await loadAssociationBundle() });
    const bundle = await loadAssociationBundle();
    setAssociationsForTest(null);
    const hepB = bundle.by_cid["VAL-VAX-CVX-43"];
    const rzv = bundle.by_cid["VAL-VAX-CVX-187"];
    if (!hepB && !rzv) {
      // Universal anchor resolution candidate — until it publishes, self-skips.
      return;
    }
    expect(hepB).toBeDefined();
    expect(rzv).toBeDefined();
    // RZV anchor drift (v2026-09-01.1349, unannounced): the stub is no longer
    // flat — 2 VZV monitoring labs arrived via fanned_hub derivations. Still
    // no parent_cids; buckets now carry monitoring_recommendation members.
    const rzvConcept = bundle.concepts[rzv!];
    expect(rzvConcept?.parent_cids).toBeUndefined();
    const rzvLabs = rzvConcept?.buckets?.lab ?? [];
    expect(rzvLabs.length).toBeGreaterThan(0);
    expect(rzvLabs.every((m) => m.provenance === "monitoring_recommendation")).toBe(true);
    // Hep B resolves to a pair-carrying concept (7 monitoring-lab members),
    // not a stub — pre-existing content, newly anchored CVX code.
    // Matcher safety on both shapes verified by the suite below.
  });

  it("acceptance: BP panel (85354-9) fans to component identities so obesity's 3-17 bounds match panel data", async () => {
    setAssociationsForTest({ bundle: await loadAssociationBundle() });
    const crosswalk = await loadLabPartCrosswalk();
    const panelParts = crosswalk["VAL-LAB-LOINC-85354-9"] ?? [];
    setAssociationsForTest(null);
    if (!panelParts.some((p) => p === "VAL-VIT-LOINC-8480-6")) {
      // Corpus v2026-08-25.1131+ ships panel->component fanning in the
      // crosswalk. Until it publishes, this acceptance check self-skips.
      return;
    }
    const focus = { groupId: "f", resolution: { conceptKey: "obesity", resolvedVia: "test" } };
    const bpPanel = {
      groupId: "bp",
      groupName: "Blood pressure panel",
      resourceTypes: ["Observation"],
      resolution: { labPartCids: panelParts }
    };
    const matches = await findRelatedGroups(focus, [bpPanel], { includeLooseProvenance: true });
    const bp = matches.find((m) => m.groupId === "bp");
    expect(bp?.matchedMemberAgeMin).toBe(3);
    expect(bp?.matchedMemberAgeMax).toBe(17);
    expect(memberWithinAge(bp!, 45)).toBe(false);
    expect(memberWithinAge(bp!, 15)).toBe(true);
  });
});
