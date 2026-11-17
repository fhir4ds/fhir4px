/**
 * OMOP concept resolution — batched ConceptMap/$translate against the
 * medterm4ds terminology server (HF Space), with browser-side caching.
 *
 * Strategy "B+C" (agreed 2026-11-16): extract the distinct (system, code)
 * pairs present in the local data, resolve them in batches (POST /fhir
 * type=batch, one $translate entry per code), and cache resolved slices so
 * repeat runs are instant. The primary map is urn:medterm4ds:athena-
 * conceptmap (FHIR code -> urn:athena:concept-id, the OMOP bridge); when
 * the server has no athena tables yet it degrades gracefully to
 * concept_id 0 (OMOP "No matching concept") with source values preserved,
 * so exports remain valid.
 */

import type { FhirResource } from "../smart/data";

export const TERMINOLOGY_SERVER_BASE: string =
  import.meta.env.VITE_TERMINOLOGY_SERVER_URL ?? "https://fhir4ds-terminology-demo-server.hf.space";
export const ATHENA_CONCEPT_MAP_URL = "urn:medterm4ds:athena-conceptmap";
export const ATHENA_TARGET_SYSTEM = "urn:athena:concept-id";

/** Batch size keeps request bodies well under the server's 10 MB cap. */
const BATCH_SIZE = 500;
const CACHE_KEY = "fhir4px:omop-concept-cache:v1";

export interface ConceptMapping {
  system: string;
  code: string;
  conceptId?: string;
}

export interface ConceptResolution {
  mappings: Map<string, string>;
  resolved: number;
  unmatched: number;
  /** Server could not serve the requested map (e.g. athena not ingested). */
  mapUnavailable: boolean;
}

function cacheKeyOf(system: string, code: string): string {
  return `${system}|${code}`;
}

type ConceptCache = Record<string, string>;

function readCache(): ConceptCache {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as ConceptCache;
  } catch {
    return {};
  }
}

function writeCache(cache: ConceptCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or unavailable — resolution still works uncached.
  }
}

const CODE_PATHS: Array<[string, string[]]> = [
  ["Condition", ["code"]],
  ["Observation", ["code"]],
  ["MedicationRequest", ["medicationCodeableConcept"]],
  ["Immunization", ["vaccineCode"]],
  ["Procedure", ["code"]],
  ["AllergyIntolerance", ["code"]],
  ["DiagnosticReport", ["code"]],
  ["Encounter", ["type"]],
  ["Patient", []] // gender handled separately via administrative-gender
];

/** Distinct (system, code) pairs the patient data actually uses. */
export function extractDistinctCodes(resources: FhirResource[]): ConceptMapping[] {
  const seen = new Map<string, ConceptMapping>();
  for (const resource of resources) {
    for (const [, path] of CODE_PATHS) {
      let concept: unknown = resource;
      for (const part of path) {
        if (typeof concept !== "object" || concept === null) break;
        concept = (concept as Record<string, unknown>)[part];
      }
      if (typeof concept !== "object" || concept === null) continue;
      const codings = Array.isArray((concept as { coding?: unknown }).coding)
        ? ((concept as { coding: Array<{ system?: string; code?: string }> }).coding)
        : Array.isArray(concept)
          ? (concept as Array<{ coding?: Array<{ system?: string; code?: string }> }>).flatMap((entry) => entry.coding ?? [])
          : [];
      for (const coding of codings) {
        if (coding.system && coding.code && !seen.has(cacheKeyOf(coding.system, coding.code))) {
          seen.set(cacheKeyOf(coding.system, coding.code), { system: coding.system, code: coding.code });
        }
      }
    }
  }
  return [...seen.values()];
}

interface BatchResponseEntry {
  response?: { status?: string; outcome?: { issue?: Array<{ diagnostics?: string }> } };
  resource?: {
    resourceType?: string;
    parameter?: Array<{
      name?: string;
      valueBoolean?: boolean;
      part?: Array<{ name?: string; valueCode?: string; valueCoding?: { code?: string; system?: string } }>;
    }>;
  };
}

function conceptIdOf(entry: BatchResponseEntry): string | undefined {
  for (const parameter of entry.resource?.parameter ?? []) {
    if (parameter.name !== "match") continue;
    for (const part of parameter.part ?? []) {
      if (part.name === "concept" && part.valueCoding?.system === ATHENA_TARGET_SYSTEM && part.valueCoding.code) {
        return part.valueCoding.code;
      }
    }
  }
  return undefined;
}

function isMapUnavailable(entry: BatchResponseEntry): boolean {
  const diagnostics = entry.response?.outcome?.issue?.[0]?.diagnostics ?? "";
  return /No athena_\* tables|athena ConceptMap/i.test(diagnostics);
}

/**
 * Resolve distinct codes against the terminology server. Cached entries are
 * skipped; misses are batched. A server that cannot serve the map marks the
 * whole resolution degraded (concept_id 0) rather than failing the export.
 */
export async function resolveOmopConcepts(
  mappings: ConceptMapping[],
  options: { baseUrl?: string; fetcher?: typeof fetch; onProgress?: (done: number, total: number) => void } = {}
): Promise<ConceptResolution> {
  const baseUrl = options.baseUrl ?? TERMINOLOGY_SERVER_BASE;
  const fetcher = options.fetcher ?? fetch;
  const cache = readCache();
  const result = new Map<string, string>();
  let mapUnavailable = false;

  const pending: ConceptMapping[] = [];
  for (const mapping of mappings) {
    const key = cacheKeyOf(mapping.system, mapping.code);
    const cached = cache[key];
    if (cached !== undefined) {
      result.set(key, cached);
    } else {
      pending.push(mapping);
    }
  }

  let done = mappings.length - pending.length;
  options.onProgress?.(done, mappings.length);

  for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
    const batch = pending.slice(offset, offset + BATCH_SIZE);
    const entries = batch.map((mapping, index) => ({
      fullUrl: `urn:uuid:omop-t${offset + index}`,
      request: { method: "POST", url: "ConceptMap/$translate" },
      resource: {
        resourceType: "Parameters",
        parameter: [
          { name: "url", valueUri: ATHENA_CONCEPT_MAP_URL },
          { name: "system", valueUri: mapping.system },
          { name: "code", valueCode: mapping.code },
          { name: "targetSystem", valueUri: ATHENA_TARGET_SYSTEM }
        ]
      }
    }));
    const response = await fetcher(`${baseUrl}/fhir`, {
      method: "POST",
      headers: { "Content-Type": "application/fhir+json", Accept: "application/fhir+json" },
      body: JSON.stringify({ resourceType: "Bundle", type: "batch", entry: entries })
    });
    if (!response.ok) {
      throw new Error(`Terminology server batch failed: ${response.status}`);
    }
    const bundle = (await response.json()) as { entry?: BatchResponseEntry[] };
    const responseEntries = bundle.entry ?? [];
    for (let index = 0; index < batch.length && index < responseEntries.length; index += 1) {
      const mapping = batch[index];
      const key = cacheKeyOf(mapping.system, mapping.code);
      const entry = responseEntries[index];
      if (entry.response?.status?.startsWith("2")) {
        const conceptId = conceptIdOf(entry);
        if (conceptId) {
          result.set(key, conceptId);
          cache[key] = conceptId;
        }
      } else if (isMapUnavailable(entry)) {
        mapUnavailable = true;
      }
    }
    done += batch.length;
    options.onProgress?.(Math.min(done, mappings.length), mappings.length);
  }

  if (Object.keys(cache).length > 0) writeCache(cache);

  let resolved = 0;
  for (const mapping of mappings) {
    if (result.get(cacheKeyOf(mapping.system, mapping.code))) resolved += 1;
  }
  return { mappings: result, resolved, unmatched: mappings.length - resolved, mapUnavailable };
}

/** Clear the cached slices (settings-level action or cache bust). */
export function clearOmopConceptCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}
