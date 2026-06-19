/**
 * GBD Disability Weight lookup.
 *
 * Static JSON asset (`/terminology/gbd_disability_weights.json`) maps ICD-10
 * codes to disability weights (0-1 severity scale). Built from IHME GBD 2023
 * DIRF Appendix 1 Tables S9 + S13 by `scripts/build-gbd-weights.mjs`.
 *
 * Lookup strategy for a single ICD-10 code:
 *   1. Direct hit on the full code (e.g., "E11.9")
 *   2. Truncate subcode digits one at a time ("E11.9" → "E11.90" → "E11.9" → "E11")
 *   3. Return 0 if no match (conditions without a known DW still surface via boosters)
 *
 * The fallback chain handles patient-friendly tables that carry more specific
 * codes than the GBD source ranges (e.g., J45.909 falls back to J45.9 → J45).
 */

export interface GbdWeightTable {
  version: number;
  source: string;
  generatedAt: string;
  aggregation: string;
  causeCount: number;
  codeCount: number;
  unmatchedSequelaeCount: number;
  weights: Record<string, number>;
}

let tablePromise: Promise<GbdWeightTable> | null = null;

export async function loadGbdWeights(): Promise<GbdWeightTable> {
  if (tablePromise) return tablePromise;
  tablePromise = (async () => {
    const response = await fetch("/terminology/gbd_disability_weights.json");
    if (!response.ok) {
      throw new Error(`Failed to load gbd_disability_weights.json: ${response.status}`);
    }
    return (await response.json()) as GbdWeightTable;
  })();
  return tablePromise;
}

/** Test-only: inject a table without going through fetch. */
export function setGbdWeightTableForTest(table: GbdWeightTable | null): void {
  tablePromise = table ? Promise.resolve(table) : null;
}

function normalizeIcd10Code(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Yield progressively shorter versions of an ICD-10 code for fallback lookup.
 * Order: original → drop last subcode digit → ... → 3-char base (e.g., "E11").
 *
 *   "E11.901"   → "E11.901", "E11.90", "E11.9", "E11"
 *   "J45.909"   → "J45.909", "J45.90", "J45.9", "J45"
 *   "I10"       → "I10"
 */
function* codeFallbackChain(rawCode: string): Generator<string> {
  const code = normalizeIcd10Code(rawCode);
  yield code;
  const dotIndex = code.indexOf(".");
  if (dotIndex === -1) return;
  const base = code.slice(0, dotIndex);
  let subcode = code.slice(dotIndex + 1);
  while (subcode.length > 0) {
    subcode = subcode.slice(0, -1);
    if (subcode.length === 0) {
      yield base;
    } else {
      yield `${base}.${subcode}`;
    }
  }
}

export function lookupDwForCode(code: string, table: GbdWeightTable): number {
  for (const candidate of codeFallbackChain(code)) {
    const value = table.weights[candidate];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

/**
 * Scan an arbitrary list of codingKeys (e.g., ["loinc:4548-4", "icd10cm:E11.9",
 * "snomed:44054006"]) and return the first matching ICD-10 code's DW.
 *
 * Returns 0 if no ICD-10 key is present or none of them resolve. The caller
 * treats 0 as "no DW base; rely on boosters only" — conditions with no ICD-10
 * codes can still surface via boosters (max 0.30 contribution).
 */
export function lookupDwForCodingKeys(
  codingKeys: string[] | undefined,
  table: GbdWeightTable
): number {
  if (!codingKeys || codingKeys.length === 0) return 0;
  for (const key of codingKeys) {
    if (typeof key !== "string") continue;
    const separator = key.indexOf(":");
    if (separator <= 0) continue;
    const system = key.slice(0, separator).toLowerCase();
    if (system !== "icd10" && system !== "icd10cm") continue;
    const code = key.slice(separator + 1);
    const dw = lookupDwForCode(code, table);
    if (dw > 0) return dw;
  }
  return 0;
}
