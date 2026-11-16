/**
 * Runtime loader for the canonical value_sets artifact hosted on HuggingFace
 * at fhir4ds/terminology (canonical/<release>/value_sets.json).
 *
 * The artifact is the model team's adjudicated canonical layer: one entry per
 * canonical concept (LOINC tests, RxNorm ingredients/groups, SNOMED
 * conditions/procedures, CVX vaccine groups), each carrying the curated
 * patient_friendly_name plus consumer synonyms, CUI and TTY. canonical_id
 * uses the same VAL-* CID scheme as the association bundle, so concepts join
 * directly onto the graph.
 *
 * Release directories are date-versioned and the repo publishes no root
 * manifest, so the latest release is discovered via the HF API file listing.
 */

const TERM_BASE = "https://huggingface.co/fhir4ds/terminology/resolve/main";
const TERM_API = "https://huggingface.co/api/models/fhir4ds/terminology";

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

const SYSTEM_MAP: Record<string, ValueSetSystem> = {
  LOINC: "loinc",
  RXNORM: "rxnorm",
  SNOMEDCT_US: "snomed",
  CVX: "cvx"
};

export type ValueSetLookup = Partial<Record<ValueSetSystem, Map<string, ValueSetConcept>>>;

let releasePromise: Promise<string> | null = null;
let lookupPromise: Promise<ValueSetLookup> | null = null;

function compareRelease(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/** Discover the latest canonical release that publishes value_sets.json. */
export async function resolveLatestRelease(fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(TERM_API, { cache: "no-store" });
  if (!response.ok) throw new Error(`Terminology repo listing unavailable: ${response.status}`);
  const repo = (await response.json()) as { siblings?: Array<{ rfilename: string }> };
  const releases = (repo.siblings ?? [])
    .map((sibling) => /^canonical\/([^/]+)\/value_sets\.json$/.exec(sibling.rfilename)?.[1])
    .filter((release): release is string => Boolean(release));
  if (releases.length === 0) throw new Error("No canonical value_sets release found in fhir4ds/terminology");
  return releases.sort(compareRelease).at(-1)!;
}

function toLookup(concepts: ValueSetConcept[]): ValueSetLookup {
  const lookup: ValueSetLookup = {};
  for (const concept of concepts) {
    const system = SYSTEM_MAP[concept.system];
    if (!system || !concept.code || !concept.patient_friendly_name) continue;
    const map = (lookup[system] ??= new Map<string, ValueSetConcept>());
    if (!map.has(concept.code)) map.set(concept.code, concept);
  }
  return lookup;
}

/**
 * Load and index the value_sets artifact (one fetch, cached for the session).
 * Resolves to an empty lookup when unavailable (offline / HF unreachable) —
 * naming then falls back to the bundled shards and display_names overlay.
 */
export function loadValueSets(options: { fetcher?: typeof fetch } = {}): Promise<ValueSetLookup> {
  if (lookupPromise) return lookupPromise;
  const fetcher = options.fetcher ?? fetch;
  lookupPromise = (async () => {
    const release = await resolveLatestRelease(fetcher);
    const response = await fetcher(`${TERM_BASE}/canonical/${release}/value_sets.json`, { cache: "force-cache" });
    if (!response.ok) throw new Error(`value_sets unavailable: ${response.status} (release ${release})`);
    const concepts = (await response.json()) as ValueSetConcept[];
    return toLookup(concepts);
  })().catch((error) => {
    // Offline-tolerant: shard + display_names naming stays functional.
    lookupPromise = null;
    throw error;
  });
  return lookupPromise;
}

/** Test-only: inject parsed concepts directly, bypassing fetch. */
export function setValueSetsForTest(concepts: ValueSetConcept[] | null): void {
  lookupPromise = concepts ? Promise.resolve(toLookup(concepts)) : null;
}
