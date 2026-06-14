import { describe, expect, it } from "vitest";
import { dedupeGroupedRecords, recordQualityScore } from "../../src/lib/fhir/dedupe";
import type { GroupableRecord } from "../../src/lib/fhir/patient-groups";

function record(overrides: Partial<GroupableRecord> & Pick<GroupableRecord, "id" | "resourceType" | "sourceLabel">): GroupableRecord {
  return {
    source: "provider",
    portalSourceId: "portal-a",
    portalSourceName: "Portal A",
    ...overrides
  };
}

describe("FHIR record deduplication", () => {
  it("collapses matching observations from different portals when value and time match", () => {
    const clusters = dedupeGroupedRecords([
      record({
        id: "a1c-portal-a",
        resourceType: "Observation",
        sourceLabel: "Hemoglobin A1c",
        categoryCode: "laboratory",
        codingKeys: ["loinc:4548-4"],
        codeTexts: ["Hemoglobin A1c"],
        date: "2024-01-01T09:30:15Z",
        displayValue: "7.2 %",
        canonicalValue: 7.2,
        canonicalUnit: "%"
      }),
      record({
        id: "a1c-portal-b",
        resourceType: "Observation",
        sourceLabel: "HbA1c",
        portalSourceId: "portal-b",
        portalSourceName: "Portal B",
        categoryCode: "laboratory",
        codingKeys: ["loinc:4548-4"],
        codeTexts: ["HbA1c"],
        date: "2024-01-01T13:30:15Z",
        displayValue: "7.2 %",
        canonicalValue: 7.2,
        canonicalUnit: "%"
      })
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      duplicateCount: 1,
      matchReason: "Same concept, same value/unit, and matching time within 4 hours."
    });
    expect(clusters[0].records.map((candidate) => candidate.id).sort()).toEqual(["a1c-portal-a", "a1c-portal-b"]);
  });

  it("does not collapse observations with different values on the same day", () => {
    const clusters = dedupeGroupedRecords([
      record({
        id: "sbp-portal-a",
        resourceType: "Observation",
        sourceLabel: "Systolic blood pressure",
        portalSourceId: "portal-a",
        codingKeys: ["loinc:8480-6"],
        date: "2024-01-01T09:30:00Z",
        displayValue: "118 mmHg",
        canonicalValue: 118,
        canonicalUnit: "mmHg"
      }),
      record({
        id: "sbp-portal-b",
        resourceType: "Observation",
        sourceLabel: "Systolic blood pressure",
        portalSourceId: "portal-b",
        codingKeys: ["loinc:8480-6"],
        date: "2024-01-01T09:31:00Z",
        displayValue: "126 mmHg",
        canonicalValue: 126,
        canonicalUnit: "mmHg"
      })
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters.every((cluster) => cluster.duplicateCount === 0)).toBe(true);
  });

  it("does not collapse records from the same portal", () => {
    const clusters = dedupeGroupedRecords([
      record({
        id: "imm-1",
        resourceType: "Immunization",
        sourceLabel: "MMR",
        portalSourceId: "portal-a",
        codingKeys: ["cvx:03"],
        date: "2018-01-01"
      }),
      record({
        id: "imm-2",
        resourceType: "Immunization",
        sourceLabel: "MMR II",
        portalSourceId: "portal-a",
        codingKeys: ["cvx:03"],
        date: "2018-01-01"
      })
    ]);

    expect(clusters).toHaveLength(2);
  });

  it("uses the highest quality matching record as canonical", () => {
    const sparse = record({
      id: "condition-sparse",
      resourceType: "Condition",
      sourceLabel: "Diabetes",
      portalSourceId: "portal-a",
      date: "2024-01-01"
    });
    const richer = record({
      id: "condition-rich",
      resourceType: "Condition",
      sourceLabel: "Type 2 diabetes mellitus",
      portalSourceId: "portal-b",
      portalSourceName: "Portal B",
      status: "active",
      codingKeys: ["snomed:44054006"],
      codeTexts: ["Type 2 diabetes mellitus"],
      codeCodings: [{ code: "44054006", display: "Type 2 diabetes mellitus" }],
      date: "2024-01-01"
    });

    const clusters = dedupeGroupedRecords([sparse, richer]);

    expect(clusters).toHaveLength(1);
    expect(recordQualityScore(richer)).toBeGreaterThan(recordQualityScore(sparse));
    expect(clusters[0].canonical.id).toBe("condition-rich");
  });
});
