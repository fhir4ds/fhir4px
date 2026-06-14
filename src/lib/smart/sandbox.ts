import type { SmartProvider, SmartSandboxPatient } from "./types";

function patientLabel(patient: { id?: string; name?: unknown }): string {
  const names = Array.isArray(patient.name) ? patient.name : [];
  const selected = names.find((name) => (name as { use?: unknown }).use === "official") ?? names[0];
  const name = selected as { text?: unknown; given?: unknown; family?: unknown } | undefined;
  if (typeof name?.text === "string" && name.text.trim()) return name.text.trim();
  const given = Array.isArray(name?.given) ? name.given.filter((value): value is string => typeof value === "string") : [];
  const family = typeof name?.family === "string" ? name.family : "";
  return [...given, family].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || patient.id || "Patient";
}

export function configuredSandboxPatients(provider: SmartProvider): SmartSandboxPatient[] {
  const configured = provider.localTestPatients ?? [];
  if (configured.length > 0) return configured;
  return provider.localTestPatientId
    ? [{ id: provider.localTestPatientId, label: provider.localTestPatientId, source: "configured" }]
    : [];
}

export function mergeSandboxPatients(
  configured: SmartSandboxPatient[],
  discovered: SmartSandboxPatient[]
): SmartSandboxPatient[] {
  return [
    ...new Map(
      [...configured, ...discovered].map((patient) => [
        patient.id,
        {
          ...patient,
          source: patient.source ?? (configured.some((candidate) => candidate.id === patient.id) ? "configured" : "server")
        } satisfies SmartSandboxPatient
      ])
    ).values()
  ].sort((left, right) => left.label.localeCompare(right.label));
}

export async function fetchSandboxPatients(
  provider: SmartProvider,
  options: { fetcher?: typeof fetch; limit?: number } = {}
): Promise<SmartSandboxPatient[]> {
  const fetcher = options.fetcher ?? fetch;
  const limit = options.limit ?? 100;
  const base = provider.fhirBaseUrl.replace(/\/$/, "");
  const response = await fetcher(`${base}/Patient?_count=${limit}`, {
    headers: { Accept: "application/fhir+json" },
    cache: "no-store"
  });
  if (!response.ok) return [];
  const bundle = await response.json();
  return (bundle.entry ?? [])
    .map((entry: { resource?: { resourceType?: string; id?: string; name?: unknown } }) => entry.resource)
    .filter((resource: { resourceType?: string; id?: string } | undefined) => resource?.resourceType === "Patient" && resource.id)
    .map((patient: { id: string; name?: unknown }) => ({
      id: patient.id,
      label: patientLabel(patient),
      description: patient.id,
      source: "server" as const
    }));
}
