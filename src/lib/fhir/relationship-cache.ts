import type { GroupableResourceType } from "./patient-groups";
import type { SuggestedGroupRelationship, SuggestedGroupRelationshipKind } from "./relationships";

export const RELATIONSHIP_CACHE_ID = "local-relationships-v13";
export const RELATIONSHIP_CACHE_VERSION = 13;

export const RELATIONSHIP_TRANSFORM_VERSIONS = {
  "ObservationGroup.associateConditionGroup": 13
} as const;

export type RelationshipTransform = keyof typeof RELATIONSHIP_TRANSFORM_VERSIONS;

export interface RelationshipCacheEntry extends SuggestedGroupRelationship {
  transform: RelationshipTransform;
  transformVersion: number;
}

export interface RelationshipCacheRecord {
  id: typeof RELATIONSHIP_CACHE_ID;
  version: typeof RELATIONSHIP_CACHE_VERSION;
  entries: RelationshipCacheEntry[];
  updatedAt: number;
}

export function emptyRelationshipCache(now = Date.now()): RelationshipCacheRecord {
  return {
    id: RELATIONSHIP_CACHE_ID,
    version: RELATIONSHIP_CACHE_VERSION,
    entries: [],
    updatedAt: now
  };
}

export function relationshipCacheKey(entry: {
  transform: RelationshipTransform;
  sourceGroupId: string;
  targetGroupId: string;
  model: string;
}): string {
  return [
    entry.transform,
    RELATIONSHIP_TRANSFORM_VERSIONS[entry.transform],
    entry.model,
    entry.sourceGroupId,
    entry.targetGroupId
  ].join(":");
}

export function relationshipCacheByKey(cache: RelationshipCacheRecord): Map<string, RelationshipCacheEntry> {
  return new Map(cache.entries.map((entry) => [relationshipCacheKey(entry), entry]));
}

export function relationshipEntriesForSourceGroup(
  cache: RelationshipCacheRecord,
  transform: RelationshipTransform,
  sourceGroupId: string
): RelationshipCacheEntry[] {
  const version = RELATIONSHIP_TRANSFORM_VERSIONS[transform];
  return cache.entries.filter(
    (entry) =>
      entry.transform === transform &&
      entry.transformVersion === version &&
      entry.sourceGroupId === sourceGroupId
  );
}

export function upsertRelationshipCacheEntries(
  cache: RelationshipCacheRecord,
  entries: RelationshipCacheEntry[],
  now = Date.now()
): RelationshipCacheRecord {
  const byKey = relationshipCacheByKey(cache);
  for (const entry of entries) byKey.set(relationshipCacheKey(entry), entry);
  return {
    id: RELATIONSHIP_CACHE_ID,
    version: RELATIONSHIP_CACHE_VERSION,
    entries: [...byKey.values()].sort(
      (left, right) =>
        left.transform.localeCompare(right.transform) ||
        left.sourceResourceType.localeCompare(right.sourceResourceType) ||
        left.targetResourceType.localeCompare(right.targetResourceType) ||
        left.sourceGroupId.localeCompare(right.sourceGroupId) ||
        left.targetGroupId.localeCompare(right.targetGroupId)
    ),
    updatedAt: now
  };
}

export function relationshipCacheEntry(params: {
  sourceGroupId: string;
  targetGroupId: string;
  sourceResourceType: GroupableResourceType;
  targetResourceType: GroupableResourceType;
  relationship: SuggestedGroupRelationshipKind;
  confidence: number;
  fallback: boolean;
  model: string;
  now?: number;
}): RelationshipCacheEntry {
  return {
    transform: "ObservationGroup.associateConditionGroup",
    transformVersion: RELATIONSHIP_TRANSFORM_VERSIONS["ObservationGroup.associateConditionGroup"],
    sourceGroupId: params.sourceGroupId,
    targetGroupId: params.targetGroupId,
    sourceResourceType: params.sourceResourceType,
    targetResourceType: params.targetResourceType,
    relationship: params.relationship,
    confidence: params.confidence,
    fallback: params.fallback,
    model: params.model,
    updatedAt: params.now ?? Date.now()
  };
}
