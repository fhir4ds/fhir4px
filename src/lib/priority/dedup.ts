/**
 * Deduplication helper for the Summary tab.
 *
 * Labs "claimed" by a condition (relationship exists AND value within
 * LAB_RECENCY_DAYS) are filtered from the standalone labs section. Their
 * most recent value is shown inline on the owning condition card instead.
 */

import type { PatientFriendlyGroup } from "../fhir/patient-groups";
import type { RelationshipCacheRecord } from "../fhir/relationship-cache";
import { relationshipGroupKey } from "../fhir/relationships";
import { LAB_RECENCY_DAYS } from "./scoring";
import { isLabClaimedByAnyCondition, labGroupsRelatedToCondition } from "./relationships";

export interface ClaimedLabsInput {
  labGroups: PatientFriendlyGroup[];
  conditionGroups: PatientFriendlyGroup[];
  cache: RelationshipCacheRecord | null;
  latestLabDateByGroupId: Map<string, string>;
  recencyDays?: number;
}

/**
 * Returns the set of lab group IDs (by relationshipGroupKey) that are claimed
 * by at least one condition. Used to filter the standalone labs section.
 */
export function computeClaimedLabGroupKeys(inputs: ClaimedLabsInput): Set<string> {
  const recencyDays = inputs.recencyDays ?? LAB_RECENCY_DAYS;
  const claimed = new Set<string>();
  for (const labGroup of inputs.labGroups) {
    if (
      isLabClaimedByAnyCondition(
        labGroup,
        inputs.cache,
        inputs.latestLabDateByGroupId,
        recencyDays
      )
    ) {
      claimed.add(relationshipGroupKey(labGroup));
    }
  }
  return claimed;
}

/**
 * For a given condition group, find the lab group that should be shown inline
 * (most recent related lab within recency window). Returns null if no related
 * lab has a recent value.
 */
export function pickMostRecentClaimedLab(
  conditionGroup: PatientFriendlyGroup,
  labGroups: PatientFriendlyGroup[],
  cache: RelationshipCacheRecord | null,
  latestLabDateByGroupId: Map<string, string>,
  recencyDays?: number
): PatientFriendlyGroup | null {
  const related = labGroupsRelatedToCondition(conditionGroup, cache);
  if (related.size === 0) return null;
  const recency = recencyDays ?? LAB_RECENCY_DAYS;
  let best: PatientFriendlyGroup | null = null;
  let bestDate = 0;
  for (const labGroup of labGroups) {
    const key = relationshipGroupKey(labGroup);
    if (!related.has(key)) continue;
    const dateStr = latestLabDateByGroupId.get(key);
    if (!dateStr) continue;
    const parsed = new Date(dateStr);
    if (Number.isNaN(parsed.getTime())) continue;
    const ageDays = (Date.now() - parsed.getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays < 0 || ageDays > recency) continue;
    const timestamp = parsed.getTime();
    if (timestamp > bestDate) {
      bestDate = timestamp;
      best = labGroup;
    }
  }
  return best;
}
