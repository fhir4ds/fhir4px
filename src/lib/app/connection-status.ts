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

/** A patient the app header can switch to: one entry per distinct person. */
export interface PatientChoice {
  /** The person's key from the Records page; null shows every patient together. */
  id: string | null;
  label: string;
  /** The portals behind the person, e.g. "SMART Dev Sandbox". */
  detail?: string;
}

export interface PatientSelectionState {
  /** Empty or one entry: nothing to switch between, the header shows the name. */
  choices: PatientChoice[];
  /** The chosen person's id; null = every patient together. */
  selectedId: string | null;
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
  /** fhir4ds record checks for the loaded dataset, run in the background:
   * deduplication and patient matching. Null until a run has started. */
  recordChecks?: RecordChecks | null;
  /** The patient switcher: several people are connected. Null when a single
   * person is loaded (or nothing is). */
  patientSelection?: PatientSelectionState | null;
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
/** A settled state that arrived inside the latch window. It is published
 * when the window ends, unless a newer publish replaces it. Dropping it
 * instead left the chip on a working label for good whenever the last step
 * finished quickly (a prebuilt evaluation takes about a second). */
let heldState: ConnectionStatusState | null = null;
let latchTimer: ReturnType<typeof setTimeout> | null = null;

function emit(next: ConnectionStatusState): void {
  // The patient belongs to publishPatient and completeConnection: a status
  // publish that does not speak to it leaves it in place, so the header keeps
  // showing the patient while the Records page reports grouping progress.
  // The record checks and the patient switcher (publishRecordChecks,
  // publishPatientSelection) are kept the same way.
  const speak = <K extends keyof ConnectionStatusState>(key: K): ConnectionStatusState[K] =>
    key in next ? next[key] : state[key];
  state = {
    ...next,
    patient: speak("patient"),
    recordChecks: speak("recordChecks"),
    patientSelection: speak("patientSelection")
  };
  for (const listener of listeners) listener(state);
}

export function publishConnectionStatus(next: ConnectionStatusState): void {
  if (latchTimer !== null) {
    clearTimeout(latchTimer);
    latchTimer = null;
    heldState = null;
  }
  if (next.phase === "loading" || next.phase === "evaluating") {
    lastWorkingAt = Date.now();
    emit(next);
    return;
  }
  const remaining = WORKING_LATCH_MS - (Date.now() - lastWorkingAt);
  if (remaining > 0) {
    // Keep the previous working phase through inter-stage idle gaps.
    heldState = next;
    latchTimer = setTimeout(() => {
      latchTimer = null;
      const held = heldState;
      heldState = null;
      if (held) emit(held);
    }, remaining);
    return;
  }
  emit(next);
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

export type RecordCheckState = "running" | "done" | "failed";

export interface RecordChecks {
  /** fhir4ds deduplication. `merged`: records that are copies of another record. */
  dedup: { state: RecordCheckState; merged: number; error?: string } | null;
  /** fhir4ds patient matching between the connected portals. */
  patientMatch: {
    state: RecordCheckState;
    verdict: "same" | "different" | "unconfirmed" | null;
    error?: string;
  } | null;
}

/** Make the state of the background record checks known; the connection menu shows it. */
export function publishRecordChecks(recordChecks: RecordChecks | null): void {
  if (state.recordChecks === recordChecks) return;
  state = { ...state, recordChecks };
  for (const listener of listeners) listener(state);
}

/**
 * Make the patient switcher known: the people behind the connected portals and
 * the one the Records page is scoped to. Null when they are all one person,
 * which the header then shows as a plain name.
 */
export function publishPatientSelection(selection: PatientSelectionState | null): void {
  if (state.patientSelection === selection) return;
  state = { ...state, patientSelection: selection };
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
  | { kind: "selectPatient"; patientId: string | null }
  | { kind: "refreshSources" }
  | { kind: "addRecord" }
  | { kind: "dismissCareGap"; gapId: string }
  | { kind: "restoreCareGap"; gapId: string };

export interface RecordsPageHandlers {
  selectTab: (tabId: string) => void;
  selectSource: (sourceId: string) => void;
  /** Scope the page to one person (PatientChoice id), or to all of them (null). */
  selectPatient: (patientId: string | null) => void;
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
    case "selectPatient":
      recordsPageHandlers.selectPatient(command.patientId);
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
