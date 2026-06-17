/**
 * Transformers.js LLM wrapper (Tier 4) — replaces WebLLM for generative tasks.
 *
 * Uses transformers.js text-generation pipeline to run Gemma 4 E2B-it in the
 * browser via ONNX Runtime (WASM or WebGPU). This module will replace the
 * WebLLM integration (~3000 lines in webllm.ts) once the fine-tuned Gemma 4
 * model is validated.
 *
 * Current model: onnx-community/gemma-4-E2B-it-qat-mobile-ONNX (QAT mobile, WASM-optimized)
 * Target model: joelmontavon/fhir4px-gemma4-e2b-onnx (fine-tuned, pending)
 *
 * The model ID is configurable via the LLM_MODEL_ID constant below — swap it
 * when the fine-tuned model is published to HuggingFace.
 */

// ── Model configuration ──────────────────────────────────────────────────

/**
 * Default model. Change this to the fine-tuned model once published:
 *   "joelmontavon/fhir4px-gemma4-e2b-onnx"
 *
 * Can also be overridden at runtime via sessionStorage:
 *   sessionStorage.setItem("fhir4px_llm_model_id", "joelmontavon/...")
 */
const DEFAULT_LLM_MODEL_ID = "onnx-community/gemma-4-E2B-it-qat-mobile-ONNX";

function activeModelId(): string {
  if (typeof sessionStorage !== "undefined") {
    const override = sessionStorage.getItem("fhir4px_llm_model_id");
    if (override) return override;
  }
  return DEFAULT_LLM_MODEL_ID;
}

// ── Pipeline management ──────────────────────────────────────────────────

type Generator = (
  messages: Array<{ role: string; content: string }>,
  options?: {
    max_new_tokens?: number;
    temperature?: number;
    do_sample?: boolean;
  }
) => Promise<Array<{ generated_text: Array<{ role: string; content: string }> }>>;

let generatorPromise: Promise<Generator> | null = null;

async function getGenerator(): Promise<Generator> {
  if (generatorPromise) return generatorPromise;

  generatorPromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    env.allowRemoteModels = true;

    const modelId = activeModelId();
    console.info("[fhir4px:transformers-llm]", {
      event: "llm-load-start",
      modelId,
      message: "Downloading AI model (this may take 30-60 seconds on first load)",
      timestamp: new Date().toISOString()
    });

    const startedAt = performance.now();
    try {
      const generator = await pipeline("text-generation", modelId, {
        dtype: "q8",
        device: "wasm",
        progress_callback: (data: unknown) => {
          const event = data as { status?: string; file?: string; loaded?: number; total?: number; progress?: number };
          if (event?.status === "progress" && event.file) {
            const pct = event.total ? Math.round((event.loaded ?? 0) / event.total * 100) : null;
            console.info("[fhir4px:transformers-llm]", {
              event: "model-download-progress",
              file: event.file.split("/").pop(),
              loaded: event.loaded,
              total: event.total,
              percent: pct,
              timestamp: new Date().toISOString()
            });
          } else if (event?.status === "done" && event.file) {
            console.info("[fhir4px:transformers-llm]", {
              event: "model-download-done",
              file: event.file.split("/").pop(),
              timestamp: new Date().toISOString()
            });
          }
        }
      });
      const elapsedMs = Math.round(performance.now() - startedAt);

      console.info("[fhir4px:transformers-llm]", {
        event: "llm-load-success",
        modelId,
        elapsedMs,
        timestamp: new Date().toISOString()
      });

      return generator as Generator;
    } catch (error) {
      console.error("[fhir4px:transformers-llm]", {
        event: "llm-load-failed",
        modelId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  })();

  return generatorPromise;
}

// ── Public API ───────────────────────────────────────────────────────────

export interface LlmCompletionRequest {
  systemPrompt: string;
  userPayload: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmCompletionResult {
  content: string;
  elapsedMs: number;
}

/**
 * Generate a completion from the LLM using a system + user message pair.
 *
 * Returns the raw text content. JSON parsing is left to the caller — the
 * model may wrap JSON in markdown fences or add preamble text.
 */
export async function generate(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
  const generator = await getGenerator();
  const messages = [
    { role: "system", content: request.systemPrompt },
    { role: "user", content: request.userPayload }
  ];

  const startedAt = performance.now();
  const reply = await generator(messages, {
    max_new_tokens: request.maxTokens ?? 180,
    temperature: request.temperature ?? 0,
    do_sample: (request.temperature ?? 0) > 0
  });
  const elapsedMs = Math.round(performance.now() - startedAt);

  const content = reply[0]?.generated_text?.at(-1)?.content ?? "";

  return { content, elapsedMs };
}

/**
 * Generate a completion and parse the output as JSON.
 *
 * Extracts the first {...} block from the response (handles markdown fences
 * and prose preamble). Returns null if no valid JSON is found.
 */
export async function generateJson<T>(request: LlmCompletionRequest): Promise<{ parsed: T | null; raw: string; elapsedMs: number }> {
  const { content, elapsedMs } = await generate(request);

  let parsed: T | null = null;
  try {
    // Try direct parse first
    parsed = JSON.parse(content) as T;
  } catch {
    // Extract first {...} block
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]) as T;
      } catch {
        // Not valid JSON
      }
    }
  }

  return { parsed, raw: content, elapsedMs };
}

/**
 * Check if the LLM has been loaded (non-blocking).
 */
export function isLlmLoaded(): boolean {
  return generatorPromise !== null;
}

/**
 * Pre-warm the LLM. Call during idle time to avoid latency on first use.
 */
export async function preloadLlm(): Promise<void> {
  await getGenerator();
}

/**
 * Get the active model ID (for logging/debugging).
 */
export function getLlmModelId(): string {
  return activeModelId();
}
