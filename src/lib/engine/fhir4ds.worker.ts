/**
 * Background worker for the fhir4ds record functions that are too slow for
 * the main thread: deduplication (`fhir4ds.dedup.dedup_pass`) and patient
 * matching (`fhir4ds.matching`). It loads its own Pyodide and fhir4ds wheel,
 * so the page stays responsive while a run takes seconds. Requests are served
 * one at a time, in the order they arrive.
 *
 * Record ids are assigned by the caller (`r<n>` for dedup, `p<n>` for
 * patients) so every app record maps to exactly one resource and back.
 */

import type { FhirResource } from "../smart/data";
import { FHIR4DS_INSTALL_PY, FHIR4DS_PYODIDE_PACKAGES, PYODIDE_CDN, fhir4dsWheelUrl } from "./fhir4ds-runtime";

export interface Fhir4dsDedupRequest {
  id: number;
  kind: "dedup";
  resources: FhirResource[];
}

export interface Fhir4dsMatchRequest {
  id: number;
  kind: "matchPatients";
  patients: FhirResource[];
}

export type Fhir4dsRequest = Fhir4dsDedupRequest | Fhir4dsMatchRequest;

export type Fhir4dsResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

const DEDUP_PY = `
import contextlib, io, json
from fhir4ds.dedup import dedup_pass

_resources = json.loads(__resources_json__)
# The pass warns once per record it cannot convert a unit for (thousands of
# lines on some records). Keep the count, not the text.
_warnings = io.StringIO()
with contextlib.redirect_stderr(_warnings):
    _result = dedup_pass(_resources)
json.dumps({
    "clusters": [[member.rid for member in cluster] for cluster in _result.clusters],
    "stats": {key: value for key, value in _result.stats.items() if isinstance(value, (int, float))},
    "warningLines": _warnings.getvalue().count(chr(10)),
})
`;

const MATCH_PATIENTS_PY = `
import json, duckdb
from fhir4ds.matching import index_patient, match_patient

_patients = json.loads(__patients_json__)
_connection = duckdb.connect()
for _patient in _patients:
    index_patient(_connection, _patient)
_out = []
for _patient in _patients:
    _result = match_patient(_connection, _patient, exclude=frozenset({_patient["id"]}))
    _out.append({
        "index": int(_patient["id"][1:]),
        "outcome": _result.outcome,
        "rule": _result.rule_id,
        "confidence": _result.confidence,
        "matchType": _result.match_type,
        "matched": sorted(int(_id[1:]) for _id in _result.matched_ids),
        "evidence": {str(key): str(value) for key, value in _result.evidence.items()},
    })
_connection.close()
json.dumps(_out)
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pyodide: any = null;
let bootPromise: Promise<void> | null = null;

function boot(): Promise<void> {
  if (!bootPromise) {
    bootPromise = (async () => {
      const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_CDN}pyodide.mjs`);
      pyodide = await loadPyodide({ indexURL: PYODIDE_CDN });
      // tzdata: dedup resolves time zones.
      await pyodide.loadPackage([...FHIR4DS_PYODIDE_PACKAGES, "tzdata"]);
      pyodide.globals.set("__wheel_url__", fhir4dsWheelUrl());
      await pyodide.runPythonAsync(FHIR4DS_INSTALL_PY);
      pyodide.runPython("import fhir4ds.dedup, fhir4ds.matching");
    })().catch((error) => {
      bootPromise = null;
      throw error;
    });
  }
  return bootPromise;
}

async function handle(request: Fhir4dsRequest, post: (response: Fhir4dsResponse) => void): Promise<void> {
  try {
    await boot();
    let result: unknown;
    if (request.kind === "dedup") {
      pyodide.globals.set("__resources_json__", JSON.stringify(request.resources));
      result = JSON.parse(pyodide.runPython(DEDUP_PY));
    } else {
      pyodide.globals.set("__patients_json__", JSON.stringify(request.patients));
      result = JSON.parse(pyodide.runPython(MATCH_PATIENTS_PY));
    }
    post({ id: request.id, ok: true, result });
  } catch (error) {
    post({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

let chain: Promise<unknown> = Promise.resolve();
scope.onmessage = (event: MessageEvent<Fhir4dsRequest>) => {
  const request = event.data;
  if (!request || typeof request.id !== "number" || (request.kind !== "dedup" && request.kind !== "matchPatients")) return;
  // handle() never rejects, so the chain only serializes the work.
  chain = chain.then(() => handle(request, (response) => scope.postMessage(response)));
};
