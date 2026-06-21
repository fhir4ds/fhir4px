export interface BM25Result {
  name: string | null;
  score: number;
  candidates: Array<{ name: string; score: number }>;
}
export class BM25Resolver {
  constructor(options?: { baseUrl?: string; debug?: boolean });
  loadCategory(category: string): Promise<unknown>;
  resolve(query: string, category: string, topK?: number): Promise<BM25Result>;
  static resourceTypeToCategory(resourceType: string): string | null;
  clearCache(): void;
  stats(): Record<string, { records: number; tokens: number; names: number }>;
}
