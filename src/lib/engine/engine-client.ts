/**
 * Engine client — typed RPC to the cross-origin-isolated engine iframe.
 *
 * The iframe (/engine.html) boots DuckDB-WASM with the fhir4ds fhirpath
 * and cql extensions and exposes query / loadResources over postMessage.
 * This client manages the iframe lifecycle and request/response pairing.
 */

import type { FhirResource } from "../smart/data";

export interface EngineQueryResult {
  columns: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[][];
}

interface EngineMessage {
  id: number;
  kind: string;
  sql?: string;
  resources?: FhirResource[];
  viewDefinition?: Record<string, unknown>;
  library?: Record<string, unknown>;
  composeOmop?: boolean;
  prebuilt?: EnginePrebuiltSql;
}

let frame: HTMLIFrameElement | null = null;
let frameOrigin: string | null = null;
let messageId = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let loadedPromise: Promise<void> | null = null;

function framePath(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/?$/, "/")}engine.html`;
}

function ensureFrame(): Promise<void> {
  if (loadedPromise) return loadedPromise;
  loadedPromise = new Promise<void>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.src = framePath();
    iframe.style.display = "none";
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("title", "fhir4px analysis engine");

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { kind?: string; id?: number; ok?: boolean; result?: unknown; error?: string } | undefined;
      if (!data) return;
      if (data.kind === "engine-frame-loaded") {
        frameOrigin = event.origin;
        resolve();
        return;
      }
      if (typeof data.id === "number") {
        const entry = pending.get(data.id);
        if (!entry) return;
        pending.delete(data.id);
        if (data.ok) entry.resolve(data.result);
        else entry.reject(new Error(data.error ?? "Engine request failed"));
      }
    };
    globalThis.addEventListener("message", onMessage);

    iframe.addEventListener("error", () => {
      reject(new Error("Engine frame failed to load"));
    });
    document.body.appendChild(iframe);
    frame = iframe;

    // Safety timeout: the frame posts engine-frame-loaded immediately on load.
    globalThis.setTimeout(() => {
      if (frameOrigin === null) {
        reject(new Error("Engine frame did not load (is /engine.html served with isolation headers?)"));
      }
    }, 10000);
  }).catch((error) => {
    loadedPromise = null;
    throw error;
  });
  return loadedPromise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function post(message: EngineMessage, transfer?: any[]): Promise<any> {
  return ensureFrame().then(
    () =>
      new Promise((resolve, reject) => {
        messageId += 1;
        const id = messageId;
        pending.set(id, { resolve, reject });
        frame?.contentWindow?.postMessage({ ...message, id }, frameOrigin ?? "*", transfer);
      })
  );
}

export function pingEngine(): Promise<{ pong: boolean; isolated: boolean }> {
  return post({ id: 0, kind: "ping" });
}

export function engineQuery(sql: string): Promise<EngineQueryResult> {
  return post({ id: 0, kind: "query", sql });
}

export function engineLoadResources(resources: FhirResource[]): Promise<{ count: number }> {
  return post({ id: 0, kind: "loadResources", resources });
}

/**
 * SQL generated ahead of time (prebuilt mode). When given, the engine frame
 * runs it as is and never starts Python to generate it.
 */
export interface EnginePrebuiltSql {
  sql: string;
  setupSql?: string[];
  /** The OMOP composition statements an OMOP query joins to. */
  composition?: string[];
}

/** flatten_view: run a ViewDefinition (fhir4ds viewdef engine, SQL verbatim). */
export function engineFlattenView(
  viewDefinition: Record<string, unknown>,
  resources: FhirResource[],
  prebuilt?: EnginePrebuiltSql
): Promise<EngineQueryResult> {
  return post({ id: 0, kind: "flattenView", viewDefinition, resources, prebuilt });
}

/** SQLQuery Library execution with live OMOP composition (their pipeline). */
export function engineRunLibrary(
  library: Record<string, unknown>,
  resources: FhirResource[],
  options: { composeOmop?: boolean; prebuilt?: EnginePrebuiltSql } = {}
): Promise<EngineQueryResult> {
  return post({ id: 0, kind: "runLibrary", library, resources, composeOmop: options.composeOmop, prebuilt: options.prebuilt });
}
