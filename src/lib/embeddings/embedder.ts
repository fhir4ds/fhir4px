/**
 * Embedding model wrapper for transformers.js.
 *
 * Loads Alibaba-NLP/gte-modernbert-base (143MB, q8 WASM) on first use and
 * caches the pipeline. All Tier 3 classification tasks share this single
 * model instance.
 *
 * The model loads lazily — only when the first embed() call is made. This
 * avoids adding to initial page load time. Once loaded, subsequent calls
 * are ~20-50ms per text (WASM, q8).
 */

const EMBEDDING_MODEL_ID = "Alibaba-NLP/gte-modernbert-base";

let pipelinePromise: Promise<unknown> | null = null;

type Extractor = (texts: string[], options: { pooling: string; normalize: boolean }) => Promise<{ tolist: () => number[][] }>;

async function getPipeline(): Promise<Extractor> {
  if (pipelinePromise) return pipelinePromise as Promise<Extractor>;

  pipelinePromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
      dtype: "q8",
      device: "wasm"
    });
    return extractor as Extractor;
  })();

  return pipelinePromise as Promise<Extractor>;
}

/**
 * Embed one or more texts into normalized vector space.
 *
 * @param texts - Input strings to embed
 * @returns Array of normalized embedding vectors (768-dim each)
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getPipeline();
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist();
}

/**
 * Embed a single text. Convenience wrapper for embed().
 */
export async function embedOne(text: string): Promise<number[]> {
  const vectors = await embed([text]);
  return vectors[0];
}

/**
 * Check whether the embedding model has been loaded (non-blocking).
 */
export function isEmbedderLoaded(): boolean {
  return pipelinePromise !== null;
}

/**
 * Pre-warm the embedding model. Call during idle time to avoid latency
 * on the first classification call.
 */
export async function preloadEmbedder(): Promise<void> {
  await getPipeline();
}
