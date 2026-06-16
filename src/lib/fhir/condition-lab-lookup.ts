interface ConditionLabRelationships {
  version: string;
  total_conditions: number;
  total_pairs: number;
  relationships: Record<string, string[]>;
}

let loaded: ConditionLabRelationships | null = null;
let loadPromise: Promise<ConditionLabRelationships | null> | null = null;

async function loadConditionLabRelationships(): Promise<ConditionLabRelationships | null> {
  if (loaded) return loaded;
  if (loadPromise) return loadPromise;

  loadPromise = fetch("/terminology/condition_lab_relationships.json")
    .then(async (response) => {
      if (!response.ok) return null;
      return (await response.json()) as ConditionLabRelationships;
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
  const data = await loadConditionLabRelationships();
  if (!data) return null;
  if (reverseIndex) return reverseIndex;

  reverseIndex = new Map<string, string[]>();
  for (const [conditionName, labNames] of Object.entries(data.relationships)) {
    for (const labName of labNames) {
      const existing = reverseIndex.get(labName);
      if (existing) existing.push(conditionName);
      else reverseIndex.set(labName, [conditionName]);
    }
  }
  return reverseIndex;
}

export async function findDeterministicConditionsForLab(
  labPatientFriendlyName: string
): Promise<string[]> {
  const index = await getReverseIndex();
  if (!index) return [];
  return index.get(labPatientFriendlyName) ?? [];
}

export async function preloadConditionLabRelationships(): Promise<void> {
  await loadConditionLabRelationships();
}
