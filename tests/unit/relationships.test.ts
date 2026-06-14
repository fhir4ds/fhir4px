import { describe, expect, it } from "vitest";
import {
  buildExplicitRecordRelationships,
  conditionRecordKeysLinkedFromObservation,
  relationshipGroupKey,
  relationshipMapByRecordKey,
  relationshipRecordKey
} from "../../src/lib/fhir/relationships";
import {
  emptyRelationshipCache,
  relationshipCacheEntry,
  relationshipEntriesForSourceGroup,
  upsertRelationshipCacheEntries
} from "../../src/lib/fhir/relationship-cache";
import type { PatientFriendlyGroup } from "../../src/lib/fhir/patient-groups";
import type { FhirResource } from "../../src/lib/smart/data";

describe("FHIR relationship extraction", () => {
  it("creates scoped explicit links for local FHIR references", () => {
    const resources: FhirResource[] = [
      { resourceType: "Observation", id: "obs-1", encounter: { reference: "Encounter/enc-1" } },
      { resourceType: "Encounter", id: "enc-1", reasonReference: [{ reference: "Condition/cond-1" }] },
      { resourceType: "Condition", id: "cond-1" },
      { resourceType: "DiagnosticReport", id: "report-1", result: [{ reference: "Observation/obs-1" }] }
    ];

    const relationships = buildExplicitRecordRelationships([{ sourceId: "sandbox", resources }]);

    expect(relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRecordKey: relationshipRecordKey("Observation", "sandbox:obs-1"),
          targetRecordKey: relationshipRecordKey("Encounter", "sandbox:enc-1"),
          kind: "encounter"
        }),
        expect.objectContaining({
          sourceRecordKey: relationshipRecordKey("Encounter", "sandbox:enc-1"),
          targetRecordKey: relationshipRecordKey("Condition", "sandbox:cond-1"),
          kind: "reason"
        }),
        expect.objectContaining({
          sourceRecordKey: relationshipRecordKey("DiagnosticReport", "sandbox:report-1"),
          targetRecordKey: relationshipRecordKey("Observation", "sandbox:obs-1"),
          kind: "result"
        })
      ])
    );
  });

  it("derives condition links from observation encounter references", () => {
    const resources: FhirResource[] = [
      { resourceType: "Observation", id: "obs-1", encounter: { reference: "Encounter/enc-1" } },
      { resourceType: "Encounter", id: "enc-1", reasonReference: [{ reference: "Condition/cond-1" }] },
      { resourceType: "Condition", id: "cond-1" }
    ];

    const relationships = buildExplicitRecordRelationships([{ sourceId: "sandbox", resources }]);
    const relationshipsByRecordKey = relationshipMapByRecordKey(relationships);

    expect(
      conditionRecordKeysLinkedFromObservation(
        relationshipRecordKey("Observation", "sandbox:obs-1"),
        relationshipsByRecordKey
      )
    ).toEqual([relationshipRecordKey("Condition", "sandbox:cond-1")]);
  });

  it("derives condition links through diagnostic report encounter context", () => {
    const resources: FhirResource[] = [
      { resourceType: "Observation", id: "obs-1" },
      {
        resourceType: "DiagnosticReport",
        id: "report-1",
        result: [{ reference: "Observation/obs-1" }],
        encounter: { reference: "Encounter/enc-1" }
      },
      { resourceType: "Encounter", id: "enc-1", reasonReference: [{ reference: "Condition/cond-1" }] },
      { resourceType: "Condition", id: "cond-1" }
    ];

    const relationships = buildExplicitRecordRelationships([{ sourceId: "sandbox", resources }]);
    const relationshipsByRecordKey = relationshipMapByRecordKey(relationships);

    expect(
      conditionRecordKeysLinkedFromObservation(
        relationshipRecordKey("Observation", "sandbox:obs-1"),
        relationshipsByRecordKey
      )
    ).toEqual([relationshipRecordKey("Condition", "sandbox:cond-1")]);
  });

  it("ignores references to resources that are not available locally", () => {
    const relationships = buildExplicitRecordRelationships([
      {
        sourceId: "sandbox",
        resources: [{ resourceType: "Observation", id: "obs-1", encounter: { reference: "Encounter/missing" } }]
      }
    ]);

    expect(relationships).toHaveLength(0);
  });
});

describe("relationship cache", () => {
  it("stores local model lab-condition suggestions by group", () => {
    const labGroup: PatientFriendlyGroup = {
      groupId: "observation-a1c",
      patientFriendlyName: "Hemoglobin A1c",
      resourceIds: ["obs-1"],
      resourceTypes: ["Observation"],
      observationBucket: "labs",
      confidence: 0.9,
      reason: "test",
      fallback: false
    };
    const conditionGroup: PatientFriendlyGroup = {
      groupId: "condition-diabetes",
      patientFriendlyName: "Type 2 Diabetes",
      resourceIds: ["cond-1"],
      resourceTypes: ["Condition"],
      confidence: 0.9,
      reason: "test",
      fallback: false
    };
    const entry = relationshipCacheEntry({
      sourceGroupId: relationshipGroupKey(labGroup),
      targetGroupId: relationshipGroupKey(conditionGroup),
      sourceResourceType: "Observation",
      targetResourceType: "Condition",
      relationship: "monitoring_marker",
      confidence: 0.84,
      fallback: false,
      model: "test-model"
    });

    const cache = upsertRelationshipCacheEntries(emptyRelationshipCache(), [entry]);

    expect(relationshipEntriesForSourceGroup(cache, "ObservationGroup.associateConditionGroup", relationshipGroupKey(labGroup))).toEqual([
      expect.objectContaining({
        targetGroupId: relationshipGroupKey(conditionGroup),
        relationship: "monitoring_marker",
        confidence: 0.84
      })
    ]);
  });

  it("stores local model no-association markers by lab group", () => {
    const labGroup: PatientFriendlyGroup = {
      groupId: "observation-lipid-panel",
      patientFriendlyName: "Lipid Panel",
      resourceIds: ["obs-1"],
      resourceTypes: ["Observation"],
      observationBucket: "labs",
      confidence: 0.9,
      reason: "test",
      fallback: false
    };
    const entry = relationshipCacheEntry({
      sourceGroupId: relationshipGroupKey(labGroup),
      targetGroupId: "__none__",
      sourceResourceType: "Observation",
      targetResourceType: "Condition",
      relationship: "none",
      confidence: 0,
      fallback: true,
      model: "test-model"
    });

    const cache = upsertRelationshipCacheEntries(emptyRelationshipCache(), [entry]);

    expect(relationshipEntriesForSourceGroup(cache, "ObservationGroup.associateConditionGroup", relationshipGroupKey(labGroup))).toEqual([
      expect.objectContaining({
        targetGroupId: "__none__",
        relationship: "none",
        confidence: 0
      })
    ]);
  });
});
