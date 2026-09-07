import { describe, expect, it } from "vitest";
import {
  collapsedFamilyLabel,
  collapseViaHubFamilies,
  groupRelatedSections,
  SAFETY_BUCKETS,
  sectionIdForBucket
} from "../../src/lib/associations/relatedDisplay";
import type { RelatedMatch } from "../../src/lib/associations/matcher";
import type { AssociationBucket } from "../../src/lib/associations/types";

function match(overrides: Partial<RelatedMatch> & { relationship: AssociationBucket; groupId: string }): RelatedMatch {
  return {
    groupName: "Group",
    matchedMemberName: "Member",
    ...overrides
  };
}

describe("related-records sections", () => {
  it("orders safety first, drops empty sections", () => {
    const sections = groupRelatedSections([
      match({ relationship: "lab", groupId: "g1" }),
      match({ relationship: "treats", groupId: "g2" }),
      match({ relationship: "adverse_effect", groupId: "g3" })
    ]);
    expect(sections.map((s) => s.id)).toEqual(["safety", "monitoring", "treatment"]);
    expect(sections.map((s) => s.label)).toEqual(["Safety", "Monitoring", "Treats & prevention"]);
  });

  it("every bucket maps to a section", () => {
    const buckets: AssociationBucket[] = [
      "lab",
      "vital",
      "procedure",
      "medication",
      "vaccine",
      "condition",
      "treats",
      "adverse_effect",
      "contraindicated_in",
      "interferes_with_test",
      "causes_abnormality",
      "screens_before",
      "antidote_for"
    ];
    for (const bucket of buckets) {
      expect(groupRelatedSections([match({ relationship: bucket, groupId: "g" })]).length).toBe(1);
    }
  });

  it("wave-2 buckets map to their sections (v2026-09-07.0118)", () => {
    expect(sectionIdForBucket("causes_abnormality")).toBe("safety");
    expect(sectionIdForBucket("screens_before")).toBe("monitoring");
    expect(sectionIdForBucket("antidote_for")).toBe("treatment");
  });

  it("empty input yields no sections", () => {
    expect(groupRelatedSections([])).toEqual([]);
  });
});

describe("viaHub family collapse", () => {
  const CMP = "Comprehensive Metabolic Panel";

  it("collapses same-hub monitoring matches into one chip with hidden members", () => {
    const { chips, collapsedHubNames } = collapseViaHubFamilies([
      match({ relationship: "lab", groupId: "g1", matchedMemberName: "Calcium", viaHubName: CMP }),
      match({ relationship: "lab", groupId: "g2", matchedMemberName: "Sodium", viaHubName: CMP }),
      match({ relationship: "lab", groupId: "g3", matchedMemberName: "Potassium", viaHubName: CMP })
    ]);
    expect(chips.length).toBe(1);
    expect(chips[0].match.matchedMemberName).toBe("Calcium");
    expect(chips[0].hidden.map((h) => h.matchedMemberName)).toEqual(["Sodium", "Potassium"]);
    expect(collapsedHubNames).toContain(CMP);
  });

  it("different hubs stay separate chips", () => {
    const { chips } = collapseViaHubFamilies([
      match({ relationship: "lab", groupId: "g1", viaHubName: CMP }),
      match({ relationship: "lab", groupId: "g2", viaHubName: "Complete Blood Count" })
    ]);
    expect(chips.length).toBe(2);
    expect(chips.every((c) => c.hidden.length === 0)).toBe(true);
  });

  it("never collapses safety matches even with a shared hub", () => {
    const { chips, collapsedHubNames } = collapseViaHubFamilies([
      match({ relationship: "adverse_effect", groupId: "g1", viaHubName: CMP }),
      match({ relationship: "adverse_effect", groupId: "g2", viaHubName: CMP })
    ]);
    expect(chips.length).toBe(2);
    expect(collapsedHubNames.size).toBe(0);
  });

  it("does not collapse treatment matches", () => {
    const { chips } = collapseViaHubFamilies([
      match({ relationship: "treats", groupId: "g1", viaHubName: CMP }),
      match({ relationship: "treats", groupId: "g2", viaHubName: CMP })
    ]);
    expect(chips.length).toBe(2);
  });

  it("chip keys are stable and unique per family", () => {
    const { chips } = collapseViaHubFamilies([
      match({ relationship: "lab", groupId: "g1", viaHubName: CMP }),
      match({ relationship: "lab", groupId: "g2", viaHubName: CMP }),
      match({ relationship: "lab", groupId: "g3" })
    ]);
    const keys = chips.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe(`g1:lab:${CMP}`);
  });

  it("collapsedFamilyLabel counts hidden members and names the hub", () => {
    const { chips } = collapseViaHubFamilies([
      match({ relationship: "lab", groupId: "g1", viaHubName: CMP }),
      match({ relationship: "lab", groupId: "g2", viaHubName: CMP }),
      match({ relationship: "lab", groupId: "g3", viaHubName: CMP })
    ]);
    expect(collapsedFamilyLabel(chips[0])).toBe(`+2 more via ${CMP}`);
  });
});

describe("safety bucket set", () => {
  it("matches the v1.4 safety-signal buckets plus wave-2 causes_abnormality", () => {
    expect(SAFETY_BUCKETS.has("adverse_effect")).toBe(true);
    expect(SAFETY_BUCKETS.has("contraindicated_in")).toBe(true);
    expect(SAFETY_BUCKETS.has("interferes_with_test")).toBe(true);
    expect(SAFETY_BUCKETS.has("causes_abnormality")).toBe(true);
    expect(SAFETY_BUCKETS.has("treats")).toBe(false);
    expect(sectionIdForBucket("adverse_effect")).toBe("safety");
    expect(sectionIdForBucket("vaccine")).toBe("also");
  });
});
