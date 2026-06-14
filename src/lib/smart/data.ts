import { filterResourceTypesForScope, MVP_RESOURCE_TYPES, type MvpResourceType } from "./scopes";
import type { SmartSessionInfo, SmartToken, Vendor } from "./types";
import { fetchMissingReferences, type MissingReference } from "../fhir/references";
import { fetchWithContext } from "./fetch-errors";

export interface FhirResource {
  resourceType: string;
  id?: string;
  [key: string]: unknown;
}

export interface FhirDataset {
  patient: FhirResource;
  resources: FhirResource[];
  fetchedAt: number;
  vendor: Vendor;
  referenceResolution?: {
    fetched: number;
    unresolved: MissingReference[];
    skipped: MissingReference[];
  };
}

export interface FetchProgress {
  resourceType: string;
  fetched: number;
  total: number | null;
}

export const DEFAULT_FHIR_PAGE_LIMIT = 50;
export const DEFAULT_REFERENCE_FETCH_LIMIT = 200;

export class FhirAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FhirAuthError";
  }
}

export class FhirScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FhirScopeError";
  }
}

export function buildFhirHeaders(token: SmartToken, session: SmartSessionInfo): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `${token.tokenType} ${token.accessToken}`,
    Accept: "application/fhir+json"
  };

  if (session.vendor === "epic" && session.clientId) {
    headers["Epic-Client-ID"] = session.clientId;
  }

  return headers;
}

export async function fetchAllPages(
  url: string,
  headers: Record<string, string>,
  options: { maxPages?: number; fetcher?: typeof fetch; context?: string } = {}
): Promise<FhirResource[]> {
  const maxPages = options.maxPages ?? DEFAULT_FHIR_PAGE_LIMIT;
  const fetcher = options.fetcher ?? fetch;
  const context = options.context ?? "FHIR resource page";
  const resources: FhirResource[] = [];
  let nextUrl: string | null = url;
  let page = 0;

  while (nextUrl && page < maxPages) {
    const response: Response = await fetchWithContext(fetcher, nextUrl, { headers, cache: "no-store" }, context);
    if (response.status === 401) throw new FhirAuthError("Access token expired or invalid");
    if (response.status === 403) throw new FhirScopeError("Insufficient SMART scope");
    if (!response.ok) throw new Error(`${context} failed (${response.status})`);

    const bundle: any = await response.json();
    if (bundle.resourceType === "Bundle" && Array.isArray(bundle.entry)) {
      for (const entry of bundle.entry) {
        if (entry.resource) resources.push(entry.resource as FhirResource);
      }
    }

    nextUrl =
      bundle.link?.find((link: { relation?: string; url?: string }) => link.relation === "next")?.url ?? null;
    page += 1;
  }

  return resources;
}

export function patientSearchParam(resourceType: MvpResourceType): "patient" | "subject" {
  if (["Observation", "DiagnosticReport", "DocumentReference"].includes(resourceType)) {
    return "patient";
  }
  return "patient";
}

export async function fetchPatientDataset(
  session: SmartSessionInfo,
  token: SmartToken,
  options: {
    resourceTypes?: readonly MvpResourceType[];
    onProgress?: (progress: FetchProgress) => void;
    fetcher?: typeof fetch;
    maxPages?: number;
    resolveReferences?: boolean;
    maxReferenceFetches?: number;
  } = {}
): Promise<FhirDataset> {
  if (!token.patientId) throw new Error("SMART token did not include a patient id");

  const base = session.fhirBaseUrl.replace(/\/$/, "");
  const headers = buildFhirHeaders(token, session);
  const fetcher = options.fetcher ?? fetch;
  const effectiveScope = token.scope || session.requestedScopes;

  const patientResponse = await fetchWithContext(
    fetcher,
    `${base}/Patient/${encodeURIComponent(token.patientId)}`,
    {
      headers,
      cache: "no-store"
    },
    "FHIR Patient read"
  );
  if (patientResponse.status === 401) throw new FhirAuthError("Access token expired or invalid");
  if (!patientResponse.ok) throw new Error(`Failed to fetch Patient/${token.patientId}`);

  const patient = (await patientResponse.json()) as FhirResource;
  const resources: FhirResource[] = [patient];
  const resourceTypes = filterResourceTypesForScope(options.resourceTypes ?? MVP_RESOURCE_TYPES, effectiveScope, {
    allowWhenUnknown: true
  });

  const batches = await Promise.all(
    resourceTypes
      .filter((resourceType) => resourceType !== "Patient")
      .map(async (resourceType) => {
        options.onProgress?.({ resourceType, fetched: 0, total: null });
        const searchParam = patientSearchParam(resourceType);
        const url = `${base}/${resourceType}?${searchParam}=${encodeURIComponent(token.patientId!)}&_count=100`;

        try {
          const fetched = await fetchAllPages(url, headers, {
            fetcher,
            maxPages: options.maxPages,
            context: `FHIR ${resourceType} search`
          });
          options.onProgress?.({ resourceType, fetched: fetched.length, total: fetched.length });
          return fetched;
        } catch (error) {
          if (error instanceof FhirAuthError) throw error;
          options.onProgress?.({ resourceType, fetched: 0, total: 0 });
          return [];
        }
      })
  );

  for (const batch of batches) resources.push(...batch);

  let referenceResolution: FhirDataset["referenceResolution"];
  if (options.resolveReferences) {
    const resolved = await fetchMissingReferences(resources, {
      fhirBaseUrl: base,
      headers,
      fetcher,
      scope: effectiveScope,
      maxReferences: options.maxReferenceFetches
    });
    resources.splice(0, resources.length, ...resolved.resources);
    referenceResolution = {
      fetched: resolved.fetched.length,
      unresolved: resolved.unresolved,
      skipped: resolved.skipped
    };
  }

  return {
    patient,
    resources,
    fetchedAt: Date.now(),
    vendor: session.vendor,
    referenceResolution
  };
}
