/**
 * fhir4px BM25 Patient-Friendly Name Resolver
 *
 * Tier 2 fallback for FHIR records without a code.
 * Uses pre-built per-category BM25 inverted indexes.
 *
 * Updated for v2 indexes that return code, system, friendly_name,
 * canonical_code, and ingredient_codes per record.
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
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || "./";
    this.debug = options.debug || false;
    this.cache = new Map();
    // Optional per-category URL builder (e.g. the fhir4ds/terminology
    // lexical indexes live at lexical/<release>/<category>.json).
    this.categoryUrl = options.categoryUrl || null;
    // Optional async index provider — when set, loadCategory delegates to
    // it instead of fetching (lets callers share one release-pinned cache).
    this.loadIndex = options.loadIndex || null;
  }

  async loadCategory(category) {
    if (this.cache.has(category)) return this.cache.get(category);

    let index;
    if (this.loadIndex) {
      index = await this.loadIndex(category);
    } else {
      const url = this.categoryUrl
        ? this.categoryUrl(category)
        : `${this.baseUrl}/${category}_bm25.json`;
      this._log(`Loading BM25 index: ${category} from ${url}`);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load BM25 index for ${category}: ${response.status}`);
      }

      index = await response.json();
    }
    this._log(`  Loaded: ${index.num_records} records, ${Object.keys(index.idf).length} tokens`);

    this.cache.set(category, index);
    return index;
  }

  /**
   * Resolve a patient-friendly name via BM25 search.
   *
   * @param {string} query - Input display string
   * @param {string} category - Category to search within
   * @param {number} topK - Number of results (default: 1)
   * @returns {Promise<object>}
   */
  async resolve(query, category, topK = 1) {
    if (!query || !query.trim()) {
      return { name: null, score: 0, friendly_name: null, code: null, system: null, canonical_code: null, canonical_system: null, ingredient_codes: [], candidates: [] };
    }

    const index = await this.loadCategory(category);
    const queryTokens = tokenize(query);

    // Exact-match fast path: real-world feeds often carry the consumer or
    // source name verbatim. Short tokens the tokenizer drops (e.g. "A1c")
    // would otherwise skew BM25 toward wrong same-family terms.
    const normalized = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const normalizedQuery = normalized(query);
    if (normalizedQuery) {
      const exactRid = index.names.findIndex(
        (name, rid) => normalized(name) === normalizedQuery || normalized(index.rid_to_friendly_name?.[rid]) === normalizedQuery
      );
      if (exactRid >= 0) {
        const candidate = this._candidateForRid(index, exactRid, 50);
        return { ...candidate, candidates: [candidate] };
      }
    }

    if (queryTokens.length === 0) {
      return { name: null, score: 0, friendly_name: null, code: null, system: null, canonical_code: null, canonical_system: null, ingredient_codes: [], candidates: [] };
    }

    // Score documents
    const scores = new Map();

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

    // Map to results with per-record metadata from the v2 index
    const candidates = [];
    const seenNames = new Set();

    for (const [rid, score] of ranked) {
      const candidate = this._candidateForRid(index, rid, score);
      const dedupKey = candidate.friendly_name || candidate.name;
      if (dedupKey && !seenNames.has(dedupKey)) {
        seenNames.add(dedupKey);
        candidates.push(candidate);
      }
    }

    const best = candidates[0] || { name: null, score: 0, friendly_name: null, code: null, system: null, canonical_code: null, canonical_system: null, ingredient_codes: [] };

    this._log(`  Query "${query.slice(0, 40)}" → top: "${best.friendly_name || best.name}" (code: ${best.code}, score: ${best.score})`);

    return {
      name: best.name,
      score: best.score,
      friendly_name: best.friendly_name,
      code: best.code,
      system: best.system,
      canonical_code: best.canonical_code,
      canonical_system: best.canonical_system,
      ingredient_codes: best.ingredient_codes,
      candidates
    };
  }

  _candidateForRid(index, rid, score) {
    const name = index.names[rid] ?? null;
    const friendlyName = index.rid_to_friendly_name?.[rid] ?? name;
    return {
      name,
      friendly_name: friendlyName,
      code: index.rid_to_code?.[rid] ?? null,
      system: index.rid_to_system?.[rid] ?? null,
      canonical_code: index.rid_to_canonical_code?.[rid] ?? null,
      canonical_system: index.rid_to_canonical_system?.[rid] ?? null,
      ingredient_codes: index.rid_to_ingredient_codes?.[rid] ?? [],
      score: Math.round(score * 100) / 100
    };
  }

  /**
   * Map FHIR resourceType to search category.
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

  _log(msg) {
    if (this.debug) console.log(`[BM25Resolver] ${msg}`);
  }

  clearCache() {
    this.cache.clear();
  }

  stats() {
    const stats = {};
    for (const [category, index] of this.cache) {
      stats[category] = {
        records: index.num_records,
        tokens: Object.keys(index.idf).length,
        names: index.names?.length ?? 0,
      };
    }
    return stats;
  }
}
