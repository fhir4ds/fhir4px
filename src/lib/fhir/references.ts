import type { FhirResource } from "../smart/data";
import { scopeAllowsResourceRead } from "../smart/scopes";

export interface ResourceIndex {
  byKey: Map<string, FhirResource>;
}

export interface MissingReference {
  reference: string;
  resourceType: string;
  id: string;
  url: string;
  reason: string;
}

export interface ReferenceResolutionResult {
  resources: FhirResource[];
  fetched: FhirResource[];
  unresolved: MissingReference[];
  skipped: MissingReference[];
}

const DISPLAY_REFERENCE_FIELDS: Array<{
  resourceType: string;
  field: string;
  array?: boolean;
  reason: string;
}> = [
  {
    resourceType: "MedicationRequest",
    field: "medicationReference",
    reason: "MedicationRequest display can require referenced Medication"
  },
  {
    resourceType: "MedicationStatement",
    field: "medicationReference",
    reason: "MedicationStatement display can require referenced Medication"
  },
  {
    resourceType: "Encounter",
    field: "reasonReference",
    array: true,
    reason: "Encounter reason can reference a Condition"
  },
  {
    resourceType: "Encounter",
    field: "serviceProvider",
    reason: "Encounter display can reference a service organization"
  },
  {
    resourceType: "DiagnosticReport",
    field: "result",
    array: true,
    reason: "DiagnosticReport result can reference Observations"
  },
  {
    resourceType: "DiagnosticReport",
    field: "encounter",
    reason: "DiagnosticReport context can reference an Encounter"
  },
  {
    resourceType: "DiagnosticReport",
    field: "performer",
    array: true,
    reason: "DiagnosticReport display can reference performer organizations or practitioners"
  },
  {
    resourceType: "Procedure",
    field: "encounter",
    reason: "Procedure context can reference an Encounter"
  },
  {
    resourceType: "Procedure",
    field: "reasonReference",
    array: true,
    reason: "Procedure reason can reference a Condition"
  },
  {
    resourceType: "Observation",
    field: "encounter",
    reason: "Observation context can reference an Encounter"
  }
];

function resourceKey(resourceType: string, id: string): string {
  return `${resourceType}/${id}`;
}

function baseWithoutSlash(base: string): string {
  return base.replace(/\/$/, "");
}

function sameServerRelativeReference(reference: string, fhirBaseUrl: string): string | null {
  if (!reference) return null;
  if (!/^https?:\/\//i.test(reference)) return reference.replace(/^\//, "");

  const base = baseWithoutSlash(fhirBaseUrl);
  if (!reference.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return null;
  return reference.slice(base.length + 1);
}

export function parseReference(
  reference: string | undefined,
  fhirBaseUrl: string
): { resourceType: string; id: string; relativeReference: string; url: string } | null {
  if (!reference) return null;

  const relative = sameServerRelativeReference(reference, fhirBaseUrl);
  if (!relative) return null;

  const [resourceType, id] = relative.split(/[/?#]/).filter(Boolean);
  if (!resourceType || !id || !/^[A-Za-z]+$/.test(resourceType)) return null;

  return {
    resourceType,
    id,
    relativeReference: resourceKey(resourceType, id),
    url: `${baseWithoutSlash(fhirBaseUrl)}/${resourceKey(resourceType, encodeURIComponent(id))}`
  };
}

export function createResourceIndex(resources: FhirResource[], fhirBaseUrl?: string): ResourceIndex {
  const byKey = new Map<string, FhirResource>();
  const base = fhirBaseUrl ? baseWithoutSlash(fhirBaseUrl) : null;

  for (const resource of resources) {
    if (!resource.resourceType || !resource.id) continue;
    const key = resourceKey(resource.resourceType, resource.id);
    byKey.set(key, resource);
    if (base) byKey.set(`${base}/${key}`, resource);
  }

  return { byKey };
}

export function resolveReference(
  reference: string | undefined,
  index: ResourceIndex,
  fhirBaseUrl?: string
): FhirResource | undefined {
  if (!reference) return undefined;
  if (index.byKey.has(reference)) return index.byKey.get(reference);
  if (!fhirBaseUrl) return undefined;

  const parsed = parseReference(reference, fhirBaseUrl);
  return parsed ? index.byKey.get(parsed.relativeReference) : undefined;
}

function readReferenceValues(resource: FhirResource, field: string, array?: boolean): string[] {
  const value = resource[field];
  const values = array ? (Array.isArray(value) ? value : []) : value ? [value] : [];
  return values
    .map((entry) => (entry as { reference?: string } | undefined)?.reference)
    .filter((reference): reference is string => Boolean(reference));
}

export function canReadReferencedResource(scope: string | undefined, resourceType: string): boolean {
  return scopeAllowsResourceRead(scope, resourceType, { allowWhenUnknown: false });
}

export function collectMissingReferences(
  resources: FhirResource[],
  fhirBaseUrl: string,
  options: { scope?: string; maxReferences?: number } = {}
): { missing: MissingReference[]; skipped: MissingReference[] } {
  const index = createResourceIndex(resources, fhirBaseUrl);
  const seen = new Set<string>();
  const missing: MissingReference[] = [];
  const skipped: MissingReference[] = [];
  const maxReferences = options.maxReferences ?? 25;

  for (const resource of resources) {
    for (const definition of DISPLAY_REFERENCE_FIELDS) {
      if (resource.resourceType !== definition.resourceType) continue;

      for (const reference of readReferenceValues(resource, definition.field, definition.array)) {
        const parsed = parseReference(reference, fhirBaseUrl);
        if (!parsed) continue;
        if (index.byKey.has(parsed.relativeReference)) continue;
        if (seen.has(parsed.relativeReference)) continue;

        const item: MissingReference = {
          reference,
          resourceType: parsed.resourceType,
          id: parsed.id,
          url: parsed.url,
          reason: definition.reason
        };
        seen.add(parsed.relativeReference);

        if (!canReadReferencedResource(options.scope, parsed.resourceType)) {
          skipped.push(item);
        } else if (missing.length < maxReferences) {
          missing.push(item);
        } else {
          skipped.push(item);
        }
      }
    }
  }

  return { missing, skipped };
}

export async function fetchMissingReferences(
  resources: FhirResource[],
  options: {
    fhirBaseUrl: string;
    headers: Record<string, string>;
    scope?: string;
    fetcher?: typeof fetch;
    maxReferences?: number;
  }
): Promise<ReferenceResolutionResult> {
  const fetcher = options.fetcher ?? fetch;
  const { missing, skipped } = collectMissingReferences(resources, options.fhirBaseUrl, {
    scope: options.scope,
    maxReferences: options.maxReferences
  });
  const fetched: FhirResource[] = [];
  const unresolved: MissingReference[] = [];

  for (const reference of missing) {
    try {
      const response = await fetcher(reference.url, { headers: options.headers, cache: "no-store" });
      if (!response.ok) {
        unresolved.push(reference);
        continue;
      }
      const resource = (await response.json()) as FhirResource;
      if (resource.resourceType === reference.resourceType) fetched.push(resource);
      else unresolved.push(reference);
    } catch {
      unresolved.push(reference);
    }
  }

  return {
    resources: [...resources, ...fetched],
    fetched,
    unresolved,
    skipped
  };
}
