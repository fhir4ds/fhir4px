interface IngredientEntry {
  c: string;
  n: string;
}

type RxnormDecomposition = Record<string, IngredientEntry[]>;

interface RxnormFile {
  _meta?: { schema_version?: string; count?: number };
  [key: string]: IngredientEntry[] | { schema_version?: string; count?: number } | undefined;
}

let loaded: RxnormDecomposition | null = null;
let loadPromise: Promise<RxnormDecomposition | null> | null = null;

async function loadDecomposition(): Promise<RxnormDecomposition | null> {
  if (loaded) return loaded;
  if (loadPromise) return loadPromise;

  loadPromise = fetch("/terminology/rxnorm-ingredients.json")
    .then(async (response) => {
      if (!response.ok) return null;
      return (await response.json()) as RxnormFile;
    })
    .then((data) => {
      if (!data) return null;
      // Strip _meta key — new format has a header object
      const { _meta, ...rest } = data;
      void _meta;
      loaded = rest as RxnormDecomposition;
      return loaded;
    })
    .catch(() => null);

  return loadPromise;
}

export async function getIngredientsForRxnormCode(
  rxnormCode: string
): Promise<Array<{ code: string; name: string }>> {
  const data = await loadDecomposition();
  if (!data) return [];
  return (data[rxnormCode] ?? []).map((entry) => ({ code: entry.c, name: entry.n }));
}

/**
 * Fill missing `ingredients` on medication records from the bundled
 * RxNorm decomposition table. Sources that encode the product inline
 * (medicationCodeableConcept, e.g. Synthea) carry no referenced
 * Medication resource, so normalizeMedication leaves ingredients empty —
 * which makes the Tier-1 naming guard reject correct shard entries whose
 * patient-friendly name is ingredient-based ("Alendronic acid 10 MG Oral
 * Tablet" vs "Alendronate Pill"). Best-effort: offline table keeps the
 * records untouched.
 */
export async function enrichMedicationIngredients<
  T extends { resourceType?: string; codingKeys?: string[]; ingredients?: string[] }
>(records: T[]): Promise<T[]> {
  const needing = records.filter(
    (record) =>
      record.resourceType === "MedicationRequest" &&
      !(record.ingredients ?? []).length &&
      (record.codingKeys ?? []).some((key) => key.startsWith("rxnorm:"))
  );
  if (needing.length === 0) return records;
  const enriched = new Map<T, string[]>();
  for (const record of needing) {
    const names: string[] = [];
    for (const key of record.codingKeys ?? []) {
      if (!key.startsWith("rxnorm:")) continue;
      const ingredients = await getIngredientsForRxnormCode(key.slice("rxnorm:".length));
      for (const ingredient of ingredients) {
        if (!names.includes(ingredient.name)) names.push(ingredient.name);
      }
    }
    if (names.length > 0) enriched.set(record, names);
  }
  if (enriched.size === 0) return records;
  return records.map((record) => {
    const names = enriched.get(record);
    return names ? { ...record, ingredients: names } : record;
  });
}

export async function preloadRxnormDecomposition(): Promise<void> {
  await loadDecomposition();
}

/** Test-only: inject parsed data directly, bypassing fetch. */
export function setRxnormDecompositionForTest(data: RxnormFile | null): void {
  if (data) {
    const { _meta, ...rest } = data;
    void _meta;
    loaded = rest as RxnormDecomposition;
  } else {
    loaded = null;
  }
  loadPromise = null;
}
