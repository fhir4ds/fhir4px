/**
 * Relationship helpers for priority scoring.
 *
 * Two sources of "related to condition":
 *   1. Relationship cache (lab↔condition, source = ObservationGroup.associateConditionGroup)
 *   2. Deterministic condition-medication lookup (built from public/terminology/
 *      condition_medication_relationships.json)
 *
 * For v1 we keep the API surface narrow: condition→labs, condition→meds,
 * lab→conditions, med→conditions, plus a "is this lab claimed by any condition"
 * check used by the dedup rule.
 */

import type {
  GroupableRecord,
  PatientFriendlyGroup
} from "../fhir/patient-groups";
import type { RelationshipCacheRecord } from "../fhir/relationship-cache";
import { relationshipGroupKey } from "../fhir/relationships";

/**
 * Find lab/vital group IDs related to a condition group via the cache.
 * Direction: cache entries have source=lab, target=condition. We reverse.
 */
export function labGroupsRelatedToCondition(
  conditionGroup: PatientFriendlyGroup,
  cache: RelationshipCacheRecord | null
): Set<string> {
  const result = new Set<string>();
  if (!cache) return result;
  const conditionKey = relationshipGroupKey(conditionGroup);
  for (const entry of cache.entries) {
    if (entry.relationship === "none") continue;
    if (entry.targetGroupId !== conditionKey) continue;
    if (entry.sourceResourceType !== "Observation") continue;
    result.add(entry.sourceGroupId);
  }
  return result;
}

/**
 * Find condition group IDs related to a lab/vital group via the cache.
 * Direction: cache entries have source=lab, target=condition. Direct lookup.
 */
export function conditionGroupsRelatedToLab(
  labGroup: PatientFriendlyGroup,
  cache: RelationshipCacheRecord | null
): Set<string> {
  const result = new Set<string>();
  if (!cache) return result;
  const labKey = relationshipGroupKey(labGroup);
  for (const entry of cache.entries) {
    if (entry.relationship === "none") continue;
    if (entry.sourceGroupId !== labKey) continue;
    if (entry.targetResourceType !== "Condition") continue;
    result.add(entry.targetGroupId);
  }
  return result;
}

/**
 * Find medication group IDs related to a condition via the deterministic
 * condition-medication lookup. Iterates all medication groups and checks
 * whether any of their source records' ingredients match the condition.
 *
 * `findRelatedConditionForMed` is a thin wrapper over the deterministic
 * lookup table that returns condition names. Caller pre-builds the med→
 * conditions map once and passes it in to avoid repeating work.
 */
export function medGroupsRelatedToCondition(
  conditionGroup: PatientFriendlyGroup,
  medToConditions: Map<string, Set<string>>
): Set<string> {
  const result = new Set<string>();
  const conditionName = conditionGroup.patientFriendlyName.toLowerCase();
  for (const [medGroupId, conditions] of medToConditions) {
    for (const c of conditions) {
      if (c.toLowerCase() === conditionName) {
        result.add(medGroupId);
        break;
      }
    }
  }
  return result;
}

/**
 * Find condition group IDs related to a medication via the deterministic
 * lookup. Inverse of `medGroupsRelatedToCondition`.
 */
export function conditionGroupsRelatedToMed(
  medGroup: PatientFriendlyGroup,
  medToConditions: Map<string, Set<string>>,
  conditionGroups: PatientFriendlyGroup[]
): Set<string> {
  const result = new Set<string>();
  const conditions = medToConditions.get(relationshipGroupKey(medGroup));
  if (!conditions || conditions.size === 0) return result;
  const conditionNames = [...conditions].map((c) => c.toLowerCase());
  for (const cg of conditionGroups) {
    if (conditionNames.includes(cg.patientFriendlyName.toLowerCase())) {
      result.add(relationshipGroupKey(cg));
    }
  }
  return result;
}

/**
 * Determine whether a lab group is "claimed" by any condition: i.e., a
 * relationship exists in the cache AND the lab has a value within LAB_RECENCY_DAYS.
 * Used by the Summary's dedup rule — claimed labs are filtered from the
 * standalone labs section and shown inline on the condition card instead.
 */
export function isLabClaimedByAnyCondition(
  labGroup: PatientFriendlyGroup,
  cache: RelationshipCacheRecord | null,
  latestLabDateByGroupId: Map<string, string>,
  recencyDays: number
): boolean {
  if (!cache) return false;
  const labKey = relationshipGroupKey(labGroup);
  let relatedToAnyCondition = false;
  for (const entry of cache.entries) {
    if (entry.sourceGroupId === labKey && entry.targetResourceType === "Condition" && entry.relationship !== "none") {
      relatedToAnyCondition = true;
      break;
    }
  }
  if (!relatedToAnyCondition) return false;
  const latestDate = latestLabDateByGroupId.get(labKey);
  if (!latestDate) return false;
  const parsed = new Date(latestDate);
  if (Number.isNaN(parsed.getTime())) return false;
  const ageDays = (Date.now() - parsed.getTime()) / (24 * 60 * 60 * 1000);
  return ageDays >= 0 && ageDays <= recencyDays;
}

/**
 * Build a med-group → condition-names map keyed by relationshipGroupKey(medGroup).
 * Caller passes in the deterministic lookup function (already loaded elsewhere)
 * to keep this module decoupled from the FHIR layer. The lookup may be async
 * (the underlying reverse index loads from a JSON asset on first call).
 */
export async function buildMedGroupToConditionsMap(
  medGroups: PatientFriendlyGroup[],
  recordsByGroupId: Map<string, GroupableRecord[]>,
  findConditionsForMed: (med: { name: string; ingredients?: string[]; codingKeys?: string[] }) => Promise<string[]> | string[]
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  for (const medGroup of medGroups) {
    const records = recordsByGroupId.get(medGroup.groupId) ?? [];
    const conditions = new Set<string>();
    for (const record of records) {
      const names = await findConditionsForMed({
        name: record.sourceLabel,
        ingredients: record.ingredients,
        codingKeys: record.codingKeys
      });
      for (const c of names) conditions.add(c);
    }
    if (conditions.size > 0) {
      result.set(relationshipGroupKey(medGroup), conditions);
    }
  }
  return result;
}
