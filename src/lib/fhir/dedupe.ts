import type { GroupableRecord } from "./patient-groups";

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

export interface DedupedRecordCluster {
  id: string;
  canonical: GroupableRecord;
  records: GroupableRecord[];
  duplicateCount: number;
  qualityScore: number;
  matchReason?: string;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalized(value?: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasDateTime(value?: string): boolean {
  return Boolean(value && /t\d{2}:\d{2}/i.test(value));
}

function parsedTime(value?: string): number | null {
  if (!value) return null;
  const parsed = new Date(value);
  const time = parsed.getTime();
  return Number.isNaN(time) ? null : time;
}

function sameCalendarDate(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return left.slice(0, 10) === right.slice(0, 10);
}

function minuteSecondKey(value?: string): string | null {
  if (!value || !hasDateTime(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCMinutes()}:${parsed.getUTCSeconds()}`;
}

function withinFourHours(left?: string, right?: string): boolean {
  const leftTime = parsedTime(left);
  const rightTime = parsedTime(right);
  if (leftTime === null || rightTime === null) return false;
  return Math.abs(leftTime - rightTime) <= FOUR_HOURS_MS;
}

function preciseObservationTimeMatch(left: GroupableRecord, right: GroupableRecord): boolean {
  if (!left.date || !right.date) return false;
  const bothDateTimes = hasDateTime(left.date) && hasDateTime(right.date);
  if (!bothDateTimes) return sameCalendarDate(left.date, right.date);
  const leftTime = parsedTime(left.date);
  const rightTime = parsedTime(right.date);
  if (leftTime === null || rightTime === null) return false;
  const delta = Math.abs(leftTime - rightTime);
  if (delta <= FIVE_MINUTES_MS) return true;
  return delta <= FOUR_HOURS_MS && minuteSecondKey(left.date) === minuteSecondKey(right.date);
}

function sourceAllowsDedup(left: GroupableRecord, right: GroupableRecord): boolean {
  if (left.source !== "provider" || right.source !== "provider") return false;
  if (!left.portalSourceId || !right.portalSourceId) return false;
  return left.portalSourceId !== right.portalSourceId;
}

function statusesCompatible(left?: string, right?: string): boolean {
  const normalizedLeft = normalized(left);
  const normalizedRight = normalized(right);
  if (!normalizedLeft || !normalizedRight) return true;
  const incompatible = new Set(["entered in error", "not done", "cancelled"]);
  if (incompatible.has(normalizedLeft) || incompatible.has(normalizedRight)) return normalizedLeft === normalizedRight;
  return true;
}

function comparableObservationValue(record: GroupableRecord): string | null {
  if (record.canonicalValue !== undefined) {
    return `${record.canonicalValue.toFixed(6)}|${normalized(record.canonicalUnit || record.unit)}`;
  }
  if (record.displayValue) return normalized(record.displayValue);
  return null;
}

function observationsMatch(left: GroupableRecord, right: GroupableRecord): string | null {
  const leftValue = comparableObservationValue(left);
  const rightValue = comparableObservationValue(right);
  if (!leftValue || !rightValue || leftValue !== rightValue) return null;
  if (!preciseObservationTimeMatch(left, right)) return null;
  return hasDateTime(left.date) && hasDateTime(right.date)
    ? "Same concept, same value/unit, and matching time within 4 hours."
    : "Same concept, same value/unit, and same calendar date.";
}

function sameDayOrCloseTime(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  if (hasDateTime(left) && hasDateTime(right)) return withinFourHours(left, right);
  return sameCalendarDate(left, right);
}

function recordsMatch(left: GroupableRecord, right: GroupableRecord): string | null {
  if (left.resourceType !== right.resourceType) return null;
  if (!sourceAllowsDedup(left, right)) return null;
  if (!statusesCompatible(left.status, right.status)) return null;

  if (left.resourceType === "Observation") return observationsMatch(left, right);

  if (!sameDayOrCloseTime(left.date, right.date)) return null;
  if (left.resourceType === "Immunization") return "Same vaccine group and matching occurrence date.";
  if (left.resourceType === "MedicationRequest") return "Same medication group, compatible status, and matching authored date.";
  if (left.resourceType === "Condition") return "Same condition group, compatible status, and matching recorded/onset date.";
  return "Same group and matching date.";
}

function hasStandardCode(record: GroupableRecord): boolean {
  return (record.codingKeys ?? []).some((key) => /^(loinc|rxnorm|snomed|icd10cm|cvx|ndc|cpt):/i.test(key));
}

export function recordQualityScore(record: GroupableRecord): number {
  let score = 0;
  if (record.source === "provider") score += 5;
  if (hasStandardCode(record)) score += 18;
  if ((record.codingKeys ?? []).length > 0) score += 4;
  if ((record.codeCodings ?? []).length > 0) score += 3;
  if ((record.codeTexts ?? []).length > 0) score += 2;
  if (record.status) score += 3;
  if (hasDateTime(record.date)) score += 6;
  else if (record.date) score += 3;

  if (record.resourceType === "Observation") {
    if (record.displayValue) score += 10;
    if (record.canonicalValue !== undefined) score += 10;
    if (record.canonicalUnit) score += 6;
    if (record.categoryCode) score += 3;
  }

  if (record.resourceType === "MedicationRequest") {
    if (record.ingredients?.length) score += 10;
    if (record.route) score += 6;
    if (record.dosageForm) score += 4;
  }

  return score;
}

function latestDateTime(record: GroupableRecord): number {
  return parsedTime(record.latestDate || record.date) ?? 0;
}

function canonicalRecord(records: GroupableRecord[]): { record: GroupableRecord; score: number } {
  return records
    .map((record) => ({ record, score: recordQualityScore(record) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        latestDateTime(right.record) - latestDateTime(left.record) ||
        left.record.id.localeCompare(right.record.id)
    )[0];
}

function clusterId(records: GroupableRecord[]): string {
  const ids = records.map((record) => `${record.resourceType}/${record.id}`).sort().join("|");
  return `dedupe:${stableHash(ids)}`;
}

/**
 * Duplicate decisions made by fhir4ds deduplication for one set of records.
 * `covered` holds every record it examined. `clusterByRecordId` holds, for
 * the records that are copies of another record, the cluster they belong to;
 * a covered record with no entry was examined and is not a copy.
 */
export interface DuplicateLinks {
  covered: ReadonlySet<string>;
  clusterByRecordId: ReadonlyMap<string, number>;
}

export function duplicateLinksFromClusters(
  recordIds: Iterable<string>,
  clusters: Iterable<Iterable<string>>
): DuplicateLinks {
  const covered = new Set(recordIds);
  const clusterByRecordId = new Map<string, number>();
  let clusterNumber = 0;
  for (const cluster of clusters) {
    for (const id of cluster) {
      covered.add(id);
      clusterByRecordId.set(id, clusterNumber);
    }
    clusterNumber += 1;
  }
  return { covered, clusterByRecordId };
}

/**
 * Groups records that are copies of one record.
 *
 * Without `links`, the local rules in `recordsMatch` decide every pair.
 *
 * With `links`, records that fhir4ds examined are copies only when fhir4ds
 * put them in one cluster. A decided record never joins a cluster that holds
 * a decided record from another fhir4ds cluster. Pairs fhir4ds did not
 * examine (for example a record the patient added) still use the local rules.
 */
export function dedupeGroupedRecords(records: GroupableRecord[], links?: DuplicateLinks | null): DedupedRecordCluster[] {
  const clusters: Array<{ records: GroupableRecord[]; reasons: string[] }> = [];
  const isDecided = (record: GroupableRecord): boolean => links?.covered.has(record.id) === true;
  const fhir4dsClusterOf = (record: GroupableRecord): number | undefined => links?.clusterByRecordId.get(record.id);
  const firstLocalReason = (cluster: { records: GroupableRecord[] }, record: GroupableRecord): string | null =>
    cluster.records.map((member) => recordsMatch(member, record)).find(Boolean) ?? null;

  const joinReason = (cluster: { records: GroupableRecord[] }, record: GroupableRecord): string | null => {
    if (!isDecided(record)) return firstLocalReason(cluster, record);
    const decidedMembers = cluster.records.filter(isDecided);
    if (decidedMembers.length === 0) return firstLocalReason(cluster, record);
    const sharesCluster = fhir4dsClusterOf(record) !== undefined &&
      decidedMembers.every((member) => fhir4dsClusterOf(member) === fhir4dsClusterOf(record));
    return sharesCluster ? "Copies of one record, found by fhir4ds deduplication." : null;
  };

  for (const record of records.filter((candidate) => !candidate.hidden)) {
    let reason: string | null = null;
    const match = clusters.find((cluster) => {
      reason = joinReason(cluster, record);
      return reason !== null;
    });
    if (!match) {
      clusters.push({ records: [record], reasons: [] });
      continue;
    }
    match.records.push(record);
    if (reason) match.reasons.push(reason);
  }

  return clusters.map((cluster) => {
    const canonical = canonicalRecord(cluster.records);
    const recordsSorted = [...cluster.records].sort(
      (left, right) =>
        (right.id === canonical.record.id ? 1 : 0) - (left.id === canonical.record.id ? 1 : 0) ||
        sourceLabel(left).localeCompare(sourceLabel(right)) ||
        left.id.localeCompare(right.id)
    );
    return {
      id: clusterId(cluster.records),
      canonical: canonical.record,
      records: recordsSorted,
      duplicateCount: Math.max(0, cluster.records.length - 1),
      qualityScore: canonical.score,
      matchReason: cluster.reasons[0]
    };
  });
}

export interface DuplicateGroup {
  /** The record the page shows; the others were dropped as copies of it. */
  kept: GroupableRecord;
  copies: GroupableRecord[];
}

export interface DuplicateSummary {
  groups: DuplicateGroup[];
  /** Records dropped as copies of another record. */
  copies: number;
}

/**
 * What fhir4ds deduplication hid, grouped as the page groups it, for the
 * connection menu's report. Only records fhir4ds looked at and put in a
 * cluster of two or more are listed. Null until a run has decided something.
 */
export function duplicateSummary(records: GroupableRecord[], links: DuplicateLinks | null): DuplicateSummary | null {
  if (!links) return null;
  const byCluster = new Map<number, GroupableRecord[]>();
  for (const record of records) {
    if (record.hidden) continue;
    const cluster = links.clusterByRecordId.get(record.id);
    if (cluster === undefined) continue;
    const members = byCluster.get(cluster) ?? [];
    members.push(record);
    byCluster.set(cluster, members);
  }

  const groups: DuplicateGroup[] = [];
  for (const members of byCluster.values()) {
    if (members.length < 2) continue;
    const kept = canonicalRecord(members).record;
    groups.push({ kept, copies: members.filter((member) => member.id !== kept.id) });
  }
  groups.sort(
    (left, right) =>
      left.kept.resourceType.localeCompare(right.kept.resourceType) ||
      left.kept.id.localeCompare(right.kept.id)
  );

  return { groups, copies: groups.reduce((total, group) => total + group.copies.length, 0) };
}

export function sourceLabel(record: GroupableRecord): string {
  return record.portalSourceName || record.portalSourceId || "Source";
}
