/**
 * Connection status store — shared between PatientExplorer (which computes
 * the state) and the ConnectionPill / AppNav in the app frame (which
 * render it). Small pub/sub; PatientExplorer publishes on state changes,
 * the app-frame components subscribe and re-render.
 */

import type { CareGap } from "../fhir/care-gaps";
import type { PatientHeaderInfo } from "../fhir/patient-header";
import type { UsCoreCheckResult } from "../fhir/uscore-checks";

export type ConnectionPhase = "disconnected" | "loading" | "evaluating" | "connected" | "warning";

export interface ConnectionStatusSource {
  id: string;
  /** Portal and patient, e.g. "SMART Dev Sandbox · Grace Mensah" (the menu lists this). */
  label: string;
  /** The portal's own name, without the patient: the header shows the
   * patient separately, so its chip uses this. */
  providerLabel?: string;
  status: string;
  recordCount?: number;
}

/** Text for a connection chip: "<connection> · <n> records". */
export function sourceChipLabel(source: Pick<ConnectionStatusSource, "label" | "recordCount">): string {
  if (source.recordCount === undefined) return source.label;
  const count = source.recordCount;
  return `${source.label} · ${count.toLocaleString()} ${count === 1 ? "record" : "records"}`;
}

/** The patient's care gaps as the Records page computed them. */
export interface CareGapsState {
  /** Open gaps, most urgent first (not capped). */
  open: CareGap[];
  /** Gaps the patient dismissed; they can be restored. */
  dismissed: CareGap[];
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
  /** Set once the dataset's care gaps are known; null while unknown. */
  careGaps?: CareGapsState | null;
  /** US Core data-presence checks for the loaded dataset (connection info). */
  usCore?: UsCoreCheckResult[] | null;
  /** The loaded patient, shown in the app header on every page. Null while
   * a different dataset is loading or when nothing is loaded. */
  patient?: PatientHeaderInfo | null;
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
  // The patient belongs to publishPatient and completeConnection: a status
  // publish that does not speak to it leaves it in place, so the header keeps
  // showing the patient while the Records page reports grouping progress.
  state = { ...next, patient: "patient" in next ? next.patient : state.patient };
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

/**
 * Make the stored connections known before the Records page has published
 * them. That page is only mounted after its first visit, so a reload
 * straight onto another page would otherwise report no portal. Leaves alone
 * whatever the Records page published: its view is the live one.
 */
export function publishConnections(sources: ConnectionStatusSource[]): void {
  if (sources.length === 0 || state.sources.length > 0) return;
  state = {
    ...state,
    phase: "connected",
    label: sources.length === 1 ? sourceChipLabel(sources[0]) : `${sources.length} portals connected`,
    sources
  };
  for (const listener of listeners) listener(state);
}

/**
 * Fill in what a stored connection was missing. Until the Records page has
 * fetched it, a connection holds neither its record count nor its patient;
 * the dataset evaluation knows both. Only safe with a single connection,
 * whose records are the ones that were evaluated. A patient the Records
 * page published wins over the evaluation's.
 */
export function completeConnection(details: { patient: PatientHeaderInfo | null; recordCount: number }): void {
  const [source] = state.sources;
  if (!source || state.sources.length !== 1) return;
  const recordCount = source.recordCount ?? details.recordCount;
  if (recordCount === source.recordCount && state.patient === details.patient) return;
  state = {
    ...state,
    label: state.phase === "connected" ? sourceChipLabel({ label: source.label, recordCount }) : state.label,
    sources: [{ ...source, recordCount }],
    patient: state.patient ?? details.patient
  };
  for (const listener of listeners) listener(state);
}

/**
 * Set the patient the app header shows. Published by the Records page as its
 * datasets change. Not subject to the working-phase latch: the header must
 * not keep showing the previous patient while the next one loads.
 */
export function publishPatient(patient: PatientHeaderInfo | null): void {
  if (state.patient === patient) return;
  state = { ...state, patient };
  for (const listener of listeners) listener(state);
}

/**
 * Make the dataset's US Core data-presence checks known; the connection
 * menu summarizes them.
 */
export function publishUsCore(usCore: UsCoreCheckResult[]): void {
  if (state.usCore === usCore) return;
  state = { ...state, usCore };
  for (const listener of listeners) listener(state);
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
  | { kind: "addRecord" }
  | { kind: "dismissCareGap"; gapId: string }
  | { kind: "restoreCareGap"; gapId: string };

export interface RecordsPageHandlers {
  selectTab: (tabId: string) => void;
  selectSource: (sourceId: string) => void;
  refreshSources: () => void;
  addRecord: () => void;
  dismissCareGap: (gapId: string) => void;
  restoreCareGap: (gapId: string) => void;
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
    case "dismissCareGap":
      recordsPageHandlers.dismissCareGap(command.gapId);
      break;
    case "restoreCareGap":
      recordsPageHandlers.restoreCareGap(command.gapId);
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
