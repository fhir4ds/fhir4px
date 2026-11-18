/**
 * CMS quality measures (pre-translated CQL→SQL, pinned under
 * /fhir4ds/measures/). Shared by the Quality page and the Patient Summary
 * care-gap band — single source of truth for manifest loading, year
 * shifting, execution, and population evaluation.
 *
 * Measure SQL emits one row per patient with boolean population columns:
 *   patient_id, "Initial Population", Denominator, "Denominator Exclusions", Numerator
 * A NEGATIVE result (care gap) for a proportion measure is a patient who is
 * in the denominator, not excluded, and not in the numerator. Inverse
 * measures (numerator = bad outcome) flip the numerator test; none are
 * pinned yet, the polarity is carried for future measures.
 */

import { engineLoadResources, engineQuery } from "../engine/engine-client";
import { loadSessionResources } from "../engine/session-data";

export interface MeasureManifestEntry {
  title: string;
  populations: string[];
  sql: string;
  /** "proportion": numerator is good (default). "inverse": numerator is bad. */
  polarity?: "proportion" | "inverse";
}

export interface MeasureManifest {
  measures: Record<string, MeasureManifestEntry>;
}

export interface MeasureResult {
  id: string;
  title: string;
  columns: string[];
  rows: unknown[][];
  error?: string;
  executionMs: number;
}

/** A measure evaluated for the loaded patient: negative = care gap. */
export interface MeasureGapResult {
  id: string;
  title: string;
  negative: boolean;
  polarity: "proportion" | "inverse";
}

export function measuresBaseUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/?$/, "/")}fhir4ds/measures`;
}

export async function fetchMeasureManifest(): Promise<MeasureManifest> {
  const response = await fetch(`${measuresBaseUrl()}/manifest.json`);
  if (!response.ok) throw new Error(`Measure manifest unavailable (${response.status})`);
  return (await response.json()) as MeasureManifest;
}

/**
 * Load session resources into the engine and execute every measure in the
 * manifest. Measure SQL is generated for the 2026 measurement period; dates
 * are shifted to the current year so live data windows line up.
 */
export async function runQualityMeasures(): Promise<MeasureResult[]> {
  const resources = await loadSessionResources();
  await engineLoadResources(resources);
  const manifest = await fetchMeasureManifest();
  const results: MeasureResult[] = [];
  for (const [id, measure] of Object.entries(manifest.measures)) {
    const sqlResponse = await fetch(`${measuresBaseUrl()}/${measure.sql}`);
    if (!sqlResponse.ok) {
      results.push({ id, title: measure.title, columns: [], rows: [], error: `SQL unavailable (${sqlResponse.status})`, executionMs: 0 });
      continue;
    }
    let sql = await sqlResponse.text();
    const year = new Date().getFullYear();
    if (year !== 2026) {
      sql = sql
        .replaceAll("2026-01-01T00:00:00.000", `${year}-01-01T00:00:00.000`)
        .replaceAll("2026-12-31T23:59:59.999", `${year}-12-31T23:59:59.999`);
    }
    const started = performance.now();
    try {
      const result = await engineQuery(sql);
      results.push({ id, title: measure.title, columns: result.columns, rows: result.rows, executionMs: Math.round(performance.now() - started) });
    } catch (caught) {
      results.push({ id, title: measure.title, columns: [], rows: [], error: caught instanceof Error ? caught.message : String(caught), executionMs: Math.round(performance.now() - started) });
    }
  }
  return results;
}

function boolAt(row: unknown[], columns: string[], name: string): boolean | null {
  const index = columns.indexOf(name);
  if (index < 0) return null;
  const value = row[index];
  return value === true || value === 1 || value === "true" ? true : value === false || value === 0 || value === "false" ? false : null;
}

/**
 * Evaluate measure results for the loaded (single-patient) dataset.
 * Errored measures and missing population columns are never negative —
 * a gap is only asserted from a well-formed executed row.
 */
export function evaluateMeasureGaps(results: MeasureResult[]): MeasureGapResult[] {
  return results.map((result) => {
    const polarity: "proportion" | "inverse" = "proportion";
    if (result.error || result.rows.length === 0) {
      return { id: result.id, title: result.title, negative: false, polarity };
    }
    const row = result.rows[0];
    const denominator = boolAt(row, result.columns, "Denominator");
    const excluded = boolAt(row, result.columns, "Denominator Exclusions");
    const numerator = boolAt(row, result.columns, "Numerator");
    const negative =
      denominator === true && excluded !== true &&
      (polarity === "proportion" ? numerator === false : numerator === true);
    return { id: result.id, title: result.title, negative, polarity };
  });
}
