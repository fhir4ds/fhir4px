export interface BM25Candidate {
  name: string;
  score: number;
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
  friendly_name: string | null;
  code: string | null;
  system: string | null;
  canonical_code: string | null;
  canonical_system: string | null;
  ingredient_codes: string[];
  candidates: BM25Candidate[];
}

export class BM25Resolver {
  constructor(options?: { baseUrl?: string; debug?: boolean });
  loadCategory(category: string): Promise<unknown>;
  resolve(query: string, category: string, topK?: number): Promise<BM25Result>;
  static resourceTypeToCategory(resourceType: string): string | null;
  clearCache(): void;
  stats(): Record<string, { records: number; tokens: number; names: number }>;
}
