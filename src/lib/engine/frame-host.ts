/**
 * Engine iframe host — boots DuckDB-WASM + fhir4ds extensions inside the
 * cross-origin-isolated document (public/engine/index.html) and serves an
 * RPC protocol over postMessage.
 *
 * Protocol (message shape { id, kind, ... }):
 *   ping            -> { pong: true, isolated: crossOriginIsolated }
 *   boot            -> { ready: true }  (implicit on load; errors surface as bootError)
 *   query { sql }   -> { columns, rows }  (Arrow result flattened to JSON)
 *   loadResources { resources } -> { count }  (replaces the resources table)
 */

import { createDuckDBConnection } from "./duckdb";
import { generateLibrarySql, generateViewSql, deriveCompositionDdl, type ViewSqlResult } from "./viewdef";
import type { FhirResource } from "../smart/data";

interface EngineMessage {
  id: number;
  kind: string;
  sql?: string;
  resources?: FhirResource[];
  viewDefinition?: Record<string, unknown>;
  library?: Record<string, unknown>;
  /** Stage a ConceptMap resource alongside patient resources (OMOP path). */
  composeOmop?: boolean;
  /** Prebuilt SQL (build-time translation); generated here when absent. */
  prebuilt?: { sql: string; setupSql?: string[]; composition?: string[] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let connection: any = null;
let bootPromise: Promise<void> | null = null;

function boot(): Promise<void> {
  if (!bootPromise) {
    bootPromise = (async () => {
      connection = await createDuckDBConnection();
      await connection.conn.query(`
        CREATE TABLE IF NOT EXISTS resources (
          id VARCHAR,
          resourceType VARCHAR,
          resource JSON,
          patient_ref VARCHAR
        );
      `);
    })().catch((error) => {
      bootPromise = null;
      throw error;
    });
  }
  return bootPromise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function arrowToPlain(val: unknown): any {
  if (val === null || val === undefined) return val;
  if (typeof val === "bigint") {
    // OMOP surrogate keys are 63-bit hashes: keep exact digits as text
    // beyond 2^53; everyday integers stay numeric.
    const n = Number(val);
    return Number.isSafeInteger(n) ? n : val.toString();
  }
  if (typeof val !== "object") return val;
  if (Array.isArray(val)) return val.map(arrowToPlain);
  try {
    return JSON.parse(JSON.stringify(val, (_key, value) => (typeof value === "bigint" ? arrowToPlain(value) : value)));
  } catch {
    return String(val);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runQuery(sql: string): Promise<{ columns: string[]; rows: any[][] }> {
  const table = await connection.conn.query(sql);
  const columns: string[] = table.schema.fields.map((field: { name: string }) => field.name);
  const rows: unknown[][] = [];
  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
    const row: unknown[] = [];
    for (const column of columns) {
      row.push(arrowToPlain(table.getChild(column)?.get(rowIndex)));
    }
    rows.push(row);
  }
  return { columns, rows };
}

async function loadResources(resources: FhirResource[]): Promise<{ count: number }> {
  await connection.conn.query("DELETE FROM resources;");
  if (resources.length === 0) return { count: 0 };
  const statement = await connection.conn.prepare("INSERT INTO resources VALUES (?, ?, ?, ?)");
  for (const resource of resources) {
    const id = typeof resource.id === "string" ? resource.id : crypto.randomUUID();
    const subject = resource.subject as { reference?: string } | undefined;
    const patient = resource.patient as { reference?: string } | undefined;
    const patientRef =
      (subject?.reference ?? patient?.reference ?? "").replace(/^Patient\//, "") || null;
    await statement.query(id, resource.resourceType, JSON.stringify(resource), patientRef);
  }
  await statement.close();
  return { count: resources.length };
}

/** Their stageAndRunFlat port: stage resources in __vd_src, run SQL verbatim. */
async function stageAndRun(
  sql: string,
  resources: FhirResource[],
  setupStatements: string[] = [],
  setupFactory?: () => Promise<string[]>
): Promise<{ columns: string[]; rows: unknown[][] }> {
  const statements: string[] = ["CREATE OR REPLACE TEMP TABLE __vd_src (resource JSON)"];
  if (resources.length === 0) {
    statements.push("INSERT INTO __vd_src SELECT NULL WHERE false");
  } else {
    const BATCH = 150;
    for (let offset = 0; offset < resources.length; offset += BATCH) {
      const values = resources
        .slice(offset, offset + BATCH)
        .map((resource) => `('${JSON.stringify(resource).replace(/'/g, "''")}')`)
        .join(", ");
      statements.push(`INSERT INTO __vd_src VALUES ${values}`);
    }
  }
  for (const statement of statements) await connection.conn.query(statement);
  for (const statement of setupStatements) await connection.conn.query(statement);
  if (setupFactory) {
    for (const statement of await setupFactory()) await connection.conn.query(statement);
  }
  return runQuery(sql);
}

/** flatten_view: their capability — ViewDefinition JSON -> verbatim SQL. */
async function runViewDefinition(
  viewDefinition: Record<string, unknown>,
  resources: FhirResource[],
  prebuilt?: EngineMessage["prebuilt"]
): Promise<{ columns: string[]; rows: unknown[][] }> {
  const generated: ViewSqlResult = prebuilt
    ? { ok: true, sql: prebuilt.sql, setup_sql: prebuilt.setupSql ?? [], diagnostics: null }
    : await generateViewSql(viewDefinition);
  if (!generated.ok || !generated.sql) {
    throw new Error(`ViewDefinition generation failed: ${JSON.stringify(generated.diagnostics ?? []).slice(0, 300)}`);
  }
  return stageAndRun(generated.sql, resources, generated.setup_sql ?? []);
}

/** SQLQuery Library path with LIVE composition (their OMOP pipeline). */
async function runLibraryQuery(
  library: Record<string, unknown>,
  resources: FhirResource[],
  composeOmop: boolean,
  prebuilt?: EngineMessage["prebuilt"]
): Promise<{ columns: string[]; rows: unknown[][] }> {
  const generated: ViewSqlResult = prebuilt
    ? { ok: true, sql: prebuilt.sql, setup_sql: [], diagnostics: null }
    : await generateLibrarySql(library);
  if (!generated.ok || !generated.sql) {
    throw new Error(`Library parsing failed: ${JSON.stringify(generated.diagnostics ?? []).slice(0, 300)}`);
  }
  const needsComposition = composeOmop && !generated.setup_sql?.length && /\bomop\./i.test(generated.sql);
  return stageAndRun(
    generated.sql,
    resources,
    generated.setup_sql ?? [],
    needsComposition
      ? () =>
          prebuilt?.composition
            ? Promise.resolve(prebuilt.composition)
            : deriveCompositionDdl((sql) => connection.conn.query(sql))
      : undefined
  );
}

async function handleMessage(message: EngineMessage): Promise<unknown> {
  switch (message.kind) {
    case "ping":
      return { pong: true, isolated: Boolean((globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated) };
    case "query":
      await boot();
      return runQuery(message.sql ?? "");
    case "loadResources":
      await boot();
      return loadResources(message.resources ?? []);
    case "flattenView":
      await boot();
      return runViewDefinition(message.viewDefinition ?? {}, message.resources ?? [], message.prebuilt);
    case "runLibrary":
      await boot();
      return runLibraryQuery(
        message.library ?? {},
        message.resources ?? [],
        message.composeOmop === true,
        message.prebuilt
      );
    default:
      throw new Error(`Unknown engine message kind: ${message.kind}`);
  }
}

globalThis.addEventListener("message", (event) => {
  const data = event.data as EngineMessage | undefined;
  if (!data || typeof data.id !== "number" || typeof data.kind !== "string") return;
  void handleMessage(data)
    .then((result) => {
      event.source?.postMessage({ id: data.id, ok: true, result }, { targetOrigin: event.origin });
    })
    .catch((error) => {
      event.source?.postMessage(
        { id: data.id, ok: false, error: error instanceof Error ? error.message : String(error) },
        { targetOrigin: event.origin }
      );
    });
});

// Signal readiness to the embedding page.
globalThis.parent?.postMessage({ kind: "engine-frame-loaded" }, "*");
