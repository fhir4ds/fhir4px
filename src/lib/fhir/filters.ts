import type { FhirResource } from "../smart/data";

const HIGH_VOLUME_RESOURCE_TYPES = new Set([
  "Observation",
  "DiagnosticReport",
  "DocumentReference",
  "Encounter",
  "Procedure",
  "Immunization"
]);

function resourceDate(resource: FhirResource): string | undefined {
  const directFields = [
    "effectiveDateTime",
    "issued",
    "date",
    "created",
    "performedDateTime",
    "occurrenceDateTime",
    "onsetDateTime",
    "recordedDate"
  ];
  for (const field of directFields) {
    const value = resource[field];
    if (typeof value === "string") return value;
  }

  const periodFields = ["effectivePeriod", "period", "performedPeriod"];
  for (const field of periodFields) {
    const period = resource[field] as { start?: string; end?: string } | undefined;
    if (period?.start || period?.end) return period.start || period.end;
  }

  return undefined;
}

export function filterResourcesByLookback(
  resources: FhirResource[],
  lookbackDays: number | null,
  now = Date.now()
): FhirResource[] {
  if (!lookbackDays) return resources;

  const earliest = now - lookbackDays * 24 * 60 * 60 * 1000;
  return resources.filter((resource) => {
    if (!HIGH_VOLUME_RESOURCE_TYPES.has(resource.resourceType)) return true;

    const date = resourceDate(resource);
    if (!date) return true;
    const timestamp = Date.parse(date);
    if (!Number.isFinite(timestamp)) return true;
    return timestamp >= earliest;
  });
}
