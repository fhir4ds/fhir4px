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
import type { FhirResource } from "../smart/data";

interface EngineMessage {
  id: number;
  kind: string;
  sql?: string;
  resources?: FhirResource[];
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
  if (typeof val !== "object") return val;
  try {
    return JSON.parse(JSON.stringify(val));
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
