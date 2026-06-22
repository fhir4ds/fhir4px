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

export async function preloadRxnormDecomposition(): Promise<void> {
  await loadDecomposition();
}
