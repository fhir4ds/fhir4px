import type {
  AllergyClassification,
  EncounterTypeClassification,
  EncounterVisitClassification,
  ObservationCategoryClassification
} from "./local-classification";
import type { GroupableResourceType } from "./patient-groups";

export const CLASSIFICATION_CACHE_ID = "local-classification-v1";
export const CLASSIFICATION_CACHE_VERSION = 1;

export const CLASSIFICATION_TRANSFORM_VERSIONS = {
  "AllergyIntolerance.classifyAllergy": 1,
  "Encounter.classifyClass": 1,
  "Encounter.classifyType": 1,
  "Observation.classifyCategory": 1
} as const;

export type ClassificationTransform = keyof typeof CLASSIFICATION_TRANSFORM_VERSIONS;
export type ClassificationResult =
  | AllergyClassification
  | EncounterTypeClassification
  | EncounterVisitClassification
  | ObservationCategoryClassification;

export interface ClassificationCacheEntry {
  compactRecordId: string;
  resourceType: GroupableResourceType;
  transform: ClassificationTransform;
  transformVersion: number;
  model: string;
  result: ClassificationResult;
  updatedAt: number;
}

export interface ClassificationCacheRecord {
  id: typeof CLASSIFICATION_CACHE_ID;
  version: typeof CLASSIFICATION_CACHE_VERSION;
  entries: ClassificationCacheEntry[];
  updatedAt: number;
}

export function emptyClassificationCache(now = Date.now()): ClassificationCacheRecord {
  return {
    id: CLASSIFICATION_CACHE_ID,
    version: CLASSIFICATION_CACHE_VERSION,
    entries: [],
    updatedAt: now
  };
}

export function classificationCacheKey(
  transform: ClassificationTransform,
  compactRecordId: string,
  model: string
): string {
  return `${transform}:${CLASSIFICATION_TRANSFORM_VERSIONS[transform]}:${model}:${compactRecordId}`;
}

export function classificationCacheByKey(cache: ClassificationCacheRecord): Map<string, ClassificationCacheEntry> {
  return new Map(
    cache.entries.map((entry) => [
      classificationCacheKey(entry.transform, entry.compactRecordId, entry.model),
      entry
    ])
  );
}

export function classificationEntriesForRecord(
  cache: ClassificationCacheRecord,
  transform: ClassificationTransform,
  compactRecordId: string
): ClassificationCacheEntry[] {
  const version = CLASSIFICATION_TRANSFORM_VERSIONS[transform];
  return cache.entries.filter(
    (entry) =>
      entry.transform === transform &&
      entry.transformVersion === version &&
      entry.compactRecordId === compactRecordId
  );
}

export function preferredClassificationEntry(
  cache: ClassificationCacheRecord,
  transform: ClassificationTransform,
  compactRecordId: string
): ClassificationCacheEntry | undefined {
  const entries = classificationEntriesForRecord(cache, transform, compactRecordId);
  return entries.sort((left, right) => {
    const leftRank = left.model === "fhir_category" ? 0 : left.model === "local_model" ? 1 : left.model === "deterministic" ? 2 : 3;
    const rightRank = right.model === "fhir_category" ? 0 : right.model === "local_model" ? 1 : right.model === "deterministic" ? 2 : 3;
    return leftRank - rightRank || right.updatedAt - left.updatedAt;
  })[0];
}

export function upsertClassificationCacheEntries(
  cache: ClassificationCacheRecord,
  entries: ClassificationCacheEntry[],
  now = Date.now()
): ClassificationCacheRecord {
  const byKey = classificationCacheByKey(cache);
  for (const entry of entries) {
    byKey.set(classificationCacheKey(entry.transform, entry.compactRecordId, entry.model), entry);
  }
  return {
    id: CLASSIFICATION_CACHE_ID,
    version: CLASSIFICATION_CACHE_VERSION,
    entries: [...byKey.values()].sort(
      (left, right) =>
        left.transform.localeCompare(right.transform) ||
        left.resourceType.localeCompare(right.resourceType) ||
        left.compactRecordId.localeCompare(right.compactRecordId) ||
        left.model.localeCompare(right.model)
    ),
    updatedAt: now
  };
}
