/**
 * One-line summary of the US Core data-presence checks, for the connection
 * menu. Pure logic over UsCoreCheckResult, kept apart from the engine code
 * that produces the results.
 */

import type { UsCoreCheckResult } from "./uscore-checks";

/** Share of conforming records at which a check counts as passing — the
 * same line the per-check chip uses for its success color. */
export const US_CORE_PASS_SHARE = 0.99;

export interface UsCoreCheckSummary {
  /** Checks with data where at least US_CORE_PASS_SHARE of records conform. */
  passing: number;
  /** Checks that looked at data and fell short, or that errored. */
  failing: number;
  /** Checks with no records of that type to look at. */
  noData: number;
}

/** Roll the checks up to the counts behind a one-line summary. */
export function summarizeUsCore(results: UsCoreCheckResult[]): UsCoreCheckSummary {
  const summary: UsCoreCheckSummary = { passing: 0, failing: 0, noData: 0 };
  for (const result of results) {
    if (result.error) {
      summary.failing += 1;
    } else if (result.total === 0) {
      summary.noData += 1;
    } else if (result.conforming / result.total >= US_CORE_PASS_SHARE) {
      summary.passing += 1;
    } else {
      summary.failing += 1;
    }
  }
  return summary;
}

/** One line for the connection menu, e.g. "8 of 8 checks passed". */
export function usCoreSummaryText(summary: UsCoreCheckSummary): string {
  const checked = summary.passing + summary.failing;
  const parts: string[] = [];
  parts.push(
    checked === 0
      ? "nothing to check yet"
      : `${summary.passing} of ${checked} ${checked === 1 ? "check" : "checks"} passed`
  );
  if (summary.noData > 0) parts.push(`${summary.noData} with no data`);
  return parts.join(" · ");
}
