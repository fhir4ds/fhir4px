type RxnormDecomposition = Record<string, Array<{ c: string; n: string }>>;

let loaded: RxnormDecomposition | null = null;
let loadPromise: Promise<RxnormDecomposition | null> | null = null;

async function loadDecomposition(): Promise<RxnormDecomposition | null> {
  if (loaded) return loaded;
  if (loadPromise) return loadPromise;

  loadPromise = fetch("/terminology/rxnorm-ingredients.json")
    .then(async (response) => {
      if (!response.ok) return null;
      return (await response.json()) as RxnormDecomposition;
    })
    .then((data) => {
      loaded = data;
      return data;
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
