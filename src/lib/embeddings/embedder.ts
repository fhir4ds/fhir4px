/**
 * Embedding model wrapper for transformers.js.
 *
 * Loads joelmontavon/fhir4px-embeddings-onnx (fp32 WASM) — a fhir4px-hosted
 * ONNX conversion of NeuML/pubmedbert-base-embeddings (PubMedBERT fine-tuned for
 * sentence similarity). Selected over gte-modernbert-base for better accuracy on
 * medical text: wins on 3 of 4 categorization tasks plus lab↔condition matching.
 *
 * Uses q8 dtype (standard int8 dynamic quantization). WASM-compatible —
 * no block-quantized operators. ~105MB download.
 */

const EMBEDDING_MODEL_ID = "joelmontavon/fhir4px-embeddings-onnx";

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
