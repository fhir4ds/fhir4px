import type { GroupableResourceType, PatientObservationBucket } from "./patient-groups";

export const GROUPING_CACHE_ID = "patient-friendly-grouping-v2";
export const GROUPING_CACHE_VERSION = 1;

export interface GroupingCacheEntry {
  compactRecordId: string;
  resourceType: GroupableResourceType;
  patientFriendlyName: string;
  observationBucket?: PatientObservationBucket;
  confidence: number;
  fallback: boolean;
  model: string;
  lookupSystem?: string;
  lookupCode?: string;
  canonicalSystem?: string;
  canonicalCode?: string;
  friendlySource?: string;
  matchType?: string;
  updatedAt: number;
}

export interface GroupingCacheRecord {
  id: typeof GROUPING_CACHE_ID;
  version: typeof GROUPING_CACHE_VERSION;
  entries: GroupingCacheEntry[];
  updatedAt: number;
}

export function emptyGroupingCache(now = Date.now()): GroupingCacheRecord {
  return {
    id: GROUPING_CACHE_ID,
    version: GROUPING_CACHE_VERSION,
    entries: [],
    updatedAt: now
  };
}

export function groupingCacheByCompactId(cache: GroupingCacheRecord): Map<string, GroupingCacheEntry> {
  return new Map(cache.entries.map((entry) => [entry.compactRecordId, entry]));
}

export function upsertGroupingCacheEntries(
  cache: GroupingCacheRecord,
  entries: GroupingCacheEntry[],
  now = Date.now()
): GroupingCacheRecord {
  const byId = groupingCacheByCompactId(cache);
  for (const entry of entries) byId.set(entry.compactRecordId, entry);
  return {
    id: GROUPING_CACHE_ID,
    version: GROUPING_CACHE_VERSION,
    entries: [...byId.values()].sort(
      (left, right) =>
        left.resourceType.localeCompare(right.resourceType) ||
        left.patientFriendlyName.localeCompare(right.patientFriendlyName) ||
        left.compactRecordId.localeCompare(right.compactRecordId)
    ),
    updatedAt: now
  };
}
