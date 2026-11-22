/**
 * Connection status store — shared between PatientExplorer (which computes
 * the state) and the ConnectionPill in the app frame (which renders it).
 * Small pub/sub; PatientExplorer publishes on state changes, the pill
 * subscribes and re-renders.
 */

export type ConnectionPhase = "disconnected" | "loading" | "evaluating" | "connected" | "warning";

export interface ConnectionStatusSource {
  id: string;
  label: string;
  status: string;
  recordCount?: number;
}

export interface ConnectionStatusState {
  phase: ConnectionPhase;
  /** Primary line, e.g. "SMART Dev Sandbox · 243 records". */
  label: string;
  /** Secondary detail (current status-bar detail line). */
  detail?: string | null;
  /** Determinate progress 0..100; null = indeterminate; undefined = none. */
  progressValue?: number | null;
  sources: ConnectionStatusSource[];
}

type Listener = (state: ConnectionStatusState) => void;

let state: ConnectionStatusState = {
  phase: "disconnected",
  label: "No portal connected",
  detail: null,
  sources: []
};

const listeners = new Set<Listener>();

/** Hysteresis: grouping has async idle gaps between stages that can briefly
 * look "connected" — working phases latch for this long before clearing. */
const WORKING_LATCH_MS = 4000;
let lastWorkingAt = 0;

export function publishConnectionStatus(next: ConnectionStatusState): void {
  if (next.phase === "loading" || next.phase === "evaluating") {
    lastWorkingAt = Date.now();
  } else if (Date.now() - lastWorkingAt < WORKING_LATCH_MS) {
    // Keep the previous working phase through inter-stage idle gaps.
    return;
  }
  state = next;
  for (const listener of listeners) listener(state);
}

export function getConnectionStatus(): ConnectionStatusState {
  return state;
}

export function subscribeConnectionStatus(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}
