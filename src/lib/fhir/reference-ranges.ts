/**
 * Reference range resolver for lab groups.
 *
 * Priority order:
 *   1. Resource range — if any Observation in the group has `referenceRange`
 *      populated, use the most recent one's range (by `effectiveDate`).
 *   2. ACP fallback — look up the LOINC code (carried on the group as
 *      `canonicalCode` when system is loinc), then fall back to patient-
 *      friendly name match against ACP aliases. Apply patient sex for
 *      sex-specific labs.
 *
 * Hard stops (return null):
 *   - Patient under 18 (ACP table is adults-only)
 *   - Sex-specific lab and patient sex is "other"/unknown
 *   - No resource range and no ACP match
 *
 * Unit conversion: the resolver returns the range in the source units (resource
 * units for source="resource", ACP canonical unit for source="acp"). For the
 * soft out-of-range flag, the caller compares observation values to the range;
 * when units differ, we attempt UCUM conversion (async). If conversion fails,
 * no flag is shown — see `valueIsInRange` and `valueIsInRangeAsync`.
 */

import type { PatientFriendlyGroup } from "./patient-groups";
import type { DisplayObservation, ExtractedReferenceRange } from "./types";
import { convertUnit } from "./ucum";

export type PatientSex = "male" | "female" | "other" | "unknown";

export interface GroupReferenceRange {
  low: number;
  high: number;
  unit: string;
  source: "resource" | "acp";
  /** Present when source="acp" and the lab needs MW for cross-dimension conversion. */
  molecularWeight?: number;
  text?: string;
}

interface AcpRangeBound {
  low: number;
  high: number;
}

interface AcpRangeDefinition {
  name: string;
  aliases: string[];
  /** Additional LOINC codes that map to this same range (e.g., panel codes). */
  alternateCodes?: string[];
  canonicalUnit: string;
  molecularWeight?: number;
  charge?: number;
  ranges: {
    default?: AcpRangeBound;
    male?: AcpRangeBound;
    female?: AcpRangeBound;
  };
  note?: string;
}

export interface ReferenceRangeTable {
  version: number;
  source: string;
  adultOnlyAgeYears: number;
  ranges: Record<string, AcpRangeDefinition>;
}

let tablePromise: Promise<ReferenceRangeTable> | null = null;
let codeIndex: Map<string, { loinc: string; def: AcpRangeDefinition }> | null = null;

export async function loadReferenceRanges(): Promise<ReferenceRangeTable> {
  if (tablePromise) return tablePromise;
  tablePromise = (async () => {
    const response = await fetch("/terminology/reference_ranges.json");
    if (!response.ok) {
      throw new Error(`Failed to load reference_ranges.json: ${response.status}`);
    }
    return (await response.json()) as ReferenceRangeTable;
  })();
  return tablePromise;
}

/** Test-only: inject a table without going through fetch. */
export function setReferenceRangeTableForTest(table: ReferenceRangeTable | null): void {
  tablePromise = table ? Promise.resolve(table) : null;
  codeIndex = null;
}

function buildCodeIndex(table: ReferenceRangeTable): Map<string, { loinc: string; def: AcpRangeDefinition }> {
  const index = new Map<string, { loinc: string; def: AcpRangeDefinition }>();
  for (const [primaryCode, def] of Object.entries(table.ranges)) {
    index.set(primaryCode, { loinc: primaryCode, def });
    for (const alt of def.alternateCodes ?? []) {
      if (!index.has(alt)) index.set(alt, { loinc: primaryCode, def });
    }
  }
  return index;
}

function getCodeIndex(table: ReferenceRangeTable): Map<string, { loinc: string; def: AcpRangeDefinition }> {
  if (!codeIndex) codeIndex = buildCodeIndex(table);
  return codeIndex;
}

function findAcpEntryByLoinc(
  code: string | undefined,
  table: ReferenceRangeTable
): { loinc: string; def: AcpRangeDefinition } | null {
  if (!code) return null;
  return getCodeIndex(table).get(code) ?? null;
}

/**
 * Gather every LOINC code carried by the group: the group's canonicalCode
 * (resolved from patient-friendly name via canonical-codes tables, when
 * system is loinc) plus every observation's codingKeys. Multiple codes
 * commonly map to the same patient-friendly name (e.g., 8480-6 direct vs
 * 85354-9 panel for systolic BP); we try each in order against the ACP
 * table and return the first hit.
 */
function gatherGroupLoincCodes(
  group: PatientFriendlyGroup,
  observations: DisplayObservation[]
): string[] {
  const codes: string[] = [];
  if (group.canonicalCode?.system === "loinc" && group.canonicalCode.code) {
    codes.push(group.canonicalCode.code);
  }
  for (const obs of observations) {
    for (const key of obs.codingKeys ?? []) {
      if (key.startsWith("loinc:")) {
        const code = key.slice("loinc:".length);
        if (code && !codes.includes(code)) codes.push(code);
      }
    }
  }
  return codes;
}

function canonicalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findAcpEntryByName(
  name: string,
  table: ReferenceRangeTable
): { loinc: string; def: AcpRangeDefinition } | null {
  const target = canonicalizeName(name);
  if (!target) return null;
  for (const [loinc, def] of Object.entries(table.ranges)) {
    const candidates = [def.name, ...def.aliases];
    for (const candidate of candidates) {
      if (canonicalizeName(candidate) === target) {
        return { loinc, def };
      }
    }
  }
  return null;
}

function pickSexSpecificRange(
  def: AcpRangeDefinition,
  sex: PatientSex
): AcpRangeBound | null {
  if (sex === "male" && def.ranges.male) return def.ranges.male;
  if (sex === "female" && def.ranges.female) return def.ranges.female;
  if (def.ranges.default) return def.ranges.default;
  // Lab is sex-specific (only male/female ranges defined) but sex is
  // other/unknown → per design, hide the range entirely.
  return null;
}

function pickMostRecentResourceRange(observations: DisplayObservation[]): ExtractedReferenceRange | null {
  const sorted = [...observations].sort((a, b) => {
    const aDate = a.effectiveDate ?? "";
    const bDate = b.effectiveDate ?? "";
    return bDate.localeCompare(aDate);
  });
  for (const obs of sorted) {
    if (obs.referenceRange && (obs.referenceRange.low !== undefined || obs.referenceRange.high !== undefined)) {
      return obs.referenceRange;
    }
  }
  return null;
}

function withUnit(range: ExtractedReferenceRange, fallbackUnit?: string): { low: number; high: number; unit: string; text?: string } | null {
  const low = range.low;
  const high = range.high;
  if (low === undefined && high === undefined) return null;
  const unit = range.unit ?? range.ucumCode ?? fallbackUnit ?? "";
  return {
    low: low ?? Number.NEGATIVE_INFINITY,
    high: high ?? Number.POSITIVE_INFINITY,
    unit,
    text: range.text
  };
}

export interface ResolveGroupReferenceRangeParams {
  group: PatientFriendlyGroup;
  observations: DisplayObservation[];
  patientSex: PatientSex;
  patientAgeYears: number | null;
  table?: ReferenceRangeTable;
}

export async function resolveGroupReferenceRange(
  params: ResolveGroupReferenceRangeParams
): Promise<GroupReferenceRange | null> {
  const { group, observations, patientSex, patientAgeYears } = params;
  if (patientAgeYears === null) return null;
  const table = params.table ?? await loadReferenceRanges();
  if (patientAgeYears < table.adultOnlyAgeYears) return null;

  // 1. Resource range (most recent observation carrying one)
  const resourceRange = pickMostRecentResourceRange(observations);
  if (resourceRange) {
    const normalized = withUnit(resourceRange);
    if (normalized) {
      return {
        low: normalized.low,
        high: normalized.high,
        unit: normalized.unit,
        source: "resource",
        text: normalized.text
      };
    }
  }

  // 2. ACP fallback — try every LOINC code in the group first (canonicalCode
  //    plus every observation's codingKeys), then patient-friendly name. The
  //    multi-code scan handles groups that span variants (e.g., systolic BP
  //    direct 8480-6 mixed with panel code 85354-9).
  let entry: { loinc: string; def: AcpRangeDefinition } | null = null;
  for (const code of gatherGroupLoincCodes(group, observations)) {
    entry = findAcpEntryByLoinc(code, table);
    if (entry) break;
  }
  if (!entry) {
    entry = findAcpEntryByName(group.patientFriendlyName, table);
  }
  if (!entry) return null;

  const bound = pickSexSpecificRange(entry.def, patientSex);
  if (!bound) return null;

  return {
    low: bound.low,
    high: bound.high,
    unit: entry.def.canonicalUnit,
    source: "acp",
    molecularWeight: entry.def.molecularWeight
  };
}

function normalizeUnit(unit: string | undefined): string {
  return (unit ?? "").trim().toLowerCase();
}

/**
 * Sync in-range check. Returns true/false when units already match (after
 * case-insensitive comparison). Returns null when units differ — caller should
 * fall back to `valueIsInRangeAsync` (which uses UCUM conversion).
 */
export function valueIsInRange(
  value: number,
  valueUnit: string | undefined,
  range: GroupReferenceRange
): boolean | null {
  if (normalizeUnit(valueUnit) !== normalizeUnit(range.unit)) return null;
  return value >= range.low && value <= range.high;
}

/**
 * Async in-range check that converts the value's unit to the range's unit via
 * UCUM when they differ. Returns null if conversion fails.
 */
export async function valueIsInRangeAsync(
  value: number,
  valueUnit: string | undefined,
  range: GroupReferenceRange
): Promise<boolean | null> {
  if (normalizeUnit(valueUnit) === normalizeUnit(range.unit)) {
    return value >= range.low && value <= range.high;
  }
  if (!valueUnit) return null;
  const converted = await convertUnit(value, valueUnit, range.unit, {
    molecularWeight: range.molecularWeight
  });
  if (converted === null) return null;
  return converted >= range.low && converted <= range.high;
}

/**
 * Convenience: scan a list of observations for any value outside the range.
 * Async because some comparisons need UCUM conversion. Returns null if any
 * comparison is inconclusive (caller can re-render later).
 */
export async function groupHasOutOfRangeValue(
  observations: DisplayObservation[],
  range: GroupReferenceRange
): Promise<boolean | null> {
  let inconclusive = false;
  for (const obs of observations) {
    const numeric = obs.normalizedValue.numericValue;
    if (typeof numeric !== "number" || !Number.isFinite(numeric)) continue;
    const unit = obs.normalizedValue.ucumCode ?? obs.normalizedValue.displayUnit;
    const result = await valueIsInRangeAsync(numeric, unit, range);
    if (result === false) return true;
    if (result === null) inconclusive = true;
  }
  return inconclusive ? null : false;
}
