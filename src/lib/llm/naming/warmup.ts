import type { NamingWarmupStatus, NamingWarmupPhase } from "./types";

let currentStatus: NamingWarmupStatus = {
  phase: "idle",
  updatedAt: Date.now()
};

const listeners = new Set<(status: NamingWarmupStatus) => void>();

function setStatus(phase: NamingWarmupPhase, message?: string): void {
  currentStatus = { phase, message, updatedAt: Date.now() };
  for (const listener of listeners) listener(currentStatus);
}

export function getNamingWarmupStatus(): NamingWarmupStatus {
  return currentStatus;
}

export function subscribeNamingWarmupStatus(listener: (status: NamingWarmupStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function browserCanAttemptNaming(): boolean {
  return typeof window !== "undefined" && typeof WebAssembly !== "undefined";
}

export async function preloadNamingModel(): Promise<boolean> {
  if (currentStatus.phase === "loading" || currentStatus.phase === "ready") return true;
  if (!browserCanAttemptNaming()) {
    setStatus("skipped", "WebAssembly not available");
    return false;
  }

  setStatus("loading", "Loading app data...");
  try {
    const { preloadLlm, getLlmModelId } = await import("../transformers-llm");
    await preloadLlm();
    setStatus("ready", getLlmModelId());
    return true;
  } catch (error) {
    setStatus("failed", error instanceof Error ? error.message : String(error));
    return false;
  }
}
