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
  tty?: string;
  canonical_code?: string;
  canonical_system?: string;
}

export interface PatientFriendlyLookupEntry {
  system: PatientFriendlyLookupSystem;
  code: string;
  name: string;
  friendlySource: string;
  matchType: string;
  cui?: string;
  tty?: string;
  canonicalSystem?: string;
  canonicalCode?: string;
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

/**
 * RxNorm TTY (term type) priority — lower number wins.
 * Picks the most specific code when a medication has multiple RxNorm codes.
 *
 *   1. GPCK/BPCK          — packs (specific drugs + doses bundled)
 *   2. SCD/SBD + variants — specific drug (ingredient + strength + form)
 *   3. SCDG/SBDG + dose form/component levels
 *   4. MIN/BN             — multi-ingredient / brand name
 *   5. IN/PIN             — ingredient
 *   6. DF/TMSY/ET         — generic dose form, synonyms, entry terms
 */
const RXNORM_TTY_PRIORITY: Record<string, number> = {
  GPCK: 1, BPCK: 1,
  SCD: 2, SBD: 2, SCDGP: 2, SBDGP: 2, SCDFP: 2, SBDFP: 2,
  SCDG: 3, SBDG: 3, SCDF: 3, SBDF: 3, SCDC: 3, SBDC: 3, DFG: 3,
  MIN: 4, BN: 4,
  PIN: 5, IN: 5,
  DF: 6, TMSY: 6, ET: 6
};

/**
 * ICD-10-CM specificity rank — higher = more specific.
 * Derived from code structure: more characters after the dot = more specific.
 *
 *   E11        → rank 3   (category)
 *   E11.9      → rank 4   (subcategory)
 *   E11.22     → rank 5   (clinical concept)
 *   S72.001A   → rank 7   (most specific, includes extension char)
 */
function icd10SpecificityRank(code: string): number {
  return code.replace(".", "").length;
}

/**
 * Specificity rank for a lookup entry within its system.
 * Returns a number where lower = more specific/preferred.
 * Used to sort candidates before match_type confidence.
 */
function codeSpecificityRank(entry: PatientFriendlyLookupEntry): number {
  if (entry.system === "rxnorm" && entry.tty) {
    return RXNORM_TTY_PRIORITY[entry.tty] ?? 99;
  }
  if (entry.system === "icd10cm") {
    // Invert: higher char count = more specific = lower rank number
    return 99 - icd10SpecificityRank(entry.code);
  }
  return 50; // default — no specificity signal
}

const shardPromises = new Map<PatientFriendlyLookupSystem, Promise<Map<string, PatientFriendlyLookupEntry>>>();

/**
 * Normalize canonical_system values from the data files to the app's
 * CanonicalCodeSystem type. The data uses "lnc" for LOINC and
 * "snomedct_us" for SNOMED — we normalize to "loinc" and "snomed".
 */
function normalizeCanonicalSystem(value: string): string {
  const lower = value.toLowerCase();
  if (lower === "lnc" || lower === "loinc") return "loinc";
  if (lower === "snomedct_us" || lower === "snomedct" || lower === "snomed") return "snomed";
  if (lower === "icd10cm" || lower === "icd-10" || lower === "icd10") return "icd10";
  if (lower === "rxnormn" || lower === "rxnorm") return "rxnorm";
  return lower;
}

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

export async function loadShard(system: PatientFriendlyLookupSystem): Promise<Map<string, PatientFriendlyLookupEntry>> {
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
          cui: entry.cui,
          tty: entry.tty,
          canonicalCode: entry.canonical_code,
          canonicalSystem: entry.canonical_system ? normalizeCanonicalSystem(entry.canonical_system) : undefined
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
    // Within the same system, prefer more specific codes (TTY for RxNorm,
    // character count for ICD-10) before falling back to match_type confidence.
    const specificity = codeSpecificityRank(left) - codeSpecificityRank(right);
    if (specificity !== 0) return specificity;
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
