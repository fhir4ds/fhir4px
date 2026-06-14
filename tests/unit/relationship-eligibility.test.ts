import { describe, expect, it } from "vitest";
import {
  completedObservationRecordsForRelationship,
  isCompletedObservationForRelationship,
  normalizedRelationshipStatus
} from "../../src/lib/fhir/relationship-eligibility";
import type { GroupableRecord } from "../../src/lib/fhir/patient-groups";

function observation(overrides: Partial<GroupableRecord> = {}): GroupableRecord {
  return {
    id: "obs-1",
    resourceType: "Observation",
    sourceLabel: "Glucose",
    status: "final",
    valueKind: "quantity",
    source: "provider",
    ...overrides
  };
}

describe("relationship eligibility", () => {
  it("normalizes status values for relationship checks", () => {
    expect(normalizedRelationshipStatus("Entered in Error")).toBe("entered-in-error");
    expect(normalizedRelationshipStatus("cancelled")).toBe("cancelled");
  });

  it("keeps completed observation statuses eligible", () => {
    expect(isCompletedObservationForRelationship(observation({ status: "final" }))).toBe(true);
    expect(isCompletedObservationForRelationship(observation({ status: "amended" }))).toBe(true);
    expect(isCompletedObservationForRelationship(observation({ status: "corrected" }))).toBe(true);
    expect(isCompletedObservationForRelationship(observation({ status: "completed" }))).toBe(true);
  });

  it("excludes observations that should not drive condition relationships", () => {
    expect(isCompletedObservationForRelationship(observation({ status: "cancelled" }))).toBe(false);
    expect(isCompletedObservationForRelationship(observation({ status: "entered-in-error" }))).toBe(false);
    expect(isCompletedObservationForRelationship(observation({ status: "preliminary" }))).toBe(false);
    expect(isCompletedObservationForRelationship(observation({ status: "final", valueKind: "absent" }))).toBe(false);
    expect(isCompletedObservationForRelationship(observation({ hidden: true }))).toBe(false);
    expect(isCompletedObservationForRelationship(observation({ inactiveOverlay: true }))).toBe(false);
  });

  it("filters a mixed record set to completed observations only", () => {
    expect(
      completedObservationRecordsForRelationship([
        observation({ id: "completed" }),
        observation({ id: "cancelled", status: "cancelled" }),
        { ...observation({ id: "condition" }), resourceType: "Condition" }
      ]).map((record) => record.id)
    ).toEqual(["completed"]);
  });
});
