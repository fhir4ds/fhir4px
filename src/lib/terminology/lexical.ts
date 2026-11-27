/**
 * Runtime loader for the lexical search indexes hosted on HuggingFace at
 * fhir4ds/terminology (lexical/<release>/<category>.json).
 *
 * Each index is a prebuilt BM25 corpus over the canonical layer's synonym
 * expansion: every document is a source name (RxNorm SCD product strings,
 * LOINC long names, consumer terms) mapped to its canonical via
 * rid_to_canonical_code/system and carrying the canonical-friendly name in
 * rid_to_friendly_name. SCDs are therefore synonyms of their canonical —
 * findable by code (code map below) or by canonical text search (BM25).
 *
 * Indexes are lazy-loaded per category and cached for the session.
 */

import { resolveTerminologyRelease, terminologyArtifactUrl } from "./valueSets";
import {
  markRuntimeArtifactsUnavailable,
  runtimeArtifactsUnavailable,
  withArtifactDeadline
} from "./runtime-artifacts";

export type LexicalCategory = "medication" | "lab" | "condition" | "procedure" | "vaccine" | "body_structure";

export interface LexicalIndex {
  category: string;
  names: string[];
  postings: Record<string, Array<[number, number]>>;
  idf: Record<string, number>;
  doc_lengths: number[];
  avg_doc_length: number;
  rid_to_friendly_name?: string[];
  rid_to_code?: string[];
  rid_to_system?: string[];
  rid_to_canonical_code?: string[];
  rid_to_canonical_system?: string[];
}

export interface LexicalCodeEntry {
  /** Canonical-friendly name (rolled-up product/group level). */
  name: string;
  system: string;
  code: string;
}

const categoryPromises = new Map<LexicalCategory, Promise<LexicalIndex>>();
const codeMapPromises = new Map<LexicalCategory, Promise<Map<string, LexicalCodeEntry>>>();

/** Load one lexical category index (cached per session). */
export function loadLexicalIndex(
  category: LexicalCategory,
  options: { fetcher?: typeof fetch } = {}
): Promise<LexicalIndex> {
  if (runtimeArtifactsUnavailable()) return Promise.reject(new Error("lexical artifacts unavailable"));
  const cached = categoryPromises.get(category);
  if (cached) return cached;
  const fetcher = options.fetcher ?? fetch;
  const promise = withArtifactDeadline(
    (async () => {
      const release = await resolveTerminologyRelease("lexical", `${category}.json`, fetcher);
      const response = await fetcher(terminologyArtifactUrl("lexical", release, `${category}.json`), {
        cache: "force-cache"
      });
      if (!response.ok) throw new Error(`lexical ${category} unavailable: ${response.status}`);
      return (await response.json()) as LexicalIndex;
    })()
  ).catch((error) => {
    categoryPromises.delete(category);
    markRuntimeArtifactsUnavailable();
    throw error;
  });
  categoryPromises.set(category, promise);
  return promise;
}

/**
 * Build a `system:code → canonical entry` map from a lexical index. Every
 * coded document rolls up to its canonical-friendly name, so product codes
 * (RxNorm SCDs) resolve to the canonical group name without text search.
 */
export function lexicalCodeMapOf(index: LexicalIndex): Map<string, LexicalCodeEntry> {
  const map = new Map<string, LexicalCodeEntry>();
  for (let rid = 0; rid < index.names.length; rid += 1) {
    const code = index.rid_to_code?.[rid];
    const system = index.rid_to_system?.[rid];
    const name = index.rid_to_friendly_name?.[rid] ?? index.names[rid];
    if (!code || !system || !name) continue;
    const key = `${system}:${code}`;
    if (!map.has(key)) map.set(key, { name, system, code });
  }
  return map;
}

/** Load the code map for a category (cached per session). */
export function loadLexicalCodeMap(
  category: LexicalCategory,
  options: { fetcher?: typeof fetch } = {}
): Promise<Map<string, LexicalCodeEntry>> {
  const cached = codeMapPromises.get(category);
  if (cached) return cached;
  const promise = loadLexicalIndex(category, options)
    .then(lexicalCodeMapOf)
    .catch((error) => {
      codeMapPromises.delete(category);
      throw error;
    });
  codeMapPromises.set(category, promise);
  return promise;
}

/** Test-only: inject an index directly, bypassing fetch. */
export function setLexicalIndexForTest(category: LexicalCategory, index: LexicalIndex | null): void {
  if (index) {
    categoryPromises.set(category, Promise.resolve(index));
    codeMapPromises.set(category, Promise.resolve(lexicalCodeMapOf(index)));
  } else {
    categoryPromises.delete(category);
    codeMapPromises.delete(category);
  }
}
