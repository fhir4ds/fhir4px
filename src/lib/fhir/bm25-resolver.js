/**
 * fhir4px BM25 Patient-Friendly Name Resolver
 *
 * Tier 2 fallback for FHIR records without a code.
 * Uses pre-built per-category BM25 inverted indexes.
 *
 * Usage:
 *   import { BM25Resolver } from "./bm25_resolver.js";
 *
 *   const resolver = new BM25Resolver({
 *     baseUrl: "https://cdn.example.com/naming_bm25",  // where .json.gz files are hosted
 *   });
 *
 *   // Resolve a medication
 *   const result = await resolver.resolve("Gabitril", "medication");
 *   // → { name: "Tiagabine", score: 12.5, rank: 1 }
 *
 *   // Get top-5 candidates
 *   const results = await resolver.resolve("breast cancer malignant", "condition", 5);
 *   // → [{ name: "Breast Cancer", score: 16.8 }, ...]
 *
 * Architecture:
 *   Tier 1: Deterministic code lookup (your existing resolver, 94% accuracy)
 *   Tier 2: BM25 search (this module, 81% accuracy)
 *   Tier 3: LLM fallback (optional)
 */

// --- Tokenizer (matches the Python build script) ---

const STOP_WORDS = new Set(
  "a an and are as at be been being but by can could did do does for from had has have having he her here hers him his how i if in into is it its itself me more most my no nor not of off on once only or other our ours own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours".split(" ")
);

const SUFFIXES = [
  "ment", "ness", "tion", "sion", "able", "ible", "ance", "ence", "ful", "less", "ous", "ive",
  "ing", "edly", "edge", "ies", "ied", "est", "ed", "er", "ly", "al", "s",
].sort((a, b) => b.length - a.length);

function stem(word) {
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length > suffix.length + 2) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

function tokenize(text) {
  const tokens = (text.toLowerCase().match(/[a-z]{3,}/g) || []);
  return tokens
    .filter((t) => !STOP_WORDS.has(t) && t.length >= 3)
    .map(stem);
}

// --- BM25 Scoring ---

const BM25_K = 1.5;   // term frequency saturation
const BM25_B = 0.75;  // length normalization

function bm25Score(tf, idf, docLength, avgDocLength) {
  const tfNorm = (tf * (BM25_K + 1)) / (tf + BM25_K * (1 - BM25_B + BM25_B * (docLength / avgDocLength)));
  return idf * tfNorm;
}

// --- Resolver ---

export class BM25Resolver {
  /**
   * @param {Object} options
   * @param {string} options.baseUrl - Base URL where category_bm25.json.gz files are hosted
   * @param {boolean} options.debug - Enable debug logging
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || "./";
    this.debug = options.debug || false;
    this.cache = new Map(); // category → loaded index
  }

  /**
   * Load a category's BM25 index (cached after first load).
   * @param {string} category - "medication" | "lab" | "condition" | "procedure" | "vaccine"
   */
  async loadCategory(category) {
    if (this.cache.has(category)) return this.cache.get(category);

    const url = `${this.baseUrl}/${category}_bm25.json`;
    this._log(`Loading BM25 index: ${category} from ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load BM25 index for ${category}: ${response.status}`);
    }

    const index = await response.json();
    this._log(`  Loaded: ${index.num_records} records, ${Object.keys(index.idf).length} tokens`);

    this.cache.set(category, index);
    return index;
  }

  /**
   * Resolve a patient-friendly name via BM25 search.
   *
   * @param {string} query - Input display string (technical name, brand name, etc.)
   * @param {string} category - Category to search within
   * @param {number} topK - Number of results to return (default: 1)
   * @returns {Promise<{name: string|null, score: number, candidates: Array}>}
   */
  async resolve(query, category, topK = 1) {
    if (!query || !query.trim()) {
      return { name: null, score: 0, candidates: [] };
    }

    const index = await this.loadCategory(category);
    const queryTokens = tokenize(query);

    if (queryTokens.length === 0) {
      return { name: null, score: 0, candidates: [] };
    }

    // Score documents
    const scores = new Map(); // rid → score

    for (const token of queryTokens) {
      const postings = index.postings[token];
      if (!postings) continue;

      const idf = index.idf[token] || 0;
      if (idf <= 0) continue;

      for (const [rid, tf] of postings) {
        const docLength = index.doc_lengths[rid];
        const score = bm25Score(tf, idf, docLength, index.avg_doc_length);
        scores.set(rid, (scores.get(rid) || 0) + score);
      }
    }

    // Sort by score, get top-K
    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    // Map to friendly names (deduplicated)
    const candidates = [];
    const seenNames = new Set();

    for (const [rid, score] of ranked) {
      const nameIdx = index.rid_to_name[rid];
      const name = index.names[nameIdx];
      if (!seenNames.has(name)) {
        seenNames.add(name);
        candidates.push({ name, score: Math.round(score * 100) / 100 });
      }
    }

    const best = candidates[0] || { name: null, score: 0 };

    this._log(`  Query "${query.slice(0, 40)}" → top: "${best.name}" (score: ${best.score})`);
    return { name: best.name, score: best.score, candidates };
  }

  /**
   * Map FHIR resourceType to search category.
   * @param {string} resourceType
   * @returns {string|null}
   */
  static resourceTypeToCategory(resourceType) {
    const map = {
      MedicationRequest: "medication",
      Medication: "medication",
      MedicationStatement: "medication",
      MedicationAdministration: "medication",
      Observation: "lab",
      Condition: "condition",
      Procedure: "procedure",
      Immunization: "vaccine",
    };
    return map[resourceType] || null;
  }

  /**
   * Full resolution pipeline for a FHIR record.
   * Combines with deterministic lookup (Tier 1) and BM25 (Tier 2).
   *
   * @param {Object} record - FHIR-like record
   * @param {Object} deterministicResolver - Your existing deterministic resolver
   * @returns {Promise<{name: string, tier: string, confidence: number}>}
   */
  static async resolveRecord(record, deterministicResolver, bm25Resolver) {
    // Tier 1: Deterministic code lookup
    if (record?.concept?.coding?.[0]?.code) {
      const detResult = deterministicResolver.resolve(record);
      if (detResult?.name) {
        return { name: detResult.name, tier: "deterministic", confidence: 0.95 };
      }
    }

    // Tier 2: BM25 search
    const category = BM25Resolver.resourceTypeToCategory(record?.resourceType);
    const display = record?.concept?.coding?.[0]?.display
      || record?.concept?.text?.[0]
      || "";

    if (category && display) {
      const bm25Result = await bm25Resolver.resolve(display, category);
      if (bm25Result.name) {
        return {
          name: bm25Result.name,
          tier: "bm25",
          confidence: Math.min(bm25Result.score / 20, 0.85), // scale score to confidence
        };
      }
    }

    // Tier 3: No match (LLM fallback would go here)
    return { name: null, tier: "no_match", confidence: 0 };
  }

  _log(msg) {
    if (this.debug) console.log(`[BM25Resolver] ${msg}`);
  }

  /** Clear cache (useful for testing). */
  clearCache() {
    this.cache.clear();
  }

  /** Get stats about loaded indexes. */
  stats() {
    const stats = {};
    for (const [category, index] of this.cache) {
      stats[category] = {
        records: index.num_records,
        tokens: Object.keys(index.idf).length,
        names: index.names.length,
      };
    }
    return stats;
  }
}
