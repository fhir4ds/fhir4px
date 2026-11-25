/**
 * US Core data-presence conformance — evaluated as fhir4ds
 * ViewDefinitions (public/fhir4ds/uscore-views/): each view selects the
 * profile's required elements via FHIRPath; the fhir4ds viewdef engine
 * (Pyodide) generates the SQL and DuckDB-WASM executes it verbatim. A row
 * with a null required element is non-conformant. Profile *enforcement*
 * remains off (2026-11-16 decision) — these report element presence.
 */

import { engineFlattenView, type EngineQueryResult } from "../engine/engine-client";
import { prebuiltViewSql } from "../engine/prebuilt";
import type { FhirResource } from "../smart/data";

export interface UsCoreCheck {
  id: string;
  name: string;
  resource: string;
  description: string;
}

interface ViewManifest {
  views: UsCoreCheck[];
}

let manifestPromise: Promise<ViewManifest> | null = null;

function uscoreBaseUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/?$/, "/")}fhir4ds/uscore-views`;
}

async function loadManifest(options: { fetcher?: typeof fetch } = {}): Promise<ViewManifest> {
  if (manifestPromise) return manifestPromise;
  const fetcher = options.fetcher ?? fetch;
  manifestPromise = fetcher(`${uscoreBaseUrl()}/manifest.json`, { cache: "force-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`US Core view manifest unavailable: ${response.status}`);
      return response.json() as Promise<ViewManifest>;
    })
    .catch((error) => {
      manifestPromise = null;
      throw error;
    });
  return manifestPromise;
}

export interface UsCoreCheckResult {
  check: UsCoreCheck;
  total: number;
  conforming: number;
  error?: string;
}

/**
 * Run every US Core check: fetch its ViewDefinition, execute via the
 * fhir4ds engine, count rows where all required columns are non-null.
 * The required columns are every column the view selects (by design).
 */
export async function runUsCoreChecks(
  resources: FhirResource[],
  options: { fetcher?: typeof fetch } = {}
): Promise<UsCoreCheckResult[]> {
  const fetcher = options.fetcher ?? fetch;
  const manifest = await loadManifest(options);
  const byType = new Map<string, FhirResource[]>();
  for (const resource of resources) {
    const list = byType.get(resource.resourceType) ?? [];
    list.push(resource);
    byType.set(resource.resourceType, list);
  }

  const results: UsCoreCheckResult[] = [];
  for (const check of manifest.views) {
    const candidates = byType.get(check.resource) ?? [];
    if (candidates.length === 0) {
      results.push({ check, total: 0, conforming: 0 });
      continue;
    }
    try {
      const response = await fetcher(`${uscoreBaseUrl()}/${check.id}.json`, { cache: "force-cache" });
      if (!response.ok) throw new Error(`view unavailable (${response.status})`);
      const viewDefinition = (await response.json()) as Record<string, unknown>;
      // The engine frame generates the SQL unless it was built ahead.
      const result = (await engineFlattenView(
        viewDefinition,
        candidates,
        (await prebuiltViewSql(check.id)) ?? undefined
      )) as EngineQueryResult;
      // Every selected column is a required element: conforming rows have no nulls.
      const requiredCount = result.columns.length;
      const conforming = result.rows.filter((row) => {
        // column 0 is the row key in our views? No — views select only required
        // elements; all columns count.
        for (let index = 0; index < requiredCount; index += 1) {
          const value = row[index];
          if (value === null || value === undefined) return false;
        }
        return true;
      }).length;
      results.push({ check, total: result.rows.length, conforming });
    } catch (error) {
      results.push({ check, total: candidates.length, conforming: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}
