/**
 * Runtime loaders for the fhir4ds/terminology HuggingFace repo.
 *
 * The repo is release-versioned (canonical/<release>/, lexical/<release>/,
 * semantic/<release>/) with no root manifest, so the latest release is
 * discovered via the HF API file listing.
 */

import {
  markRuntimeArtifactUnavailable,
  resetRuntimeArtifactsForTest,
  runtimeArtifactUnavailable,
  withArtifactDeadline
} from "./runtime-artifacts";

const TERM_BASE = "https://huggingface.co/fhir4ds/terminology/resolve/main";
const TERM_API = "https://huggingface.co/api/models/fhir4ds/terminology";

export function terminologyArtifactUrl(directory: string, release: string, file: string): string {
  return `${TERM_BASE}/${directory}/${release}/${file}`;
}

function compareRelease(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

interface RepoListing {
  siblings?: Array<{ rfilename: string }>;
}

async function fetchRepoListing(fetcher: typeof fetch): Promise<RepoListing> {
  const response = await fetcher(TERM_API, { cache: "no-store" });
  if (!response.ok) throw new Error(`Terminology repo listing unavailable: ${response.status}`);
  return (await response.json()) as RepoListing;
}

/**
 * Discover the latest release under a versioned top-level directory
 * (canonical/ or lexical/) that publishes the given file.
 */
export async function resolveTerminologyRelease(
  directory: "canonical" | "lexical",
  file: string,
  fetcher: typeof fetch = fetch
): Promise<string> {
  const listing = await fetchRepoListing(fetcher);
  const prefix = `${directory}/`;
  const suffix = `/${file}`;
  const releases = (listing.siblings ?? [])
    .filter((sibling) => sibling.rfilename.startsWith(prefix) && sibling.rfilename.endsWith(suffix))
    .map((sibling) => sibling.rfilename.slice(prefix.length, sibling.rfilename.length - suffix.length));
  if (releases.length === 0) {
    throw new Error(`No ${directory} ${file} release found in fhir4ds/terminology`);
  }
  return releases.sort(compareRelease).at(-1)!;
}

/* ------------------------------------------------------------------ *
 * Canonical value_sets (canonical/<release>/value_sets.json)
 * ------------------------------------------------------------------ */

export type ValueSetSystem = "loinc" | "rxnorm" | "snomed" | "cvx";

export interface ValueSetConcept {
  canonical_id: string;
  system: string;
  code: string;
  patient_friendly_name: string;
  consumer_synonyms?: string[];
  cui?: string;
  tty?: string;
}

const VALUE_SET_SYSTEM_MAP: Record<string, ValueSetSystem> = {
  LOINC: "loinc",
  RXNORM: "rxnorm",
  SNOMEDCT_US: "snomed",
  CVX: "cvx"
};

export type ValueSetLookup = Partial<Record<ValueSetSystem, Map<string, ValueSetConcept>>>;

let valueSetsPromise: Promise<ValueSetLookup> | null = null;

function toValueSetLookup(concepts: ValueSetConcept[]): ValueSetLookup {
  const lookup: ValueSetLookup = {};
  for (const concept of concepts) {
    const system = VALUE_SET_SYSTEM_MAP[concept.system];
    if (!system || !concept.code || !concept.patient_friendly_name) continue;
    const map = (lookup[system] ??= new Map<string, ValueSetConcept>());
    if (!map.has(concept.code)) map.set(concept.code, concept);
  }
  return lookup;
}

/**
 * Load and index the canonical value_sets artifact (one fetch, cached for
 * the session). The canonical layer is the model team's adjudicated concept
 * set — SCD products roll up to their canonical via the lexical index (see
 * lexical.ts); this artifact covers the canonical codes themselves.
 */
export function loadValueSets(options: { fetcher?: typeof fetch } = {}): Promise<ValueSetLookup> {
  if (runtimeArtifactUnavailable("valueSets")) return Promise.resolve({});
  if (valueSetsPromise) return valueSetsPromise;
  const fetcher = options.fetcher ?? fetch;
  valueSetsPromise = withArtifactDeadline(
    (async () => {
      const release = await resolveTerminologyRelease("canonical", "value_sets.json", fetcher);
      const response = await fetcher(terminologyArtifactUrl("canonical", release, "value_sets.json"), {
        cache: "force-cache"
      });
      if (!response.ok) throw new Error(`value_sets unavailable: ${response.status} (release ${release})`);
      const concepts = (await response.json()) as ValueSetConcept[];
      return toValueSetLookup(concepts);
    })()
  ).catch((error) => {
    // Offline-tolerant: shard + display_names naming stays functional, and the
    // rest of the session does not wait for these artifacts again.
    valueSetsPromise = null;
    markRuntimeArtifactUnavailable("valueSets");
    throw error;
  });
  return valueSetsPromise;
}

/** Test-only: inject parsed concepts directly, bypassing fetch. */
export function setValueSetsForTest(concepts: ValueSetConcept[] | null): void {
  if (concepts) resetRuntimeArtifactsForTest();
  valueSetsPromise = concepts ? Promise.resolve(toValueSetLookup(concepts)) : null;
}
