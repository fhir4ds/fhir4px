/**
 * BM25 naming wrapper — Tier 2 fallback for records without a code.
 *
 * Uses pre-built per-category BM25 indexes hosted on HuggingFace
 * (joelmontavon/fhir4px-bm25). Runs after deterministic lookup (Tier 1)
 * misses and before the LLM (Tier 3). ~81% accuracy, ~10ms per query.
 *
 * The updated BM25 indexes return the code, system, friendly name,
 * canonical code (ICD-10 for conditions), and ingredient codes
 * (for medications) alongside the match score.
 *
 * Indexes are lazy-loaded per category and cached for the session.
 */

import { BM25Resolver } from "./bm25-resolver.js";
import type { GroupableRecord, CanonicalCode } from "./patient-groups";

const BM25_BASE_URL = "https://huggingface.co/joelmontavon/fhir4px-bm25/resolve/main";
const SCORE_THRESHOLD = 5.0;

let resolver: BM25Resolver | null = null;

function getResolver(): BM25Resolver {
  if (!resolver) {
    resolver = new BM25Resolver({ baseUrl: BM25_BASE_URL, debug: false });
  }
  return resolver;
}

export interface Bm25NamingResult {
  patientFriendlyName: string;
  code: string;
  system: string;
  canonicalCode?: CanonicalCode;
  ingredientCodes?: string[];
  confidence: number;
  score: number;
}

/**
 * Resolve a patient-friendly name for a record via BM25 search.
 * Returns null if no confident match (score below threshold or no category).
 */
export async function resolveBm25Name(
  record: GroupableRecord
): Promise<Bm25NamingResult | null> {
  const category = BM25Resolver.resourceTypeToCategory(record.resourceType);
  if (!category) return null;

  const query =
    record.sourceLabel ||
    record.codeTexts?.[0] ||
    record.codeCodings?.find((c) => c.display)?.display ||
    "";
  if (!query.trim()) return null;

  try {
    const result = await getResolver().resolve(query, category, 1);
    if (!result.name || result.score < SCORE_THRESHOLD) return null;
    if (!result.code || !result.system) return null;

    const namingResult: Bm25NamingResult = {
      patientFriendlyName: result.friendly_name || result.name,
      code: result.code,
      system: result.system,
      confidence: Math.min(result.score / 20, 0.85),
      score: result.score
    };

    if (result.canonical_code && result.canonical_system) {
      namingResult.canonicalCode = {
        system: result.canonical_system as CanonicalCode["system"],
        code: result.canonical_code
      };
    }

    if (result.ingredient_codes && result.ingredient_codes.length > 0) {
      namingResult.ingredientCodes = result.ingredient_codes;
    }

    return namingResult;
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
 * Batch-resolve BM25 names for multiple records.
 */
export async function resolveBm25Names(
  records: GroupableRecord[]
): Promise<Map<string, Bm25NamingResult>> {
  const results = new Map<string, Bm25NamingResult>();
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
