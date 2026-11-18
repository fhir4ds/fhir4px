/**
 * Care gaps for the Patient Summary band.
 *
 * A care gap is an actionable, patient-level signal — currently:
 *   - Immunizations: overdue / due per the CDC adult schedule (CDSi forecast)
 *   - Quality measures: negative CMS measure results (denominator met,
 *     not excluded, numerator not met)
 *
 * Gaps live exclusively in the carousel band — they deliberately do NOT
 * feed the main priority list (no double surfacing). Ranking: severity
 * first, then most-overdue date, capped for the carousel.
 */

import type { ImmunizationForecastItem } from "./immunization-forecast";
import type { MeasureGapResult } from "./measures";

export type CareGapSource = "immunization" | "measure";
export type CareGapSeverity = "high" | "moderate";

export interface CareGap {
  id: string;
  source: CareGapSource;
  severity: CareGapSeverity;
  title: string;
  /** One-line card face text. */
  summary: string;
  /** Evidence lines revealed by card expansion. */
  details: string[];
  /** Earliest relevant date (past-due / recommended), ISO if known. */
  date?: string;
  /** ExplorerTab value to deep-link to, if any. */
  targetTab?: string;
}

function isPast(isoDate: string | undefined, now: Date): boolean {
  if (!isoDate) return false;
  const parsed = new Date(isoDate);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() < now.getTime();
}

function formatDateLabel(isoDate: string): string {
  const parsed = new Date(`${isoDate.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? isoDate : parsed.toLocaleDateString();
}

/**
 * Immunization forecast → gaps. Overdue (past-due status or past-due date
 * already passed) is high severity; due / not-complete is moderate.
 * Complete, immune, contraindicated and aged-out statuses are not gaps.
 */
export function buildImmunizationGaps(items: ImmunizationForecastItem[], now: Date = new Date()): CareGap[] {
  const gaps: CareGap[] = [];
  for (const item of items) {
    if (item.status === "complete" || item.status === "immune" || item.status === "contraindicated" || item.status === "agedOut") {
      continue;
    }
    const overdue = item.status === "pastDue" || isPast(item.pastDueDate, now);
    const relevantDate = overdue ? item.pastDueDate : item.recommendedDate;
    const details: string[] = [];
    if (item.reason) details.push(item.reason);
    if (item.description) details.push(item.description);
    if (item.earliestDate) details.push(`Earliest date: ${formatDateLabel(item.earliestDate)}`);
    if (item.recommendedDate) details.push(`Recommended date: ${formatDateLabel(item.recommendedDate)}`);
    if (item.pastDueDate) details.push(`Past-due date: ${formatDateLabel(item.pastDueDate)}`);
    gaps.push({
      id: `imm:${item.vaccineCodes.join(",")}`,
      source: "immunization",
      severity: overdue ? "high" : "moderate",
      title: item.vaccineLabel,
      summary: overdue
        ? item.pastDueDate
          ? `Past due since ${formatDateLabel(item.pastDueDate)}`
          : "Past due"
        : item.recommendedDate
          ? `Due — recommended by ${formatDateLabel(item.recommendedDate)}`
          : `Due (${item.statusDisplay ?? item.status})`,
      details,
      date: relevantDate,
      targetTab: "Immunization"
    });
  }
  return gaps;
}

/** Negative measure results → high-severity gaps. */
export function buildMeasureGaps(results: MeasureGapResult[]): CareGap[] {
  return results
    .filter((result) => result.negative)
    .map((result) => ({
      id: `measure:${result.id}`,
      source: "measure" as const,
      severity: "high" as const,
      title: `${result.id} — ${result.title}`,
      summary: "Measure not met — patient is in the denominator but the numerator requirement is not documented in the measurement period.",
      details: [
        "Population: in denominator, not excluded, numerator not met.",
        "CMS eCQM evaluated locally against the loaded records (pre-translated CQL→SQL via fhir4ds)."
      ],
      targetTab: undefined
    }));
}

/** Sort: severity first. Within high (overdue) the most recently overdue
 * date ranks first — ancient record-missing gaps are less actionable than
 * fresh ones. Within moderate (upcoming) the soonest date ranks first.
 * Cap for display. */
export function rankCareGaps(gaps: CareGap[], cap = 5): CareGap[] {
  const severityRank: Record<CareGapSeverity, number> = { high: 0, moderate: 1 };
  return [...gaps]
    .sort((a, b) => {
      const bySeverity = severityRank[a.severity] - severityRank[b.severity];
      if (bySeverity !== 0) return bySeverity;
      const aTime = a.date ? new Date(a.date).getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.date ? new Date(b.date).getTime() : Number.POSITIVE_INFINITY;
      if (aTime !== bTime) return a.severity === "high" ? bTime - aTime : aTime - bTime;
      return a.title.localeCompare(b.title);
    })
    .slice(0, cap);
}
