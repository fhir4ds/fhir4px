/**
 * Connection status store — shared between PatientExplorer (which computes
 * the state) and the ConnectionPill / AppNav in the app frame (which
 * render it). Small pub/sub; PatientExplorer publishes on state changes,
 * the app-frame components subscribe and re-render.
 */

export type ConnectionPhase = "disconnected" | "loading" | "evaluating" | "connected" | "warning";

export interface ConnectionStatusSource {
  id: string;
  label: string;
  status: string;
  recordCount?: number;
}

/** A Records sub-navigation entry (resource-type tab). */
export interface RecordTabEntry {
  /** ExplorerTab value (Records-page tab id), e.g. "PatientSummary". */
  id: string;
  label: string;
  count: number;
}

export interface RecordTabsState {
  patientLabel: string | null;
  tabs: RecordTabEntry[];
  activeTabId: string;
  /** Records-page source filter: "all" or a source id. */
  activeSourceId: string;
}

export interface ConnectionStatusState {
  phase: ConnectionPhase;
  /** Primary line, e.g. "SMART Dev Sandbox · 243 records". */
  label: string;
  /** Secondary detail (status-bar detail line). */
  detail?: string | null;
  /** Determinate progress 0..100; null = indeterminate; undefined = none. */
  progressValue?: number | null;
  sources: ConnectionStatusSource[];
  /** Present while a Records page is mounted (keep-alive) — drives the
   * drawer's second level. */
  recordTabs?: RecordTabsState | null;
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

// ── Records-page actions ──────────────────────────────────────────────────
// PatientExplorer is keep-alive mounted, but only after its first visit.
// The app frame (drawer, connection popover) registers nothing itself: it
// dispatches commands here, which run immediately when the Records page is
// mounted and queue up for it to consume on mount otherwise.

/** Commands the app frame can ask the Records page to perform. */
export type RecordsPageCommand =
  | { kind: "selectTab"; tabId: string }
  | { kind: "selectSource"; sourceId: string }
  | { kind: "refreshSources" }
  | { kind: "addRecord" };

export interface RecordsPageHandlers {
  selectTab: (tabId: string) => void;
  selectSource: (sourceId: string) => void;
  refreshSources: () => void;
  addRecord: () => void;
}

let recordsPageHandlers: RecordsPageHandlers | null = null;
let pendingCommands: RecordsPageCommand[] = [];

function run(command: RecordsPageCommand): void {
  if (!recordsPageHandlers) {
    pendingCommands.push(command);
    return;
  }
  switch (command.kind) {
    case "selectTab":
      recordsPageHandlers.selectTab(command.tabId);
      break;
    case "selectSource":
      recordsPageHandlers.selectSource(command.sourceId);
      break;
    case "refreshSources":
      recordsPageHandlers.refreshSources();
      break;
    case "addRecord":
      recordsPageHandlers.addRecord();
      break;
  }
}

/** Dispatch a command to the Records page (queued if it is not mounted). */
export function dispatchRecordsPageCommand(command: RecordsPageCommand): void {
  run(command);
}

/**
 * Register the Records page's handlers and run any commands queued before it
 * mounted. Pass null on unmount.
 */
export function registerRecordsPageActions(handlers: RecordsPageHandlers | null): void {
  recordsPageHandlers = handlers;
  if (!handlers) return;
  const queued = pendingCommands;
  pendingCommands = [];
  for (const command of queued) run(command);
}
