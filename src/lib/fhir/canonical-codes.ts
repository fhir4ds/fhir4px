/**
 * Canonical code lookup for patient-friendly group names.
 *
 * Static JSON assets under `/terminology/canonical-codes/` (one file per
 * category) map normalized patient-friendly names to canonical codes:
 *   - conditions → ICD-10
 *   - labs       → LOINC
 *   - medications → RxNorm
 *
 * Built from medterm4ds/reports/fhir4px/canonical_codes.csv by
 * `scripts/build-canonical-codes.mjs`.
 *
 * Lazy-loaded: callers request only the categories they need. The Summary
 * view always loads conditions + labs; medications load on demand.
 *
 * Lookup is strict-normalized: lowercase + collapse whitespace + trim. No
 * fuzzy matching — predictable, low false-positive risk.
 */

export type CanonicalCodeSystem = "icd10" | "loinc" | "rxnorm";

export type CanonicalCodeCategory = "condition" | "lab" | "medication";

export interface CanonicalCode {
  system: CanonicalCodeSystem;
  code: string;
}

export interface CanonicalCodeFile {
  version: number;
  generatedAt: string;
  source: string;
  system: CanonicalCodeSystem;
  count: number;
  codes: Record<string, string>;
}

const CATEGORY_TO_SYSTEM: Record<CanonicalCodeCategory, CanonicalCodeSystem> = {
  condition: "icd10",
  lab: "loinc",
  medication: "rxnorm"
};

const CATEGORY_TO_PATH: Record<CanonicalCodeCategory, string> = {
  condition: "/terminology/canonical-codes/conditions.json",
  lab: "/terminology/canonical-codes/labs.json",
  medication: "/terminology/canonical-codes/medications.json"
};

const filePromises: Partial<Record<CanonicalCodeCategory, Promise<CanonicalCodeFile>>> = {};

export function loadCanonicalCodes(
  category: CanonicalCodeCategory
): Promise<CanonicalCodeFile> {
  let promise = filePromises[category];
  if (!promise) {
    promise = (async () => {
      const response = await fetch(CATEGORY_TO_PATH[category]);
      if (!response.ok) {
        throw new Error(`Failed to load ${CATEGORY_TO_PATH[category]}: ${response.status}`);
      }
      return (await response.json()) as CanonicalCodeFile;
    })();
    filePromises[category] = promise;
  }
  return promise;
}

/** Pre-load multiple categories in parallel. */
export async function preloadCanonicalCodes(
  categories: ReadonlyArray<CanonicalCodeCategory>
): Promise<void> {
  await Promise.all(categories.map((c) => loadCanonicalCodes(c)));
}

export function normalizeCanonicalName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Strict-normalized lookup: returns { system, code } if the name is in the
 * table for the given category, null otherwise. The system is fixed per
 * category (condition → icd10, lab → loinc, medication → rxnorm).
 */
export async function lookupCanonicalCode(
  friendlyName: string,
  category: CanonicalCodeCategory
): Promise<CanonicalCode | null> {
  const key = normalizeCanonicalName(friendlyName);
  if (!key) return null;
  const file = await loadCanonicalCodes(category);
  const code = file.codes[key];
  if (!code) return null;
  return { system: CATEGORY_TO_SYSTEM[category], code };
}

/**
 * Bulk lookup variant: caller already loaded the file. Skips the per-call
 * await on the file fetch. Useful when resolving many groups at once.
 */
export function lookupCanonicalCodeInFile(
  friendlyName: string,
  file: CanonicalCodeFile
): CanonicalCode | null {
  const key = normalizeCanonicalName(friendlyName);
  if (!key) return null;
  const code = file.codes[key];
  if (!code) return null;
  return { system: file.system, code };
}

/** Test-only: inject a file without going through fetch. */
export function setCanonicalCodesFileForTest(
  category: CanonicalCodeCategory,
  file: CanonicalCodeFile | null
): void {
  if (file) {
    filePromises[category] = Promise.resolve(file);
  } else {
    delete filePromises[category];
  }
}

/**
 * Map a group's resource types to a canonical-code category. A group may
 * span multiple resource types (rare); pick the dominant one. Returns null
 * for resource types without a canonical system (Encounter, Procedure, etc.).
 */
export function categoryForResourceType(
  resourceTypes: ReadonlyArray<string>
): CanonicalCodeCategory | null {
  if (resourceTypes.includes("Condition")) return "condition";
  if (resourceTypes.includes("Observation")) return "lab";
  if (resourceTypes.includes("MedicationRequest")) return "medication";
  return null;
}
