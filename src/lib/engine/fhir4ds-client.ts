/**
 * Main-thread client for the fhir4ds background worker (deduplication and
 * patient matching). Requests are matched to replies by id. A worker that
 * crashes, stops answering or fails to start rejects the waiting requests;
 * the next call starts a fresh worker, so nothing stays broken for the
 * session.
 */

import type { FhirResource } from "../smart/data";
import type { Fhir4dsRequest, Fhir4dsResponse } from "./fhir4ds.worker";
// The worker module, bundled by Vite as its own file.
import fhir4dsWorkerUrl from "./fhir4ds.worker.ts?worker&url";

export interface Fhir4dsDedupOutcome {
  /** Each cluster lists the resource ids of records that are copies of one record. */
  clusters: string[][];
  stats: Record<string, number>;
  warningLines: number;
}

export interface Fhir4dsPatientMatch {
  index: number;
  outcome: "match" | "no_match" | "ambiguous";
  rule: string | null;
  confidence: number | null;
  matchType: string;
  /** Indexes of the other patients this one matches. */
  matched: number[];
  evidence: Record<string, string>;
}

/** The part of the worker this client uses, as methods, so a test can supply a stand-in. */
export interface Fhir4dsWorkerLike {
  postMessage(message: Fhir4dsRequest): void;
  terminate(): void;
  onmessage(handler: (response: Fhir4dsResponse) => void): void;
  onerror(handler: (message: string) => void): void;
}

function isFhir4dsResponse(value: unknown): value is Fhir4dsResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { id?: unknown; ok?: unknown; result?: unknown; error?: unknown };
  return typeof candidate.id === "number" && typeof candidate.ok === "boolean";
}

function browserWorker(): Fhir4dsWorkerLike {
  // The page is cross-origin isolated (COOP/COEP), and a browser then refuses
  // to start a worker whose own script file arrives without those headers.
  // A worker started from an in-memory script inherits the page's isolation
  // instead, so it starts on any host; the script only imports the worker
  // module.
  // The in-memory script has no base URL, so the import must be absolute.
  const workerUrl = new URL(fhir4dsWorkerUrl, import.meta.url).href;
  const loaderUrl = URL.createObjectURL(
    new Blob([`import ${JSON.stringify(workerUrl)};`], { type: "text/javascript" })
  );
  const worker = new Worker(loaderUrl, { type: "module" });
  worker.addEventListener("message", () => URL.revokeObjectURL(loaderUrl), { once: true });
  let onReply: (response: Fhir4dsResponse) => void = () => {};
  worker.onmessage = (event) => {
    if (isFhir4dsResponse(event.data)) onReply(event.data);
  };
  return {
    postMessage: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
    onmessage: (handler) => {
      onReply = handler;
    },
    onerror: (handler) => {
      worker.onerror = (event) => handler(event.message);
    }
  };
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const MATCH_OUTCOMES: ReadonlySet<string> = new Set(["match", "no_match", "ambiguous"]);

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let workerFactory: () => Fhir4dsWorkerLike = browserWorker;
let requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
let worker: Fhir4dsWorkerLike | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(error: Error): void {
  const waiting = [...pending.values()];
  pending.clear();
  for (const entry of waiting) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  worker?.terminate();
  worker = null;
}

function getWorker(): Fhir4dsWorkerLike {
  if (worker) return worker;
  const created = workerFactory();
  created.onmessage((response) => {
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    clearTimeout(entry.timer);
    if (response.ok) entry.resolve(response.result);
    else entry.reject(new Error(response.error));
  });
  created.onerror((message) => {
    failAll(new Error(message || "The fhir4ds background worker stopped unexpectedly"));
  });
  worker = created;
  return created;
}

/** The id in `request` is a placeholder; the caller's reply carries the real one. */
function call(request: Fhir4dsRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    const timer = setTimeout(() => {
      // A run that takes this long will not finish; start over next time.
      failAll(new Error("fhir4ds did not finish in time"));
    }, requestTimeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      getWorker().postMessage({ ...request, id });
    } catch (error) {
      pending.delete(id);
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function isDedupOutcome(value: unknown): value is Fhir4dsDedupOutcome {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { clusters?: unknown; stats?: unknown; warningLines?: unknown };
  return (
    Array.isArray(candidate.clusters) &&
    candidate.clusters.every(
      (cluster) => Array.isArray(cluster) && cluster.every((rid) => typeof rid === "string")
    ) &&
    typeof candidate.stats === "object" &&
    candidate.stats !== null &&
    !Array.isArray(candidate.stats) &&
    (candidate.warningLines === undefined || typeof candidate.warningLines === "number")
  );
}

/** Which records are copies of each other, decided by fhir4ds deduplication. */
export async function fhir4dsDeduplicate(resources: FhirResource[]): Promise<Fhir4dsDedupOutcome> {
  const result = await call({ id: 0, kind: "dedup", resources });
  if (!isDedupOutcome(result)) {
    throw new Error("fhir4ds deduplication returned an unexpected result");
  }
  return { clusters: result.clusters, stats: result.stats, warningLines: result.warningLines ?? 0 };
}

/** Compares every patient with every other one, using fhir4ds patient matching. */
export async function fhir4dsMatchPatients(patients: FhirResource[]): Promise<Fhir4dsPatientMatch[]> {
  const result = (await call({ id: 0, kind: "matchPatients", patients })) as Fhir4dsPatientMatch[];
  if (
    !Array.isArray(result) ||
    result.some((match) => typeof match.index !== "number" || !MATCH_OUTCOMES.has(match.outcome))
  ) {
    throw new Error("fhir4ds patient matching returned an unexpected result");
  }
  return result;
}

/** Test only: supply a stand-in worker, the request timeout, or both. */
export function setFhir4dsWorkerForTest(options: { factory?: () => Fhir4dsWorkerLike; timeoutMs?: number }): void {
  failAll(new Error("fhir4ds worker replaced by a test"));
  if (options.factory) workerFactory = options.factory;
  if (options.timeoutMs !== undefined) requestTimeoutMs = options.timeoutMs;
}
