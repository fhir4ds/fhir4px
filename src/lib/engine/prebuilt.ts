/**
 * Prebuilt SQL — the app's "prebuilt" mode.
 *
 * The app gets its SQL from fhir4ds in one of two ways. In the default
 * (live) build the browser runs the fhir4ds wheel and translates on demand
 * (viewdef.ts). In a prebuilt build (`vite build --mode prebuilt`, after
 * `npm run prebuild:sql`) the same translator already ran at build time over
 * the same inputs, and its output ships under /fhir4ds/prebuilt/.
 *
 * Every lookup here answers null when prebuilt SQL is off, missing or
 * unreadable, and the caller then falls back to live translation. So a
 * prebuilt build never depends on the generated files being complete, and
 * the Python runtime is loaded only when something was not built ahead.
 */

const GENERATOR = "fhir4px-prebuild-sql";
const MANIFEST_VERSION = 1;

interface Artifact {
  file: string;
}

/** The manifest scripts/prebuild_sql.py writes next to the SQL files. */
export interface PrebuiltManifest {
  generator: typeof GENERATOR;
  version: typeof MANIFEST_VERSION;
  wheel: { file: string; sha256: string };
  /** The token standing in for the measurement year in the measure SQL. */
  yearPlaceholder: string;
  measures: Record<string, Artifact>;
  cohorts: Record<string, Artifact>;
  views: Record<string, Artifact>;
  omopLibraries: Record<string, Artifact>;
  omopComposition: Artifact;
  /** Every input the SQL was generated from, with its checksum. */
  inputs: Array<{ path: string; sha256: string }>;
}

/** A ViewDefinition's SQL, as the engine frame's generator returns it. */
export interface PrebuiltViewSql {
  sql: string;
  setupSql: string[];
}

/** An OMOP table query and the composition statements it joins to. */
export interface PrebuiltOmopLibrary {
  sql: string;
  composition: string[];
}

interface PrebuiltOptions {
  fetcher?: typeof fetch;
}

/** On only in a prebuilt build (`.env.prebuilt`); the default build stays live. */
export const PREBUILT_SQL_ENABLED = import.meta.env.VITE_PREBUILT_SQL === "1";

export function prebuiltBaseUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/?$/, "/")}fhir4ds/prebuilt`;
}

let manifestPromise: Promise<PrebuiltManifest | null> | null = null;

/** Test hook: forget the cached manifest. */
export function resetPrebuiltSqlForTest(): void {
  manifestPromise = null;
}

function isPrebuiltManifest(value: unknown): value is PrebuiltManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Partial<PrebuiltManifest>;
  return (
    manifest.generator === GENERATOR &&
    manifest.version === MANIFEST_VERSION &&
    typeof manifest.yearPlaceholder === "string" &&
    manifest.yearPlaceholder.length > 0 &&
    [manifest.measures, manifest.cohorts, manifest.views, manifest.omopLibraries].every(
      (section) => typeof section === "object" && section !== null
    ) &&
    typeof manifest.omopComposition === "object" &&
    manifest.omopComposition !== null &&
    typeof manifest.omopComposition.file === "string"
  );
}

/**
 * The manifest, or null when prebuilt SQL is off or not available. A failed
 * load is not remembered, so a later call can try again.
 */
export function loadPrebuiltManifest(options: PrebuiltOptions = {}): Promise<PrebuiltManifest | null> {
  if (!PREBUILT_SQL_ENABLED) return Promise.resolve(null);
  if (!manifestPromise) {
    const fetcher = options.fetcher ?? fetch;
    manifestPromise = (async () => {
      const response = await fetcher(`${prebuiltBaseUrl()}/manifest.json`, { cache: "no-cache" });
      if (!response.ok) return null;
      const manifest: unknown = await response.json();
      return isPrebuiltManifest(manifest) ? manifest : null;
    })().catch(() => {
      manifestPromise = null;
      return null;
    });
  }
  return manifestPromise;
}

/**
 * One generated file as text. The dev server answers a missing file with the
 * app's HTML, so an HTML body counts as missing.
 */
async function readArtifact(manifest: PrebuiltManifest, file: string, fetcher: typeof fetch): Promise<string | null> {
  try {
    const response = await fetcher(`${prebuiltBaseUrl()}/${file}`, { cache: "no-cache" });
    if (!response.ok) return null;
    const text = await response.text();
    return /^\s*(<!doctype|<html)/i.test(text) ? null : text;
  } catch {
    return null;
  }
}

async function readJsonArtifact<T>(manifest: PrebuiltManifest, file: string, fetcher: typeof fetch): Promise<T | null> {
  const text = await readArtifact(manifest, file, fetcher);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Fill the measurement year into a measure's SQL. */
export function fillMeasurementYear(template: string, placeholder: string, year: number): string {
  if (!/^\d{4}$/.test(String(year))) {
    throw new Error(`Measurement year must be four digits, got ${String(year)}`);
  }
  return template.replaceAll(placeholder, String(year));
}

/** A quality measure's SQL for one measurement year. */
export async function prebuiltMeasureSql(measureId: string, year: number, options: PrebuiltOptions = {}): Promise<string | null> {
  const manifest = await loadPrebuiltManifest(options);
  const artifact = manifest?.measures[measureId];
  if (!manifest || !artifact) return null;
  const template = await readArtifact(manifest, artifact.file, options.fetcher ?? fetch);
  return template === null ? null : fillMeasurementYear(template, manifest.yearPlaceholder, year);
}

/** A cohort library's SQL. */
export async function prebuiltCohortSql(cohortId: string, options: PrebuiltOptions = {}): Promise<string | null> {
  const manifest = await loadPrebuiltManifest(options);
  const artifact = manifest?.cohorts[cohortId];
  if (!manifest || !artifact) return null;
  return readArtifact(manifest, artifact.file, options.fetcher ?? fetch);
}

/** A ViewDefinition's SQL (the engine frame's generateViewSql result). */
export async function prebuiltViewSql(viewId: string, options: PrebuiltOptions = {}): Promise<PrebuiltViewSql | null> {
  const manifest = await loadPrebuiltManifest(options);
  const artifact = manifest?.views[viewId];
  if (!manifest || !artifact) return null;
  const generated = await readJsonArtifact<{ ok?: unknown; sql?: unknown; setup_sql?: unknown[] }>(
    manifest,
    artifact.file,
    options.fetcher ?? fetch
  );
  if (!generated || generated.ok !== true || typeof generated.sql !== "string") return null;
  return { sql: generated.sql, setupSql: Array.isArray(generated.setup_sql) ? generated.setup_sql.map(String) : [] };
}

/**
 * An OMOP table query together with the composition statements every OMOP
 * query joins to. Both or nothing: a query without its composition cannot run.
 */
export async function prebuiltOmopLibrary(libraryId: string, options: PrebuiltOptions = {}): Promise<PrebuiltOmopLibrary | null> {
  const manifest = await loadPrebuiltManifest(options);
  const artifact = manifest?.omopLibraries[libraryId];
  if (!manifest || !artifact) return null;
  const [generated, composition] = await Promise.all([
    readJsonArtifact<{ ok?: unknown; sql?: unknown }>(manifest, artifact.file, options.fetcher ?? fetch),
    readJsonArtifact<unknown>(manifest, manifest.omopComposition.file, options.fetcher ?? fetch)
  ]);
  if (!generated || generated.ok !== true || typeof generated.sql !== "string") return null;
  if (!Array.isArray(composition) || composition.some((statement) => typeof statement !== "string")) return null;
  return { sql: generated.sql, composition: composition as string[] };
}
