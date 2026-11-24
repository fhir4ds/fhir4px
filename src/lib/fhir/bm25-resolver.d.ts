export type MatchGrade = "certain" | "probable" | "possible";

export interface BM25Candidate {
  name: string;
  /** Raw term score before normalization (diagnostics only). */
  score: number;
  /** Score scaled to 0..1 by the rarest terms of the query. */
  normalized_score: number;
  match_grade: MatchGrade;
  /** The row's name is the query itself, after normalization. */
  exact_surface: boolean;
  friendly_name: string;
  code: string;
  system: string;
  canonical_code: string | null;
  canonical_system: string | null;
  ingredient_codes: string[];
}

export interface BM25Result {
  name: string | null;
  score: number;
  normalized_score: number;
  match_grade: MatchGrade | null;
  exact_surface: boolean;
  friendly_name: string | null;
  code: string | null;
  system: string | null;
  canonical_code: string | null;
  canonical_system: string | null;
  ingredient_codes: string[];
  candidates: BM25Candidate[];
}

export class BM25Resolver {
  constructor(options?: {
    baseUrl?: string;
    debug?: boolean;
    /** Per-category URL builder (overrides baseUrl/<category>_bm25.json). */
    categoryUrl?: (category: string) => string;
    /** Async index provider — overrides fetching entirely. */
    loadIndex?: (category: string) => Promise<unknown>;
  });
  loadCategory(category: string): Promise<unknown>;
  resolve(query: string, category: string, topK?: number): Promise<BM25Result>;
  static resourceTypeToCategory(resourceType: string): string | null;
  clearCache(): void;
  stats(): Record<string, { records: number; tokens: number; names: number }>;
}
