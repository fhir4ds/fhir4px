/**
 * Transformers.js LLM wrapper (Tier 4) — replaces WebLLM for generative tasks.
 *
 * Uses transformers.js text-generation pipeline to run an ONNX LLM in the
 * browser via ONNX Runtime (WebGPU when available, WASM otherwise).
 *
 * Current model: onnx-community/Llama-3.2-1B-Instruct-ONNX — off-the-shelf
 * Llama 3.2 1B Instruct. Selected over our fine-tuned model
 * (joelmontavon/fhir4px-llama32-1b-finetuned-onnx) because the fine-tuned
 * repo only ships q8 weights while onnx-community ships the full quantization
 * matrix (q4, q4f16, int8, fp16). The off-the-shelf model lets us pick q4f16
 * on WebGPU for ~5-10x faster inference than q8 on WASM.
 *
 * Trade-off: we lose the fhir4px naming/association fine-tuning. The off-the-
 * shelf model is reliable at JSON but doesn't follow our patient-friendly-name
 * conventions as tightly. Swap back to the fine-tuned model once it ships q4.
 *
 * The model ID is configurable at runtime via sessionStorage:
 *   sessionStorage.setItem("fhir4px_llm_model_id", "joelmontavon/...")
 */

// ── Model configuration ──────────────────────────────────────────────────

const DEFAULT_LLM_MODEL_ID = "onnx-community/Llama-3.2-1B-Instruct-ONNX";

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

/**
 * Llama 3.2 Instruct chat template (system + user + assistant, no tools).
 * Reference: meta-llama/Llama-3.2-1B-Instruct tokenizer_config.json.
 *
 * Used as a fallback when the loaded tokenizer is missing `chat_template` —
 * a common artifact of fine-tuning + ONNX re-export where the upload omits
 * the template field. transformers.js's text-generation pipeline calls
 * `apply_chat_template()` on every inference, which throws if the field is
 * unset. We patch it after load so the message-based API keeps working
 * without waiting for the model team to re-upload tokenizer_config.json.
 */
const LLAMA_32_CHAT_TEMPLATE =
  "{{- bos_token }}" +
  "{%- for message in messages %}" +
  "{{- '<|start_header_id|>' + message['role'] + '<|end_header_id|>\\n\\n' + message['content'] | trim + '<|eot_id|>' }}" +
  "{%- endfor %}" +
  "{%- if add_generation_prompt %}" +
  "{{- '<|start_header_id|>assistant<|end_header_id|>\\n\\n' }}" +
  "{%- endif %}";

interface PipelineWithTokenizer {
  tokenizer?: {
    chat_template?: string;
    name_or_path?: string;
  };
}

export type LlmLoadStatus = "idle" | "downloading" | "loading" | "ready" | "failed";

type LlmLoadListener = (status: LlmLoadStatus, error?: Error) => void;

const loadListeners = new Set<LlmLoadListener>();

let generatorPromise: Promise<Generator> | null = null;
let isReady = false;
let loadError: Error | null = null;
let webgpuFailed = false;

function emitLoadStatus(status: LlmLoadStatus, error?: Error): void {
  for (const listener of loadListeners) {
    try {
      listener(status, error);
    } catch {
      // Listener errors shouldn't affect other subscribers
    }
  }
}

/**
 * Subscribe to LLM load status changes. Returns an unsubscribe function.
 * The listener is immediately invoked once with the current status.
 *
 * Used by the UI to show "Loading AI model..." vs the normal in-progress
 * status — the AppFrame preload starts on mount, so the load promise
 * exists immediately, but the UI needs to know when it actually resolves.
 */
export function subscribeLlmLoadStatus(listener: LlmLoadListener): () => void {
  loadListeners.add(listener);
  // Emit current state immediately so callers don't need a separate poll
  if (isReady) listener("ready");
  else if (loadError) listener("failed", loadError);
  else if (generatorPromise) listener("loading");
  else listener("idle");
  return () => {
    loadListeners.delete(listener);
  };
}

async function getGenerator(): Promise<Generator> {
  if (generatorPromise) return generatorPromise;

  generatorPromise = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    env.allowRemoteModels = true;

    // Prefer WebGPU when available — 3-5× faster than WASM for autoregressive
    // decoding. Fall back to WASM if the browser doesn't expose navigator.gpu
    // OR if a previous WebGPU session crashed (device lost).
    const hasWebGPU = !webgpuFailed && typeof navigator !== "undefined" && "gpu" in navigator;
    const device = hasWebGPU ? "webgpu" : "wasm";

    // Run ORT inference in a Web Worker so the main thread stays responsive.
    // Only enable proxy for WASM — proxy mode was designed for the WASM
    // backend and on some setups it routes WebGPU calls through worker IPC
    // in a way that destroys performance (we observed 60-150x slowdown
    // with proxy=true + device=webgpu on Windows). WebGPU inference is
    // already async, so the main thread stays responsive without proxy.
    if (device === "wasm" && env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.proxy = true;
    }
    // q4f16 = 4-bit weights with fp16 activations. Smallest file size and
    // fastest on WebGPU. Falls back to q8 (8-bit ints) if the q4f16 export
    // isn't present or hits an unsupported operator.
    const preferredDtype = "q4f16";
    const fallbackDtype = "q8";

    const modelId = activeModelId();
    console.info("[fhir4px:transformers-llm]", {
      event: "llm-load-start",
      modelId,
      message: "Downloading AI model (this may take 30-60 seconds on first load)",
      timestamp: new Date().toISOString()
    });

    const startedAt = performance.now();
    let downloadStarted = false;
    const progressCallback = (data: unknown) => {
      const event = data as { status?: string; file?: string; loaded?: number; total?: number; progress?: number };
      if (event?.status === "progress" && event.file) {
        if (!downloadStarted) {
          downloadStarted = true;
          emitLoadStatus("downloading");
        }
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
    };

    try {
      // Try preferred dtype on the chosen device. If it fails (unsupported op,
      // missing file, etc.), fall back to the fallback dtype before giving up.
      let generator;
      let usedDtype = preferredDtype;
      let usedDevice = device;
      try {
        console.info("[fhir4px:transformers-llm]", {
          event: "pipeline-attempt",
          modelId,
          dtype: preferredDtype,
          device,
          timestamp: new Date().toISOString()
        });
        generator = await pipeline("text-generation", modelId, {
          dtype: preferredDtype,
          device,
          progress_callback: progressCallback
        });
      } catch (primaryError) {
        console.warn("[fhir4px:transformers-llm]", {
          event: "pipeline-primary-failed",
          modelId,
          dtype: preferredDtype,
          device,
          error: primaryError instanceof Error ? primaryError.message : String(primaryError),
          fallbackDtype,
          timestamp: new Date().toISOString()
        });
        usedDtype = fallbackDtype;
        // If WebGPU was the primary and failed, also fall back to WASM device
        if (device === "webgpu") {
          usedDevice = "wasm";
        }
        generator = await pipeline("text-generation", modelId, {
          dtype: fallbackDtype,
          device: usedDevice,
          progress_callback: progressCallback
        });
      }
      console.info("[fhir4px:transformers-llm]", {
        event: "pipeline-loaded",
        modelId,
        dtype: usedDtype,
        device: usedDevice,
        timestamp: new Date().toISOString()
      });

      // Files downloaded — now loading the model into memory
      emitLoadStatus("loading");

      // Patch missing chat_template. Without this, transformers.js throws on
      // every call: "Cannot use apply_chat_template() because
      // tokenizer.chat_template is not set".
      const pipelineObj = generator as unknown as PipelineWithTokenizer;
      if (pipelineObj.tokenizer && !pipelineObj.tokenizer.chat_template) {
        pipelineObj.tokenizer.chat_template = LLAMA_32_CHAT_TEMPLATE;
        console.info("[fhir4px:transformers-llm]", {
          event: "chat-template-patched",
          modelId,
          reason: "tokenizer_config.json missing chat_template",
          timestamp: new Date().toISOString()
        });
      }

      const elapsedMs = Math.round(performance.now() - startedAt);

      console.info("[fhir4px:transformers-llm]", {
        event: "llm-load-success",
        modelId,
        elapsedMs,
        timestamp: new Date().toISOString()
      });

      isReady = true;
      emitLoadStatus("ready");
      return generator as Generator;
    } catch (error) {
      console.error("[fhir4px:transformers-llm]", {
        event: "llm-load-failed",
        modelId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
      loadError = error instanceof Error ? error : new Error(String(error));
      emitLoadStatus("failed", loadError);
      throw error;
    }
  })();

  emitLoadStatus("loading");
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
/**
 * Detect WebGPU device-lost errors. These are fatal for the current WebGPU
 * session — the GPU context is dead and every subsequent call will fail too.
 * Pattern: "is lost" or "Device" + "failed" in the error message.
 */
function isWebGpuDeviceLost(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("is lost") || (msg.includes("Device") && msg.includes("failed"));
}

export async function generate(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
  try {
    return await generateInternal(request);
  } catch (error) {
    // Auto-fallback: if WebGPU device was lost, tear down the pipeline,
    // rebuild on WASM, and retry. This only happens once (webgpuFailed sticks).
    if (isWebGpuDeviceLost(error) && !webgpuFailed) {
      console.warn("[fhir4px:transformers-llm]", {
        event: "webgpu-device-lost",
        error: error instanceof Error ? error.message : String(error),
        message: "WebGPU device lost — falling back to WASM for remaining session",
        timestamp: new Date().toISOString()
      });
      webgpuFailed = true;
      generatorPromise = null;
      isReady = false;
      emitLoadStatus("loading");

      // Reload on WASM and retry the original request
      return await generateInternal(request);
    }

    // Non-recoverable error — log and rethrow
    console.error("[fhir4px:transformers-llm]", {
      event: "llm-inference-failed",
      error: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : undefined,
      stack: error instanceof Error ? error.stack : undefined,
      webgpuFailed,
      requestInfo: {
        systemPromptLength: request.systemPrompt.length,
        userPayloadLength: request.userPayload.length,
        maxTokens: request.maxTokens ?? 50,
        temperature: request.temperature ?? 0
      },
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

async function generateInternal(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
  const generator = await getGenerator();

  const messages = [
    { role: "system", content: request.systemPrompt },
    { role: "user", content: request.userPayload }
  ];

  const startedAt = performance.now();
  const reply = await generator(messages, {
    max_new_tokens: request.maxTokens ?? 50,
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
 * True only when the model has fully loaded and is ready for inference.
 * Distinct from "load has started" — AppFrame calls preloadLlm() on mount,
 * so the load promise exists immediately, but isLlmLoaded() should only
 * return true once the weights are actually in memory and the pipeline has
 * resolved. Callers use this to decide whether to show "Loading AI model"
 * vs the normal in-progress status.
 */
export function isLlmLoaded(): boolean {
  return isReady;
}

/**
 * Returns the most recent fatal load error, if any. Cleared on next load
 * attempt (which only happens via a fresh page load — load is once per
 * session).
 */
export function getLlmLoadError(): Error | null {
  return loadError;
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
