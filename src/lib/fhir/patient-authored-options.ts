export type PatientAuthoredOptionSystem = "rxnorm" | "cvx";

export interface PatientAuthoredCodingOption {
  code: string;
  name: string;
  technicalName: string;
}

interface PatientAuthoredOptionShard {
  version: number;
  system: PatientAuthoredOptionSystem;
  entries: PatientAuthoredCodingOption[];
}

const optionPromises = new Map<PatientAuthoredOptionSystem, Promise<PatientAuthoredCodingOption[]>>();

function terminologyBaseUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/?$/, "/")}terminology/patient-authored`;
}

export async function loadPatientAuthoredCodingOptions(
  system: PatientAuthoredOptionSystem
): Promise<PatientAuthoredCodingOption[]> {
  const existing = optionPromises.get(system);
  if (existing) return existing;

  const promise = fetch(`${terminologyBaseUrl()}/${system}.json`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Patient-authored ${system} options unavailable`);
      return (await response.json()) as PatientAuthoredOptionShard;
    })
    .then((shard) => shard.entries ?? []);

  optionPromises.set(system, promise);
  return promise;
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchPatientAuthoredCodingOptions(
  options: PatientAuthoredCodingOption[],
  query: string,
  limit = 25
): PatientAuthoredCodingOption[] {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return [];
  const tokens = normalizedQuery.split(" ").filter(Boolean);
  const matches: Array<{ option: PatientAuthoredCodingOption; score: number }> = [];

  for (const option of options) {
    const name = normalizeSearchText(option.name);
    const technicalName = normalizeSearchText(option.technicalName);
    const code = normalizeSearchText(option.code);
    const haystack = `${name} ${technicalName} ${code}`;
    if (!tokens.every((token) => haystack.includes(token))) continue;
    const score =
      (name.startsWith(normalizedQuery) ? 0 : 20) +
      (technicalName.startsWith(normalizedQuery) ? 2 : 0) +
      (code === normalizedQuery ? -5 : 0) +
      Math.min(technicalName.length, 240) / 1000;
    matches.push({ option, score });
    if (matches.length > limit * 8) break;
  }

  return matches
    .sort((left, right) => left.score - right.score || left.option.name.localeCompare(right.option.name))
    .slice(0, limit)
    .map((match) => match.option);
}
