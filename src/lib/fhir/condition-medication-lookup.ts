import { getIngredientsForRxnormCode } from "./rxnorm-decomposition";

interface ConditionMedicationRelationships {
  version: string;
  total_conditions: number;
  total_pairs: number;
  relationships: Record<string, string[]>;
}

let loaded: ConditionMedicationRelationships | null = null;
let loadPromise: Promise<ConditionMedicationRelationships | null> | null = null;

async function loadConditionMedicationRelationships(): Promise<ConditionMedicationRelationships | null> {
  if (loaded) return loaded;
  if (loadPromise) return loadPromise;

  loadPromise = fetch("/terminology/condition_medication_relationships.json")
    .then(async (response) => {
      if (!response.ok) return null;
      return (await response.json()) as ConditionMedicationRelationships;
    })
    .then((data) => {
      loaded = data;
      return data;
    })
    .catch(() => null);

  return loadPromise;
}

let reverseIndex: Map<string, string[]> | null = null;

async function getReverseIndex(): Promise<Map<string, string[]> | null> {
  const data = await loadConditionMedicationRelationships();
  if (!data) return null;
  if (reverseIndex) return reverseIndex;

  reverseIndex = new Map<string, string[]>();
  for (const [conditionName, medNames] of Object.entries(data.relationships)) {
    for (const medName of medNames) {
      const key = medName.toLowerCase();
      const existing = reverseIndex.get(key);
      if (existing) {
        if (!existing.includes(conditionName)) existing.push(conditionName);
      } else {
        reverseIndex.set(key, [conditionName]);
      }
    }
  }
  return reverseIndex;
}

export interface MedicationLookupOptions {
  /**
   * RxNorm codes for this medication group (e.g. ["860975"] for Metformin
   * 500 MG Oral Tablet). When provided, each code is decomposed into active
   * ingredients via the rxnorm_ingredient_decomposition dataset, and each
   * ingredient name is looked up in the condition reverse index. This is the
   * most authoritative path: it handles branded drugs (e.g. "Glucophage" →
   * metformin) and combination products (e.g. "Janumet" → sitagliptin +
   * metformin) via RxNorm's own decomposition.
   */
  rxnormCodes?: string[];
}

/**
 * Find conditions that the given medication is known to treat, using a
 * layered matching strategy (most authoritative first):
 *
 *   1. RxNorm code → ingredient decomposition → reverse index lookup.
 *      Only runs when `options.rxnormCodes` is provided.
 *   2. Exact patient-friendly name match (splits multi-ingredient names on
 *      " / "). Catches names that already equal an ingredient name.
 *   3. Whole-word substring match against the ingredient index. Catches names
 *      with form suffixes (e.g. "Metformin Oral Product" → "metformin") when
 *      no RxNorm code is available.
 *
 * @returns Condition names (matching the keys of
 *   condition_lab_relationships.json) that any ingredient of this medication
 *   is a known treatment for.
 */
export async function findDeterministicConditionsForMedication(
  medPatientFriendlyName: string,
  options?: MedicationLookupOptions
): Promise<string[]> {
  const index = await getReverseIndex();
  if (!index) return [];

  const conditions: string[] = [];
  const seen = new Set<string>();
  const addIngredientLookup = (ingredientName: string | undefined) => {
    if (!ingredientName) return;
    const matched = index.get(ingredientName.toLowerCase());
    if (!matched) return;
    for (const conditionName of matched) {
      if (!seen.has(conditionName)) {
        seen.add(conditionName);
        conditions.push(conditionName);
      }
    }
  };

  // 1. RxNorm code → ingredients → reverse index (most authoritative).
  if (options?.rxnormCodes && options.rxnormCodes.length > 0) {
    for (const code of options.rxnormCodes) {
      const ingredients = await getIngredientsForRxnormCode(code);
      for (const ingredient of ingredients) {
        addIngredientLookup(ingredient.name);
      }
    }
    if (conditions.length > 0) return conditions;
  }

  // 2. Exact match per ingredient (handles multi-ingredient splits like
  //    "Amlodipine / Hydrochlorothiazide" when both are in the table).
  for (const part of medPatientFriendlyName.split(/\s*\/\s*/)) {
    addIngredientLookup(part.trim());
  }
  if (conditions.length > 0) return conditions;

  // 3. Whole-word substring fallback. Catches "Metformin Oral Product" →
  //    "metformin", "Albuterol Inhalant Product" → "albuterol", etc. The
  //    non-word-boundary anchors prevent false positives like "sin" inside
  //    "metformin". Regex metachars in the key are escaped.
  const lowerName = medPatientFriendlyName.toLowerCase();
  for (const [ingredientKey, conditionNames] of index) {
    const escaped = ingredientKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wordBoundary = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`);
    if (wordBoundary.test(lowerName)) {
      for (const conditionName of conditionNames) {
        if (!seen.has(conditionName)) {
          seen.add(conditionName);
          conditions.push(conditionName);
        }
      }
    }
  }

  return conditions;
}

export async function preloadConditionMedicationRelationships(): Promise<void> {
  await loadConditionMedicationRelationships();
}
