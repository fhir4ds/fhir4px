/**
 * Embedding model wrapper for transformers.js.
 *
 * Loads joelmontavon/fhir4px-embeddings-onnx (q8) — a fhir4px-hosted ONNX
 * conversion of NeuML/pubmedbert-base-embeddings (PubMedBERT fine-tuned for
 * sentence similarity). Selected over gte-modernbert-base for better accuracy
 * on medical text: wins on 3 of 4 categorization tasks plus lab↔condition
 * matching.
 *
 * Prefers WebGPU (3-10× faster inference). Falls back to WASM if WebGPU is
 * unavailable or crashes. ~105MB download.
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

    const isNode = typeof process !== "undefined" && process.versions?.node;
    const hasWebGPU = !isNode && typeof navigator !== "undefined" && "gpu" in navigator;
    // Browser: "webgpu" → "wasm" fallback. Node: "cpu" (no wasm backend).
    const device = hasWebGPU ? "webgpu" : isNode ? "cpu" : "wasm";

    try {
      const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
        dtype: "q8",
        device
      });
      return extractor as Extractor;
    } catch (error) {
      if (device === "webgpu") {
        console.warn("[fhir4px:embeddings]", {
          event: "webgpu-fallback",
          error: error instanceof Error ? error.message : String(error),
          message: "WebGPU failed for embeddings — falling back to WASM"
        });
        const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
          dtype: "q8",
          device: "wasm"
        });
        return extractor as Extractor;
      }
      throw error;
    }
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
