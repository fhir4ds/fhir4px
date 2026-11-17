/**
 * OMOP CDM export via the fhir4ds viewdef engine — NO hand-written SQL.
 *
 * The wheel (public/vendor/fhir4ds/fhir4ds_v2-0.0.24) carries the OMOP
 * ViewDefinition library (source views, conceptmap view, SQLQuery
 * libraries, composition runner). The pipeline mirrors the viewing-room
 * worker exactly:
 *
 *   1. batch $translate resolves codes -> a monolithic ConceptMap resource
 *   2. patient resources + the ConceptMap stage in __vd_src
 *   3. live composition derives the OMOP view family (omop.person_source,
 *      omop.omop_conceptmap, ...) from the wheel's library
 *   4. each Library's application/sql executes VERBATIM over those views
 */

import { engineRunLibrary, type EngineQueryResult } from "../engine/engine-client";
import type { FhirResource } from "../smart/data";
import type { ConceptResolution } from "./omop-concepts";

export interface OmopTableResult {
  /** Library resourceType:id from the wheel. */
  id: string;
  columns: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[][];
  error?: string;
}

/** The wheel's OMOP SQLQuery Libraries, one per CDM table. */
export const OMOP_LIBRARY_IDS = [
  "person-omop",
  "condition-occurrence-omop",
  "drug-exposure-omop",
  "observation-omop",
  "measurement-omop",
  "procedure-occurrence-omop",
  "visit-occurrence-omop"
] as const;

/** Build a monolithic ConceptMap resource from resolved codes (their format). */
export function buildConceptMapResource(resolution: ConceptResolution): FhirResource {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groups = new Map<string, { source: string; elements: any[] }>();
  for (const [key, conceptId] of resolution.mappings) {
    const separator = key.indexOf("|");
    const system = key.slice(0, separator);
    const code = key.slice(separator + 1);
    if (!conceptId) continue;
    if (!groups.has(system)) {
      groups.set(system, {
        source: system,
        elements: []
      });
    }
    groups.get(system)!.elements.push({
      code,
      target: [{ code: conceptId, equivalence: "equivalent" }]
    });
  }
  return {
    resourceType: "ConceptMap",
    status: "active",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    group: [...groups.values()].map((group) => ({ source: group.source, element: group.elements } as any))
  } as FhirResource;
}

/** Fetch a Library from the wheel's OMOP library via the engine frame. */
async function fetchLibrary(id: string): Promise<Record<string, unknown> | null> {
  // The wheel lives inside Pyodide; the frame host's runLibrary accepts the
  // Library JSON. We carry pinned copies extracted from the wheel so the
  // browser can hand them over without Pyodide file access.
  const base = import.meta.env.BASE_URL || "/";
  const response = await fetch(`${base.replace(/\/?$/, "/")}fhir4ds/omop-libraries/${id}.json`, { cache: "force-cache" });
  if (!response.ok) return null;
  return (await response.json()) as Record<string, unknown>;
}

export interface OmopExportOutcome {
  results: OmopTableResult[];
  resolved: number;
  unmatched: number;
  mapUnavailable: boolean;
}

/**
 * Run the full fhir4ds OMOP pipeline: stage resources + ConceptMap, live
 * composition, execute each Library's SQL verbatim.
 */
export async function runOmopExport(resources: FhirResource[], resolution: ConceptResolution): Promise<OmopExportOutcome> {
  const conceptMap = buildConceptMapResource(resolution);
  const staged: FhirResource[] = [...resources, conceptMap];

  const results: OmopTableResult[] = [];
  for (const id of OMOP_LIBRARY_IDS) {
    const library = await fetchLibrary(id);
    if (!library) {
      results.push({ id, columns: [], rows: [], error: `Library artifact unavailable: ${id}` });
      continue;
    }
    try {
      const result = (await engineRunLibrary(library, staged, { composeOmop: true })) as EngineQueryResult;
      results.push({ id, columns: result.columns, rows: result.rows });
    } catch (error) {
      results.push({ id, columns: [], rows: [], error: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    results,
    resolved: resolution.resolved,
    unmatched: resolution.unmatched,
    mapUnavailable: resolution.mapUnavailable
  };
}

/** CSV serialization of a Library result. */
export function omopResultToCsv(result: { columns: string[]; rows: unknown[][] }): string {
  const escapeCell = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [result.columns.join(",")];
  for (const row of result.rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  return lines.join("\n");
}
