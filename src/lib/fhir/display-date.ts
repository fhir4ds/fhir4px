/**
 * FHIR dates as the app shows them. FHIR date-only strings (and partial dates:
 * "2021", "2021-06") carry no timezone — parsing them as UTC shifts the local
 * calendar date back a day in the Americas, so they are parsed as local
 * midnight; datetimes (with 'T') parse natively.
 */

export function parseFhirDateValue(raw: string): Date {
  if (/^\d{4}(-\d{2})?(-\d{2})?$/.test(raw)) return new Date(`${raw}T00:00:00`);
  return new Date(raw);
}

/** Display a raw FHIR date at its own precision (year / year-month / day). */
export function displayFhirDatePrecision(raw: string): string | undefined {
  const yearOnly = /^\d{4}$/.exec(raw);
  if (yearOnly) return yearOnly[0];
  const yearMonth = /^(\d{4})-(\d{2})$/.exec(raw);
  if (yearMonth) {
    const parsed = new Date(`${yearMonth[0]}-01T00:00:00`);
    return Number.isNaN(parsed.getTime())
      ? raw
      : parsed.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }
  return undefined;
}

/** A record's date at its own precision, for list rows and tables. */
export function recordDateLabel(record: { date?: string; latestDate?: string }): string {
  const raw = record.date || record.latestDate;
  if (!raw) return "No date";
  const precise = displayFhirDatePrecision(raw);
  if (precise) return precise;
  const parsed = parseFhirDateValue(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString();
}
