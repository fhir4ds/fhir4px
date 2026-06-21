/**
 * BM25 naming wrapper — Tier 2 fallback for records without a code.
 *
 * Uses the pre-built per-category BM25 indexes hosted on HuggingFace
 * (joelmontavon/fhir4px-bm25). Runs after deterministic lookup (Tier 1)
 * misses and before the LLM (Tier 3). ~81% accuracy, ~10ms per query.
 *
 * Indexes are lazy-loaded per category (medication, lab, condition,
 * procedure, vaccine) and cached for the session.
 */

import { BM25Resolver } from "./bm25-resolver.js";
import type { GroupableRecord } from "./patient-groups";

const BM25_BASE_URL = "https://huggingface.co/joelmontavon/fhir4px-bm25/resolve/main";
const SCORE_THRESHOLD = 8.0;

let resolver: BM25Resolver | null = null;

function getResolver(): BM25Resolver {
  if (!resolver) {
    resolver = new BM25Resolver({ baseUrl: BM25_BASE_URL, debug: false });
  }
  return resolver;
}

/**
 * Resolve a patient-friendly name for a record via BM25 search.
 * Returns null if no confident match (score below threshold or no category).
 */
export async function resolveBm25Name(
  record: GroupableRecord
): Promise<{ patientFriendlyName: string; confidence: number; score: number } | null> {
  const category = BM25Resolver.resourceTypeToCategory(record.resourceType);
  if (!category) return null;

  // Use the best available display text as the BM25 query
  const query =
    record.sourceLabel ||
    record.codeTexts?.[0] ||
    record.codeCodings?.find((c) => c.display)?.display ||
    "";
  if (!query.trim()) return null;

  try {
    const result = await getResolver().resolve(query, category, 1);
    if (!result.name || result.score < SCORE_THRESHOLD) return null;

    return {
      patientFriendlyName: result.name,
      confidence: Math.min(result.score / 20, 0.85),
      score: result.score
    };
  } catch (err) {
    console.warn("[fhir4px:bm25]", {
      event: "resolve-failed",
      category,
      query: query.slice(0, 80),
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}

/**
 * Batch-resolve BM25 names for multiple records. More efficient than individual
 * calls since category indexes are loaded once and reused.
 */
export async function resolveBm25Names(
  records: GroupableRecord[]
): Promise<Map<string, { patientFriendlyName: string; confidence: number; score: number }>> {
  const results = new Map<string, { patientFriendlyName: string; confidence: number; score: number }>();
  for (const record of records) {
    const match = await resolveBm25Name(record);
    if (match) {
      results.set(record.id, match);
    }
  }
  return results;
}

/**
 * Pre-load BM25 indexes for the categories present in a record set.
 * Call during idle time to avoid latency on first resolution.
 */
export async function preloadBm25Categories(resourceTypes: string[]): Promise<void> {
  const r = getResolver();
  const categories = new Set<string>();
  for (const rt of resourceTypes) {
    const cat = BM25Resolver.resourceTypeToCategory(rt);
    if (cat) categories.add(cat);
  }
  await Promise.all(
    [...categories].map((cat) => r.loadCategory(cat).catch(() => null))
  );
}
