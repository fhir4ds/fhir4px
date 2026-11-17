/**
 * DuckDB-WASM boot for the fhir4ds engine — ported from
 * fhir4ds/web/viewing-room (src/lib/duckdb-wasm.ts) and simplified for
 * fhir4px: assets are pinned under /vendor/fhir4ds/, no wheel (we consume
 * pre-translated SQL artifacts), no remote asset base.
 *
 * Runs inside the engine iframe (src/lib/engine/frame-host.ts), which is
 * the only document served with cross-origin-isolation headers —
 * DuckDB-WASM's threaded build needs SharedArrayBuffer, while the main
 * app document stays unisolated so cross-origin terminology fetches
 * (HuggingFace) are unaffected by COEP.
 */

import { registerCQLMacros } from "./cql-macros";

// Served verbatim from public/vendor/fhir4ds/ — vite 8's dev transform of
// node_modules assets (re-minification) breaks the Emscripten worker, so the
// worker and wasm must bypass the transform pipeline like the extensions.
const duckdbWorkerUrl = "/vendor/fhir4ds/duckdb-browser-eh.worker.js";
const duckdbWasmUrl = "/vendor/fhir4ds/duckdb-eh.wasm";

export interface DuckDBConnectionBundle {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conn: any;
}

const EXTENSION_FILES = ["fhirpath.duckdb_extension.wasm", "cql.duckdb_extension.wasm"] as const;

function extensionUrl(file: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/?$/, "/")}vendor/fhir4ds/${file}`;
}

export async function createDuckDBConnection(): Promise<DuckDBConnectionBundle> {
  if (typeof SharedArrayBuffer === "undefined") {
    throw new Error("cross-origin isolation unavailable — engine iframe must be served with COOP/COEP headers");
  }
  const duckdb = await import("@duckdb/duckdb-wasm");
  const worker = new Worker(duckdbWorkerUrl, { type: "classic" });
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(duckdbWasmUrl, null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db.open as any)({
    path: ":memory:",
    // BIGINT stays BIGINT (viewing-room executor doctrine): OMOP surrogate
    // keys are 63-bit hashes — casting to doubles rounds past 2^53. The
    // frame host's arrowToPlain keeps safe ints numeric and unsafe ones as
    // exact digit strings.
    query: { castBigIntToDouble: false },
    allowUnsignedExtensions: true,
    autoInstallExtensions: false,
    autoLoadExtensions: false
  });

  const conn = await db.connect();
  for (const file of EXTENSION_FILES) {
    await db.registerFileURL(file, extensionUrl(file), 4 /* DuckDBDataProtocol.HTTP */, false);
    await conn.query(`LOAD '${file}'`);
  }
  // CQL macros (fhirpath_text/date/bool/number + clinical macros) that the
  // pre-translated measure SQL depends on — ported from fhir4ds wasm-demo.
  await registerCQLMacros(conn);
  return { db, conn };
}
