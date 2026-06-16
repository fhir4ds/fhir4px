import type { GroupableRecord, PatientObservationBucket } from "../../fhir/patient-groups";
import type { NamingResult } from "./types";
import { canonicalName, meaningfulTokens, medicationNamingMatchesSource, fallbackNamingForRecord } from "./validate";

export function parseObservationBucket(value: unknown): PatientObservationBucket | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (normalized === "lab" || normalized === "labs" || normalized === "laboratory") return "labs";
  if (normalized === "vital" || normalized === "vitals" || normalized === "vital-sign" || normalized === "vital-signs") {
    return "vitals";
  }
  if (normalized === "other") return "other";
  return undefined;
}

export function parseNamingResponse(value: unknown): {
  patientFriendlyName: string;
  observationBucket?: PatientObservationBucket;
  confidence: number;
  fallback: boolean;
} {
  const parsed = value as {
    patientFriendlyName?: unknown;
    observationBucket?: unknown;
    confidence?: unknown;
    fallback?: unknown;
  } | undefined;
  const patientFriendlyName =
    typeof parsed?.patientFriendlyName === "string" && parsed.patientFriendlyName.trim()
      ? parsed.patientFriendlyName.trim().slice(0, 80)
      : undefined;
  if (!patientFriendlyName) throw new Error("LLM returned a naming response without patientFriendlyName");
  return {
    patientFriendlyName,
    observationBucket: parseObservationBucket(parsed?.observationBucket),
    confidence:
      typeof parsed?.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    fallback: Boolean(parsed?.fallback)
  };
}

function namingBatchItems(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  const parsed = value as { items?: unknown[]; results?: unknown[]; records?: unknown[] } | undefined;
  if (Array.isArray(parsed?.items)) return parsed.items;
  if (Array.isArray(parsed?.results)) return parsed.results;
  if (Array.isArray(parsed?.records)) return parsed.records;
  return undefined;
}

function namingCandidateId(value: unknown): string | undefined {
  const candidate = value as { id?: unknown; recordId?: unknown; resourceId?: unknown } | undefined;
  if (typeof candidate?.id === "string") return candidate.id;
  if (typeof candidate?.recordId === "string") return candidate.recordId;
  if (typeof candidate?.resourceId === "string") return candidate.resourceId;
  return undefined;
}

export function parseNamingBatchResponse(value: unknown, records: GroupableRecord[]): NamingResult[] {
  const items = namingBatchItems(value);
  if (records.length === 1 && !items) {
    return [{ id: records[0].id, ...parseNamingResponse(value) }];
  }
  if (!items) throw new Error("LLM returned a naming batch without items, results, records, or a raw item array");

  const expectedIds = new Set(records.map((record) => record.id));
  const byId = new Map<string, NamingResult>();
  for (const item of items) {
    const candidateId = namingCandidateId(item);
    if (!candidateId || !expectedIds.has(candidateId) || byId.has(candidateId)) continue;
    const record = records.find((r) => r.id === candidateId);
    if (!record) continue;
    byId.set(candidateId, { id: candidateId, ...parseNamingResponse(item) });
  }

  const missing = records.filter((record) => !byId.has(record.id)).map((record) => record.id);
  if (missing.length > 0) throw new Error(`LLM naming batch missed input ids: ${missing.join(", ")}`);

  return records.map((record) => {
    const result = byId.get(record.id);
    if (!result) throw new Error(`LLM naming batch missed input id: ${record.id}`);
    return result;
  });
}

export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Empty response from LLM");

  // Try direct parse first
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to balanced-brace extraction
  }

  // Balanced-brace scanner — finds the first complete {...} block
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escape) { escape = false; continue; }
    if (char === "\\") { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (char === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          start = -1;
        }
      }
    }
  }

  throw new Error("No valid JSON object found in LLM response");
}
