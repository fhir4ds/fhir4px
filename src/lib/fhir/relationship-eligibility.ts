import type { GroupableRecord } from "./patient-groups";

export function normalizedRelationshipStatus(status?: string): string {
  return (status || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isCompletedObservationForRelationship(record: GroupableRecord): boolean {
  if (record.resourceType !== "Observation") return false;
  if (record.hidden || record.inactiveOverlay) return false;

  const status = normalizedRelationshipStatus(record.status);
  if (!["final", "amended", "corrected", "appended", "completed"].includes(status)) return false;
  if (["absent", "unknown"].includes(record.valueKind ?? "")) return false;

  return true;
}

export function completedObservationRecordsForRelationship(records: GroupableRecord[]): GroupableRecord[] {
  return records.filter(isCompletedObservationForRelationship);
}
