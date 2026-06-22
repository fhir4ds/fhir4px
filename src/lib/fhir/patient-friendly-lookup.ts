import type { GroupableRecord, GroupableResourceType } from "./patient-groups";

export const PATIENT_FRIENDLY_LOOKUP_MODEL = "patient-friendly-lookup-v2";

export type PatientFriendlyLookupSystem =
  | "loinc"
  | "rxnorm"
  | "icd10cm"
  | "icd10pcs"
  | "snomed"
  | "cvx"
  | "cpt"
  | "hcpcs";

interface NewFormatEntry {
  name: string;
  friendly_source: string;
  match_type: string;
  cui?: string;
}

export interface PatientFriendlyLookupEntry {
  system: PatientFriendlyLookupSystem;
  code: string;
  name: string;
  friendlySource: string;
  matchType: string;
  cui?: string;
}

export interface PatientFriendlyLookupResult extends PatientFriendlyLookupEntry {
  patientFriendlyName: string;
  confidence: number;
  fallback: boolean;
  needsModelFallback: boolean;
}

export type PatientFriendlyLookup = Partial<Record<PatientFriendlyLookupSystem, Map<string, PatientFriendlyLookupEntry>>>;

const SYSTEMS = new Set<PatientFriendlyLookupSystem>([
  "loinc",
  "rxnorm",
  "icd10cm",
  "icd10pcs",
  "snomed",
  "cvx",
  "cpt",
  "hcpcs"
]);

const SYSTEM_ALIASES: Record<string, PatientFriendlyLookupSystem> = {
  loinc: "loinc",
  lnc: "loinc",
  rxnorm: "rxnorm",
  rxnormn: "rxnorm",
  icd10: "icd10cm",
  icd10cm: "icd10cm",
  icd10pcs: "icd10pcs",
  snomed: "snomed",
  snomedct: "snomed",
  snomedct_us: "snomed",
  cvx: "cvx",
  cpt: "cpt",
  hcpcs: "hcpcs"
};

const SYSTEM_FILE_MAP: Record<PatientFriendlyLookupSystem, string> = {
  loinc: "patient_friendly_lnc.json",
  rxnorm: "patient_friendly_rxnorm.json",
  icd10cm: "patient_friendly_icd10cm.json",
  icd10pcs: "patient_friendly_icd10pcs.json",
  snomed: "patient_friendly_snomedct_us.json",
  cvx: "patient_friendly_cvx.json",
  cpt: "patient_friendly_cpt.json",
  hcpcs: "patient_friendly_hcpcs.json"
};

const RESOURCE_SYSTEM_PRIORITY: Record<GroupableResourceType, PatientFriendlyLookupSystem[]> = {
  MedicationRequest: ["rxnorm"],
  AllergyIntolerance: ["snomed"],
  Condition: ["icd10cm", "snomed"],
  Observation: ["loinc", "snomed", "cpt", "hcpcs"],
  Immunization: ["cvx"],
  Encounter: ["snomed", "cpt", "hcpcs"],
  Procedure: ["snomed", "cpt", "hcpcs", "icd10pcs"],
  DiagnosticReport: ["loinc", "snomed", "cpt", "hcpcs"]
};

const MATCH_CONFIDENCE: Record<string, number> = {
  exact: 0.96,
  same_cui: 0.94,
  ingredient: 0.92,
  group: 0.88,
  first_axis: 0.84,
  broader_ingredient: 0.84,
  broader_group: 0.8,
  broader: 0.76,
  snomed_to_target_native_hierarchy: 0.72,
  snomed_to_target_snomed_fallback: 0.68,
  snomed_fallback: 0.64,
  original: 0.5
};

const shardPromises = new Map<PatientFriendlyLookupSystem, Promise<Map<string, PatientFriendlyLookupEntry>>>();

function terminologyBaseUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/?$/, "/")}terminology`;
}

function normalizeText(value: string | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCodingKey(key: string): { system: PatientFriendlyLookupSystem; code: string } | null {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  const rawSystem = key.slice(0, separator).toLowerCase();
  const system = SYSTEM_ALIASES[rawSystem];
  const code = key.slice(separator + 1).trim();
  if (!system || !code) return null;
  return { system, code };
}

async function loadShard(system: PatientFriendlyLookupSystem): Promise<Map<string, PatientFriendlyLookupEntry>> {
  const existing = shardPromises.get(system);
  if (existing) return existing;

  const fileName = SYSTEM_FILE_MAP[system];
  const promise = fetch(`${terminologyBaseUrl()}/${fileName}`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Patient-friendly lookup ${system} unavailable (${response.status})`);
      return (await response.json()) as Record<string, NewFormatEntry>;
    })
    .then((raw) => {
      const entries = new Map<string, PatientFriendlyLookupEntry>();
      for (const [code, entry] of Object.entries(raw)) {
        if (!entry || typeof entry.name !== "string") continue;
        entries.set(code, {
          system,
          code,
          name: entry.name,
          friendlySource: entry.friendly_source ?? "",
          matchType: entry.match_type ?? "",
          cui: entry.cui
        });
      }
      return entries;
    });

  shardPromises.set(system, promise);
  return promise;
}

export function patientFriendlyLookupSystemsForRecords(records: GroupableRecord[]): PatientFriendlyLookupSystem[] {
  const systems = new Set<PatientFriendlyLookupSystem>();
  for (const record of records) {
    for (const key of record.codingKeys ?? []) {
      const parsed = parseCodingKey(key);
      if (parsed && SYSTEMS.has(parsed.system)) systems.add(parsed.system);
    }
  }
  return [...systems].sort();
}

export async function loadPatientFriendlyLookupForRecords(records: GroupableRecord[]): Promise<PatientFriendlyLookup> {
  const systems = patientFriendlyLookupSystemsForRecords(records);
  const settled = await Promise.allSettled(systems.map(async (system) => [system, await loadShard(system)] as const));
  return Object.fromEntries(
    settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
  ) as PatientFriendlyLookup;
}

function confidenceForMatchType(matchType: string): number {
  return MATCH_CONFIDENCE[matchType] ?? 0.6;
}

function resourceSystemRank(resourceType: GroupableResourceType, system: PatientFriendlyLookupSystem): number {
  const priority = RESOURCE_SYSTEM_PRIORITY[resourceType];
  const index = priority.indexOf(system);
  return index >= 0 ? index : priority.length + 1;
}

function lookupEntryNeedsModelFallback(entry: PatientFriendlyLookupEntry): boolean {
  return normalizeText(entry.name) === "";
}

function meaningfulTokens(value: string | undefined): string[] {
  const stopWords = new Set([
    "and",
    "or",
    "the",
    "with",
    "without",
    "tablet",
    "capsule",
    "solution",
    "suspension",
    "oral",
    "product",
    "inhalant"
  ]);
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !stopWords.has(token));
}

function medicationLookupEntryMatchesSource(record: GroupableRecord, entry: PatientFriendlyLookupEntry): boolean {
  if (record.resourceType !== "MedicationRequest") return true;
  const nameTokens = new Set(meaningfulTokens(entry.name));
  const ingredientTokens = (record.ingredients ?? []).flatMap(meaningfulTokens);
  if (ingredientTokens.length > 0) return ingredientTokens.some((token) => nameTokens.has(token));

  const sourceTokens = [
    ...meaningfulTokens(record.sourceLabel),
    ...(record.codeTexts ?? []).flatMap(meaningfulTokens),
    ...(record.codeCodings ?? []).flatMap((coding) => meaningfulTokens(coding.display))
  ];
  if (sourceTokens.length === 0) return true;
  return sourceTokens.some((token) => nameTokens.has(token));
}

export function lookupPatientFriendlyName(
  record: GroupableRecord,
  lookup: PatientFriendlyLookup
): PatientFriendlyLookupResult | null {
  const candidates = (record.codingKeys ?? [])
    .map(parseCodingKey)
    .filter((parsed): parsed is { system: PatientFriendlyLookupSystem; code: string } => Boolean(parsed))
    .map((parsed) => lookup[parsed.system]?.get(parsed.code))
    .filter((entry): entry is PatientFriendlyLookupEntry => Boolean(entry));

  if (candidates.length === 0) return null;

  const sortedCandidates = candidates.sort((left, right) => {
    const rank = resourceSystemRank(record.resourceType, left.system) - resourceSystemRank(record.resourceType, right.system);
    if (rank !== 0) return rank;
    return confidenceForMatchType(right.matchType) - confidenceForMatchType(left.matchType);
  });
  const best = sortedCandidates.find((entry) => medicationLookupEntryMatchesSource(record, entry));
  if (!best) return null;

  const needsModelFallback = lookupEntryNeedsModelFallback(best);
  return {
    ...best,
    patientFriendlyName: best.name,
    confidence: needsModelFallback ? 0.5 : confidenceForMatchType(best.matchType),
    fallback: needsModelFallback,
    needsModelFallback
  };
}
