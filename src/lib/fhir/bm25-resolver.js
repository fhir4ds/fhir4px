/**
 * fhir4px BM25 Patient-Friendly Name Resolver
 *
 * Text search over the fhir4ds/terminology lexical indexes (format v3) for
 * records that carry no usable code. Tier 1 is the deterministic code
 * lookup; this is Tier 2.
 *
 * The ranking is a direct port of the terminology server's lexical search
 * (medterm4ds `SearchService.lexical`, services/search.py), so the same
 * query gives the same answer here as against the server:
 *   - a query is split into letter-or-digit runs of 2+ characters, because
 *     the indexes keep acronyms and alphanumerics ("a1c", "hba1c", "td")
 *   - every token scores its exact posting key, or else its letter runs
 *     and their stems
 *   - tokens the index does not carry (short acronyms) are recovered from
 *     the row text when a row covers the whole query
 *   - rows rank by exact surface, then normalized score, then the edit
 *     distance between the query and the row's name
 *
 * Indexes are shared with the terminology code map (same loader, same
 * release, same per-session cache).
 */

// --- Text normalization (as the index build and the server do it) ---

function stripAccents(text) {
  return String(text).normalize("NFD").replace(/\p{M}/gu, "");
}

/** Lowercase accent-folded letter/digit runs joined by single spaces. */
function surfaceKey(text) {
  return (stripAccents(String(text).toLowerCase()).match(/[a-z0-9]+/g) || []).join(" ");
}

/** Query tokens for posting lookup: runs of 2+ letters/digits. */
function queryTokensOf(query) {
  return stripAccents(String(query).toLowerCase()).match(/[a-z0-9]{2,}/g) || [];
}

/** Query tokens in their typed case; the first spelling of each wins. */
function typedTokensOf(query) {
  const byLower = new Map();
  for (const typed of stripAccents(String(query)).match(/[A-Za-z0-9]{2,}/g) || []) {
    const lower = typed.toLowerCase();
    if (!byLower.has(lower)) byLower.set(lower, typed);
  }
  return byLower;
}

function isPureWord(token) {
  return /^[a-z]{3,}$/.test(token);
}

// --- Stemmer (the one the indexes were built with) ---

const STEM_SUFFIXES = [
  "ational", "tional", "iveness", "fulness", "ousness", "ization", "ation", "ations",
  "izer", "ator", "alism", "iciti", "ical", "ness", "ements", "ement", "ments", "ment",
  "iences", "ience", "iable", "ing", "ies", "ied", "ily", "sses", "ss", "s", "y", "e",
];

function stemToken(word) {
  const token = word.toLowerCase();
  for (const suffix of STEM_SUFFIXES) {
    if (!token.endsWith(suffix) || token.length <= suffix.length + 2) continue;
    if (suffix === "ies" || suffix === "ied") return `${token.slice(0, -3)}i`;
    if (suffix === "sses") return token.slice(0, -2);
    // "s" and "e" always drop one letter, including after "ss" ("mass" → "mas").
    if (suffix === "s" || suffix === "e") return token.slice(0, -1);
    if (suffix === "ing") return token.slice(0, -3);
    if (suffix === "y") return `${token.slice(0, -1)}i`;
    return token.slice(0, -suffix.length);
  }
  return token;
}

// --- Candidate posting keys for one query token ---

function hasPosting(postings, key) {
  return Object.prototype.hasOwnProperty.call(postings, key);
}

/**
 * Posting keys a token can look up. An alphanumeric or short key that the
 * index carries is exact evidence and is used alone. Otherwise the token's
 * letter runs (3+ letters) and their stems are tried.
 */
function postingCandidates(token, postings) {
  const candidates = [];
  if (hasPosting(postings, token) && !isPureWord(token)) return [token];
  const runs = isPureWord(token) ? [token] : token.match(/[a-z]{3,}/g) || [];
  for (const run of runs) {
    candidates.push(run);
    const stemmed = stemToken(run);
    if (stemmed !== run) candidates.push(stemmed);
  }
  return [...new Set(candidates)].filter((key) => hasPosting(postings, key));
}

// --- Tie-break helpers ---

/**
 * Normalized Damerau-Levenshtein distance between a surface key and a
 * row's surface key (0 = identical), by the longer string's length.
 */
function surfaceDistance(queryKey, text, cap = 64) {
  const a = queryKey.slice(0, cap);
  const b = surfaceKey(text).slice(0, cap);
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 1;
  let prev2 = null;
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i += 1) {
    const cur = [i, ...new Array(lb).fill(0)];
    for (let j = 1; j <= lb; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], (prev2 || cur)[j - 2] + 1);
      }
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[lb] / Math.max(la, lb);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How many cased acronym tokens appear in `text` as typed or uppercased. */
function casedTokenHits(typedTokens, text) {
  const haystack = stripAccents(text);
  let hits = 0;
  for (const typed of typedTokens) {
    if (typed === typed.toLowerCase()) continue;
    const pattern = new RegExp(`\\b(?:${escapeRegExp(typed)}|${escapeRegExp(typed.toUpperCase())})\\b`);
    if (pattern.test(haystack)) hits += 1;
  }
  return hits;
}

function compareTuples(left, right) {
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

function tuplesEqual(left, right) {
  return compareTuples(left, right) === 0;
}

/**
 * Sort by `fullKey`, computing it only for rows that can reach the top
 * `count` (same result as sorting everything by `fullKey`, when `cheapKey`
 * is a prefix of `fullKey`).
 */
function sortedLazySurfaceTiebreak(rows, cheapKey, fullKey, count) {
  const ordered = [...rows].sort((left, right) => compareTuples(cheapKey(left), cheapKey(right)));
  if (ordered.length <= count) {
    ordered.sort((left, right) => compareTuples(fullKey(left), fullKey(right)));
    return ordered;
  }
  const boundary = cheapKey(ordered[count - 1]);
  let end = count;
  while (end < ordered.length && tuplesEqual(cheapKey(ordered[end]), boundary)) end += 1;
  const kept = ordered.slice(0, end);
  kept.sort((left, right) => compareTuples(fullKey(left), fullKey(right)));
  return kept;
}

function scoreToGrade(score) {
  if (score >= 0.8) return "certain";
  if (score >= 0.4) return "probable";
  return "possible";
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;

/** tf saturation with length normalization, the BM25 term component. */
function tfComponent(tf, docLength, avgDocLength) {
  return (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / avgDocLength)));
}

function rowAt(list, rid, fallback) {
  return rid < list.length ? list[rid] : fallback;
}

/**
 * Ranked rows for one category index: [{rid, score, normalized, grade,
 * exactSurface}], best first, at most `count` rows.
 */
function lexicalSearch(index, query, count) {
  const tokens = queryTokensOf(query);
  if (tokens.length === 0) return [];

  const postings = index.postings || {};
  const idf = index.idf || {};
  const namesRaw = index.names || [];
  const docLengths = index.doc_lengths || [];
  const avgDocLength = index.avg_doc_length || 20.0;
  const friendly = index.rid_to_friendly_name || [];
  const numRecords = index.num_records || 0;
  const typedByLower = typedTokensOf(query);

  const scores = new Map();
  const matchedIdfs = [];
  const orphanTokens = [];

  for (const rawToken of tokens) {
    let keys = postingCandidates(rawToken, postings);
    // Alphanumeric and short keys that most rows carry say nothing.
    if (numRecords) {
      keys = keys.filter((key) => isPureWord(key) || postings[key].length <= 0.15 * numRecords);
    }
    if (keys.length === 0) {
      orphanTokens.push(rawToken);
      continue;
    }
    // A two-letter key is an acronym: it only counts for rows that carry
    // it spelled as the query typed it.
    const guarded = new Map();
    const kept = [];
    for (const key of keys) {
      if (/^[a-z]{2}$/.test(key)) {
        const typed = typedByLower.get(key) ?? key;
        const rids = twoCharCasedRows(index, key).filter(([, word]) => word === typed || word === typed.toUpperCase()).map(([rid]) => rid);
        if (rids.length > 0) {
          guarded.set(key, new Set(rids));
          kept.push(key);
        }
      } else {
        kept.push(key);
      }
    }
    if (kept.length === 0) {
      orphanTokens.push(rawToken);
      continue;
    }
    matchedIdfs.push(Math.max(...kept.map((key) => idf[key] ?? 1.0)));
    for (const key of kept) {
      const tokenIdf = idf[key] ?? 1.0;
      for (const entry of postings[key]) {
        const rid = entry[0];
        const tf = entry[1];
        if (guarded.has(key) && !guarded.get(key).has(rid)) continue;
        const docLength = rowAt(docLengths, rid, avgDocLength);
        scores.set(rid, (scores.get(rid) ?? 0) + tokenIdf * tfComponent(tf, docLength, avgDocLength));
      }
    }
  }

  // Tokens the index does not carry: a row whose text covers the whole
  // query scores like a single term hit, with the rarest term's weight.
  let orphanOnly = new Set();
  if (orphanTokens.length > 0) {
    const orphanIdf = maxValue(idf);
    for (let i = 0; i < orphanTokens.length; i += 1) matchedIdfs.push(orphanIdf);
    const postingRids = new Set(scores.keys());
    const tokenSet = new Set(tokens);
    const longestFirst = [...tokenSet].sort((left, right) => right.length - left.length);
    const rest = longestFirst.slice(1);
    const typedOrphans = orphanTokens.map((token) => typedByLower.get(token) ?? token);
    const touched = new Set();
    const rowCount = Math.max(namesRaw.length, friendly.length);
    for (let rid = 0; rid < rowCount; rid += 1) {
      const nameRaw = rowAt(namesRaw, rid, "");
      const friendlyName = rowAt(friendly, rid, "");
      const low = `${nameRaw} ${friendlyName}`.toLowerCase();
      // Substring checks first; the exact coverage check only on survivors.
      if (!low.includes(longestFirst[0])) continue;
      if (rest.some((token) => !low.includes(token))) continue;
      if (!coversTokens(tokenSet, queryTokensOf(low))) continue;
      const docLength = rowAt(docLengths, rid, avgDocLength);
      const casedHits = Math.max(casedTokenHits(typedOrphans, nameRaw), casedTokenHits(typedOrphans, friendlyName));
      const boost = 1 + 0.5 * casedHits;
      scores.set(rid, (scores.get(rid) ?? 0) + orphanIdf * tfComponent(1, docLength, avgDocLength) * orphanTokens.length * boost);
      touched.add(rid);
    }
    for (const rid of touched) if (!postingRids.has(rid)) orphanOnly.add(rid);
  }

  const idfDenominator = matchedIdfs.reduce((sum, value) => sum + value, 0) * 2.5 + 0.001;
  const queryKey = surfaceKey(query);
  // A surface key is never longer than its text, so this rejects most rows
  // without normalizing them.
  const matchesKey = (text) => text.length >= queryKey.length && surfaceKey(text) === queryKey;
  const exactCache = new Map();
  const rowExact = (rid) => {
    if (exactCache.has(rid)) return exactCache.get(rid);
    const hit = matchesKey(rowAt(friendly, rid, String(rid))) || matchesKey(rowAt(namesRaw, rid, ""));
    exactCache.set(rid, hit);
    return hit;
  };
  const codeOf = (rid) => rowAt(index.rid_to_code || [], rid, String(rid));
  const rowRank = ([rid, score]) => [
    !rowExact(rid),
    -score,
    surfaceDistance(queryKey, rowAt(friendly, rid, codeOf(rid))),
    String(codeOf(rid)),
  ];
  const cheapKey = ([rid, score]) => [!rowExact(rid), -score];

  // Server order across the returned rows: exact surface, then the score
  // rounded to four decimals, then name distance, then code. Rounding makes
  // near-equal scores tie, so the name text settles them.
  const finalKey = (row) => {
    const display = rowAt(friendly, row.rid, codeOf(row.rid));
    return [!row.exactSurface, -row.normalized, surfaceDistance(queryKey, display), String(codeOf(row.rid))];
  };
  return sortedLazySurfaceTiebreak([...scores.entries()], cheapKey, rowRank, count)
    .slice(0, count)
    .map(([rid, score]) => {
      const normalized = Math.min(score / idfDenominator, 1);
      let grade = scoreToGrade(normalized);
      // A row matched only through its text is weaker evidence than a term
      // match, unless its name is the query itself.
      if (orphanOnly.has(rid) && grade === "certain" && !rowExact(rid)) grade = "probable";
      return { rid, score, normalized: Math.round(normalized * 10000) / 10000, grade, exactSurface: rowExact(rid) };
    })
    .sort((left, right) => compareTuples(finalKey(left), finalKey(right)));
}

/** True when every token of `required` is among `present`. */
function coversTokens(required, present) {
  const have = new Set(present);
  for (const token of required) if (!have.has(token)) return false;
  return true;
}

/** Largest value in an index's idf table, 1.0 when the table is empty. */
function maxValue(idf) {
  let best = 1.0;
  let any = false;
  for (const key in idf) {
    if (!hasPosting(idf, key)) continue;
    if (!any || idf[key] > best) best = idf[key];
    any = true;
  }
  return best;
}

/**
 * Rows of an index carrying a two-letter acronym, with the word's case:
 * [[rid, word], ...]. Cached on the index; the index never changes.
 */
function twoCharCasedRows(index, key) {
  let cache = index.__twoCharCased;
  if (!cache) {
    cache = new Map();
    Object.defineProperty(index, "__twoCharCased", { value: cache, enumerable: false, writable: false, configurable: false });
  }
  if (cache.has(key)) return cache.get(key);
  const rows = [];
  const names = index.names || [];
  const seen = new Set();
  for (const entry of (index.postings || {})[key] || []) {
    const rid = entry[0];
    if (seen.has(rid) || rid >= names.length) continue;
    seen.add(rid);
    for (const word of stripAccents(names[rid] || "").match(/\b[a-zA-Z]{2}\b/g) || []) {
      if (word.toLowerCase() === key) rows.push([rid, word]);
    }
  }
  cache.set(key, rows);
  return rows;
}

// --- Resolver ---

function emptyResult() {
  return {
    name: null,
    score: 0,
    normalized_score: 0,
    match_grade: null,
    exact_surface: false,
    friendly_name: null,
    code: null,
    system: null,
    canonical_code: null,
    canonical_system: null,
    ingredient_codes: [],
    candidates: [],
  };
}

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
    this._log(`  Loaded: ${index.num_records} records, ${Object.keys(index.idf || {}).length} tokens`);

    this.cache.set(category, index);
    return index;
  }

  /**
   * Search one category for a record name.
   *
   * @param {string} query - Input display string
   * @param {string} category - Category to search within
   * @param {number} topK - Number of results (default: 1)
   * @returns {Promise<object>} best match plus the top-K candidates
   */
  async resolve(query, category, topK = 1) {
    if (!query || !query.trim()) return emptyResult();

    const index = await this.loadCategory(category);
    const rows = lexicalSearch(index, query, topK);
    const candidates = rows.map((row) => this._candidateForRid(index, row));

    const best = candidates[0] || emptyResult();
    this._log(`  Query "${query.slice(0, 40)}" → top: "${best.friendly_name || best.name}" (code: ${best.code}, score: ${best.normalized_score}, ${best.match_grade})`);

    return {
      name: best.name,
      score: best.score,
      normalized_score: best.normalized_score,
      match_grade: best.match_grade,
      exact_surface: best.exact_surface,
      friendly_name: best.friendly_name,
      code: best.code,
      system: best.system,
      canonical_code: best.canonical_code,
      canonical_system: best.canonical_system,
      ingredient_codes: best.ingredient_codes,
      candidates,
    };
  }

  _candidateForRid(index, row) {
    const rid = row.rid;
    const name = index.names?.[rid] ?? null;
    const friendlyName = index.rid_to_friendly_name?.[rid] ?? name;
    return {
      name,
      friendly_name: friendlyName,
      code: index.rid_to_code?.[rid] ?? null,
      system: index.rid_to_system?.[rid] ?? null,
      canonical_code: index.rid_to_canonical_code?.[rid] ?? null,
      canonical_system: index.rid_to_canonical_system?.[rid] ?? null,
      ingredient_codes: index.rid_to_ingredient_codes?.[rid] ?? [],
      score: Math.round(row.score * 100) / 100,
      normalized_score: row.normalized,
      match_grade: row.grade,
      exact_surface: row.exactSurface,
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
        tokens: Object.keys(index.idf || {}).length,
        names: index.names?.length ?? 0,
      };
    }
    return stats;
  }
}
