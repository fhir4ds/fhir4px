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
import { loadAnalyticResources } from "./analytic-resources";
import { translateMeasureSql } from "../engine/viewdef";
import { prebuiltMeasureSql } from "../engine/prebuilt";
import { boolAt } from "../engine/result-values";
import { valuesetToRows, seedValuesetCache, type ValuesetRow } from "../engine/valueset-bridge";

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
  /** "proportion": numerator is good (default). "inverse": numerator is bad. */
  polarity?: "proportion" | "inverse";
  columns: string[];
  rows: unknown[][];
  error?: string;
  executionMs: number;
  /** Measurement period the SQL was shifted to (data-driven). */
  measurementYear?: number;
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
 * are shifted to the current year so live data windows line up. Use
 * runQualityMeasures() (cached) instead of calling this directly.
 */
/**
 * Execute CMS quality measures with LIVE CQL→SQL translation: the eCQM CQL
 * libraries (vendored machine-readable inputs) are translated at runtime by
 * the fhir4ds wheel, with the Measurement Period bound as a translation
 * parameter and value sets expanded into the SQL by the wheel's own logic.
 * Nothing pre-translated is executed.
 */
async function executeQualityMeasures(): Promise<MeasureResult[]> {
  const [resources, manifest, cqlManifest] = await Promise.all([
    loadAnalyticResources(),
    fetchMeasureManifest(),
    fetch(`${measuresBaseUrl()}/cql-manifest.json`).then((response) => {
      if (!response.ok) throw new Error(`CQL manifest unavailable (${response.status})`);
      return response.json() as Promise<{ libraries?: string[]; valuesets?: string[] } & Record<string, { file: string }>>;
    })
  ]);
  await engineLoadResources(resources);

  // Static inputs (CQL texts + expanded ValueSets) are content-addressed by
  // the manifest — fetch once per session.
  const inputs = await loadEcqmInputs(cqlManifest);

  // Data-driven measurement period: eCQM initial populations require
  // qualifying encounters within the measurement year, but test data is
  // often historical. Bind to the most recent year in which the patient
  // actually had an encounter (fallback: the current year, i.e. standard
  // eCQM semantics).
  const measurementYear = deriveMeasurementYear(resources);
  const measurementPeriod = {
    start: `${measurementYear}-01-01T00:00:00.000Z`,
    end: `${measurementYear}-12-31T23:59:59.999Z`
  };

  // Seed the C++ g_valueset_cache (native in_valueset reads it, not a table)
  // — same UDF surface the CQL cleanroom uses.
  await seedValuesetCache(inputs.valuesetRows, (sql) => engineQuery(sql));

  const results: MeasureResult[] = [];
  for (const [id, measure] of Object.entries(manifest.measures)) {
    const measureCql = inputs.measureCql[id];
    if (!measureCql) {
      results.push({ id, title: measure.title, polarity: measure.polarity ?? "proportion", columns: [], rows: [], error: "CQL library not vendored", executionMs: 0, measurementYear });
      continue;
    }
    const started = performance.now();
    try {
      // Prebuilt SQL (translated at build time, year filled in) first; live
      // translation is the fallback.
      const sql =
        (await prebuiltMeasureSql(id, measurementYear)) ??
        (await translateMeasureSql(measureCql, inputs.libraryTexts, measurementPeriod));
      const result = await engineQuery(sql);
      results.push({
        id,
        title: measure.title,
        polarity: measure.polarity ?? "proportion",
        columns: result.columns,
        rows: result.rows,
        executionMs: Math.round(performance.now() - started),
        measurementYear
      });
    } catch (caught) {
      results.push({
        id,
        title: measure.title,
        polarity: measure.polarity ?? "proportion",
        columns: [],
        rows: [],
        error: caught instanceof Error ? caught.message : String(caught),
        executionMs: Math.round(performance.now() - started),
        measurementYear
      });
    }
  }
  return results;
}

interface EcqmInputs {
  measureCql: Record<string, string>;
  libraryTexts: Record<string, string>;
  valuesetRows: ValuesetRow[];
}

let cachedInputs: Promise<EcqmInputs> | null = null;

/** The CQL texts the live measure translation reads — the same inputs
 * scripts/prebuild_sql.py translates at build time. Exported so the parity
 * test (tests/e2e/prebuilt-sql.spec.ts) compares like with like. */
export async function loadMeasureTranslationInputs(): Promise<EcqmInputs> {
  const response = await fetch(`${measuresBaseUrl()}/cql-manifest.json`);
  if (!response.ok) throw new Error(`CQL manifest unavailable (${response.status})`);
  return loadEcqmInputs((await response.json()) as Parameters<typeof loadEcqmInputs>[0]);
}

async function loadEcqmInputs(cqlManifest: {
  libraries?: string[];
  valuesets?: string[];
} & Record<string, { file: string }>): Promise<EcqmInputs> {
  if (!cachedInputs) {
    cachedInputs = (async () => {
      const measureIds = Object.keys(cqlManifest).filter((key) => key.startsWith("CMS"));
      // Loader aliases: file stem plus the local aliases the eCQM libraries
      // use in include statements (e.g. SupplementalDataElements as SDE).
      const aliasFilenames: Record<string, string> = {
        SDE: "SupplementalDataElements.cql",
        AHA: "AdvancedIllnessandFrailty.cql",
        AIFrailLTCF: "AdvancedIllnessandFrailty.cql"
      };
      const libraryFiles = [...(cqlManifest.libraries ?? [])];
      for (const filename of Object.values(aliasFilenames)) {
        if (!libraryFiles.includes(filename)) libraryFiles.push(filename);
      }
      const libraryTexts: Record<string, string> = {};
      await Promise.all(
        libraryFiles.map(async (filename) => {
          const response = await fetch(`${measuresBaseUrl()}/cql/${filename}`);
          if (!response.ok) return;
          const text = await response.text();
          const stem = filename.replace(/\.cql$/, "");
          libraryTexts[stem] = text;
          for (const [alias, target] of Object.entries(aliasFilenames)) {
            if (target === filename) libraryTexts[alias] = text;
          }
        })
      );
      const measureCql: Record<string, string> = {};
      await Promise.all(
        measureIds.map(async (id) => {
          const response = await fetch(`${measuresBaseUrl()}/cql/${cqlManifest[id].file}`);
          if (response.ok) measureCql[id] = await response.text();
        })
      );
      const valuesetResources: Array<Record<string, unknown>> = [];
      await Promise.all(
        (cqlManifest.valuesets ?? []).map(async (url) => {
          const oid = url.split("/").pop() ?? url;
          const response = await fetch(`${measuresBaseUrl()}/valuesets/valueset-${oid}.json`);
          if (response.ok) {
            const valueset = await response.json();
            valuesetResources.push(valueset);
          }
        })
      );
      const { rows: valuesetRows } = valuesetToRows(valuesetResources);
      return { measureCql, libraryTexts, valuesetRows };
    })().catch((caught) => {
      cachedInputs = null;
      throw caught;
    });
  }
  return cachedInputs;
}

/** Most recent year with clinical activity in the loaded dataset, across
 * any dated clinical field (encounters, observations, conditions, meds,
 * procedures, reports, documents). Meta timestamps are excluded so server
 * load times don't skew the period. */
function deriveMeasurementYear(resources: Record<string, unknown>[]): number {
  const dateFields = [
    "effectiveDateTime",
    "effectiveDate",
    "onsetDateTime",
    "recordedDate",
    "performedDateTime",
    "performedDate",
    "occurrenceDateTime",
    "authoredOn",
    "date",
    "when"
  ];
  const periodFields = [
    ["effectivePeriod", "start"],
    ["onsetPeriod", "start"],
    ["performedPeriod", "start"],
    ["occurrencePeriod", "start"],
    ["period", "start"]
  ];
  let latest = 0;
  for (const resource of resources) {
    if (typeof resource !== "object" || resource === null) continue;
    const candidates: unknown[] = dateFields.map((field) => resource[field]);
    for (const [parent, child] of periodFields) {
      const period = resource[parent];
      if (typeof period === "object" && period !== null) candidates.push((period as Record<string, unknown>)[child]);
    }
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || candidate.length < 4) continue;
      const year = Number.parseInt(candidate.slice(0, 4), 10);
      if (Number.isFinite(year) && year > latest && year <= 2100) latest = year;
    }
  }
  return latest > 0 ? latest : new Date().getFullYear();
}


/** How a measure came out for a patient who is in its initial population. */
export type MeasureStatus = "care-gap" | "met" | "excluded" | "not-in-denominator";

export function measureStatus(evaluation: MeasureEvaluation): MeasureStatus {
  if (evaluation.negative) return "care-gap";
  if (evaluation.denominator && evaluation.excluded) return "excluded";
  if (evaluation.denominator) return "met";
  return "not-in-denominator";
}

/** A measure evaluated for the loaded patient, with full population pathway. */
export interface MeasureEvaluation {
  id: string;
  title: string;
  negative: boolean;
  polarity: "proportion" | "inverse";
  initialPopulation: boolean;
  denominator: boolean;
  excluded: boolean;
  numerator: boolean;
}

export function evaluateMeasureGaps(results: MeasureResult[]): MeasureGapResult[] {
  return evaluateMeasures(results).map(({ id, title, negative, polarity }) => ({ id, title, negative, polarity }));
}

/**
 * Evaluate measure results for the loaded (single-patient) dataset.
 * Errored measures and missing population columns evaluate to all-false —
 * a gap is only asserted from a well-formed executed row.
 */
export function evaluateMeasures(results: MeasureResult[]): MeasureEvaluation[] {
  return results.map((result) => {
    const polarity: "proportion" | "inverse" = result.polarity ?? "proportion";
    if (result.error || result.rows.length === 0) {
      return { id: result.id, title: result.title, negative: false, polarity, initialPopulation: false, denominator: false, excluded: false, numerator: false };
    }
    const row = result.rows[0];
    const initialPopulation = boolAt(row, result.columns, "Initial Population") === true;
    const denominator = boolAt(row, result.columns, "Denominator") === true;
    const excluded = boolAt(row, result.columns, "Denominator Exclusions") === true;
    const numerator = boolAt(row, result.columns, "Numerator") === true;
    const negative =
      denominator && !excluded &&
      (polarity === "proportion" ? !numerator : numerator);
    return { id: result.id, title: result.title, negative, polarity, initialPopulation, denominator, excluded, numerator };
  });
}

// ── Session-level cache ──────────────────────────────────────────────────
// The measure calculation is dataset-scoped: run once, share the results
// between the Patient Summary care-gap band and the Quality page.
// Invalidated when the loaded dataset changes.

let cachedRun: Promise<MeasureResult[]> | null = null;
let datasetVersion = 0;

export function invalidateQualityMeasures(): void {
  cachedRun = null;
  datasetVersion += 1;
}

/** Bumped whenever the measure cache is invalidated (dataset changed). */
export function qualityDatasetVersion(): number {
  return datasetVersion;
}

/** Execute (or return the cached) measure run for the loaded dataset. */
export function runQualityMeasures(): Promise<MeasureResult[]> {
  if (!cachedRun) {
    cachedRun = executeQualityMeasures().catch((caught) => {
      // Don't cache failures — a later caller (e.g. the Quality page) may
      // succeed once the engine has finished booting.
      cachedRun = null;
      throw caught;
    });
  }
  return cachedRun;
}
