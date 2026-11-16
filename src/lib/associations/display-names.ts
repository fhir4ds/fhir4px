/**
 * Loader for the display_names sibling artifact (Option A, v2026-09-21.1940+).
 *
 * Hosted alongside the associations bundle on HuggingFace at
 * fhir4ds/associations under naming/<release>/display_names.json.gz.
 * Carries the merged
 * patient-friendly naming layer: full shard bases with bundle card names
 * overlaid on resolved codes (overlay_rule: card-name-wins) and AMA CPT
 * originals excluded. Per-system code -> {name, match_type}.
 *
 * The artifact is naming-only: structural fields (canonical codes, TTY,
 * CUI) still come from the bundled terminology shards, which also remain
 * the offline fallback while the dual-publish window is open.
 */

import { associationsArtifactUrl, resolveRelease } from "./manifest";

export type DisplayNamesSystem =
  | "cpt"
  | "cvx"
  | "hcpcs"
  | "icd10cm"
  | "icd10pcs"
  | "loinc"
  | "rxnorm"
  | "snomedct";

export interface DisplayNamesEntry {
  name: string;
  match_type: string;
}

export interface DisplayNamesBundle {
  format: string;
  version: string;
  systems: Partial<Record<DisplayNamesSystem, Record<string, DisplayNamesEntry>>>;
}

const DISPLAY_NAMES_FORMAT = "fhir4px_display_names_v1";

let namesPromise: Promise<DisplayNamesBundle | null> | null = null;

async function fetchGzJson(gzUrl: string): Promise<DisplayNamesBundle> {
  const response = await fetch(gzUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Display names unavailable: ${response.status} ${gzUrl}`);
  }
  if (typeof DecompressionStream === "undefined") {
    throw new Error(`Display names unavailable: no gzip support for ${gzUrl}`);
  }
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  return JSON.parse(text) as DisplayNamesBundle;
}

/**
 * Load the display_names artifact. Resolves to null when unavailable
 * (offline / HF unreachable) — naming then falls back to the bundled
 * shards alone.
 */
export function loadDisplayNames(): Promise<DisplayNamesBundle | null> {
  if (namesPromise) return namesPromise;
  namesPromise = resolveRelease()
    .then((release) => fetchGzJson(associationsArtifactUrl("naming", release, "display_names.json.gz")))
    .then((bundle) => {
      if (bundle?.format !== DISPLAY_NAMES_FORMAT) {
        throw new Error(`Unexpected display_names format: ${bundle?.format}`);
      }
      return bundle;
    })
    .catch(() => {
      // Offline-tolerant: shard-only naming stays functional.
      namesPromise = null;
      return null;
    });
  return namesPromise;
}

/** Test-only: inject parsed data directly, bypassing fetch. */
export function setDisplayNamesForTest(bundle: DisplayNamesBundle | null): void {
  namesPromise = bundle ? Promise.resolve(bundle) : null;
}
