import { getProductionClientIdForVendor, getSandboxProviders } from "../smart/providers";
import type { Vendor } from "../smart/types";
import type {
  DirectoryOrigin,
  DirectoryProvider,
  DirectorySearchRecord,
  DirectorySort
} from "./types";

const DIRECTORY_ARTIFACT_URL = "/directory-public/chicago-directory.json";
const DIRECTORY_META_URL = "/directory-public/chicago-directory.meta.json";
const MIN_ARTIFACT_QUERY_LENGTH = 2;

interface SearchProvidersOptions {
  sort?: DirectorySort;
  origin?: DirectoryOrigin | null;
  limit?: number;
  includeSandbox?: boolean;
  fetcher?: typeof fetch;
}

let artifactPromise: Promise<DirectorySearchRecord[]> | null = null;
let artifactPromiseUrl = "";

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function inferVendor(fhirBaseUrl: string, accessBrand = ""): Vendor {
  const value = `${fhirBaseUrl} ${accessBrand}`.toLowerCase();
  if (value.includes("cerner") || value.includes("oracle")) return "cerner";
  if (value.includes("epic") || value.includes("mychart")) return "epic";
  return "unknown";
}

function searchText(record: DirectorySearchRecord): string {
  return normalizeText(
    [
      record.displayName,
      record.npi,
      record.providerType,
      record.specialty,
      record.specialtyTerms,
      record.zip5,
      record.state,
      record.practiceLine1,
      record.practiceCity,
      record.practiceState,
      record.practiceZip5,
      record.practiceOrganizationNames,
      ...record.endpointOptions.flatMap((endpoint) => [
        endpoint.accessBrand,
        endpoint.rawAccessBrand,
        endpoint.brandFamily,
        endpoint.fhirBaseUrl,
        endpoint.evidencePathClass,
        endpoint.matchMethod
      ])
    ].join(" ")
  );
}

function matchesQuery(record: DirectorySearchRecord, query: string): boolean {
  const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const haystack = searchText(record);
  return tokens.every((token) => haystack.includes(token));
}

function distanceMiles(origin: DirectoryOrigin, record: DirectorySearchRecord): number | null {
  if (record.lat === null || record.lon === null) return null;

  const earthRadiusMiles = 3958.8;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(record.lat - origin.lat);
  const dLon = toRadians(record.lon - origin.lon);
  const lat1 = toRadians(origin.lat);
  const lat2 = toRadians(record.lat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMiles * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCoordinateOrigin(input: string): DirectoryOrigin | null {
  const coordinateMatch = input.trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!coordinateMatch) return null;
  const lat = Number(coordinateMatch[1]);
  const lon = Number(coordinateMatch[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

async function loadDirectoryArtifact(fetcher: typeof fetch): Promise<DirectorySearchRecord[]> {
  const url = await resolveDirectoryArtifactUrl(fetcher);
  if (fetcher !== fetch) return fetchDirectoryArtifact(fetcher, url);
  if (!artifactPromise || artifactPromiseUrl !== url) {
    artifactPromiseUrl = url;
    artifactPromise = fetchDirectoryArtifact(fetcher, url);
  }
  return artifactPromise;
}

async function resolveDirectoryArtifactUrl(fetcher: typeof fetch): Promise<string> {
  if (import.meta.env.DEV) {
    return `${DIRECTORY_ARTIFACT_URL}?dev=${Date.now().toString(36)}`;
  }

  try {
    const metaUrl = `${DIRECTORY_META_URL}?meta=${Date.now().toString(36)}`;
    const response = await fetcher(metaUrl, { cache: "no-store" });
    if (!response.ok) return DIRECTORY_ARTIFACT_URL;
    const meta = (await response.json()) as { buildTimestamp?: unknown };
    if (typeof meta.buildTimestamp === "string" && meta.buildTimestamp.trim()) {
      return `${DIRECTORY_ARTIFACT_URL}?v=${encodeURIComponent(meta.buildTimestamp)}`;
    }
  } catch {
    return DIRECTORY_ARTIFACT_URL;
  }

  return DIRECTORY_ARTIFACT_URL;
}

async function fetchDirectoryArtifact(fetcher: typeof fetch, url: string): Promise<DirectorySearchRecord[]> {
  try {
    const response = await fetcher(url, { cache: import.meta.env.DEV ? "no-store" : "force-cache" });
    if (!response.ok) return [];
    const records = (await response.json()) as DirectorySearchRecord[];
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

function sandboxProviders(query: string): DirectoryProvider[] {
  const normalized = normalizeText(query);
  return getSandboxProviders()
    .map((provider) => ({
      ...provider,
      endpointStatus: "sandbox" as const,
      accessBrand: provider.name,
      confidence: 1
    }))
    .filter((provider) => !normalized || normalizeText(provider.name).includes(normalized));
}

function toDirectoryProviders(record: DirectorySearchRecord, origin: DirectoryOrigin | null): DirectoryProvider[] {
  const distance = origin ? distanceMiles(origin, record) : null;
  const location = [
    record.practiceLine1,
    [record.practiceCity, record.practiceState].filter(Boolean).join(", "),
    record.practiceZip5 || record.zip5
  ].filter(Boolean).join(" ");
  const baseProvider = {
    location: location || [record.zip5, record.state].filter(Boolean).join(", "),
    npi: record.npi,
    providerType: record.providerType,
    specialty: record.specialty,
    practiceOrganizationNames: record.practiceOrganizationNames,
    directoryStatus: record.directoryStatus,
    distanceMiles: distance
  };

  if (record.endpointOptions.length === 0) {
    return [
      {
        id: `directory-${record.npi}-provider`,
        name: record.displayName,
        vendor: "unknown",
        fhirBaseUrl: "",
        clientId: "",
        endpointStatus: "provider_only",
        accessBrand: "Portal unknown",
        confidence: 0,
        evidence: "No FHIR endpoint association is available yet for this provider.",
        ...baseProvider
      }
    ];
  }

  return record.endpointOptions.map((endpoint, index) => {
    const vendor = inferVendor(endpoint.fhirBaseUrl, endpoint.accessBrand);
    return {
      id: `directory-${record.npi}-${index}`,
      name: record.displayName,
      vendor,
      fhirBaseUrl: endpoint.fhirBaseUrl,
      clientId: getProductionClientIdForVendor(vendor),
      endpointStatus: endpoint.confidence >= 0.9 ? "verified" : "candidate",
      accessBrand: endpoint.accessBrand,
      rawAccessBrand: endpoint.rawAccessBrand,
      brandFamily: endpoint.brandFamily,
      confidence: endpoint.confidence,
      matchMethod: endpoint.matchMethod,
      evidence: endpoint.evidence,
      patientDisplayPolicy: endpoint.patientDisplayPolicy,
      patientDisplayPriority: endpoint.patientDisplayPriority,
      recommendationTier: endpoint.recommendationTier,
      recommendationScore: endpoint.recommendationScore,
      empiricalPrecisionAt1: endpoint.empiricalPrecisionAt1,
      empiricalRecallAt3: endpoint.empiricalRecallAt3,
      empiricalTop3CorrectOrPlausible: endpoint.empiricalTop3CorrectOrPlausible,
      evidencePathClass: endpoint.evidencePathClass,
      pathSummary: endpoint.pathSummary,
      qaFocus: endpoint.qaFocus,
      candidateRank: endpoint.candidateRank,
      candidateSetSize: endpoint.candidateSetSize,
      ...baseProvider
    };
  });
}

function recordRelevance(record: DirectorySearchRecord, query: string): number {
  const normalized = normalizeText(query);
  const displayName = normalizeText(record.displayName);
  const hasEndpoint = record.endpointOptions.length > 0;
  let score = hasEndpoint ? 20 : 0;

  if (displayName === normalized || record.npi === normalized) score += 100;
  if (displayName.includes(normalized)) score += 60;
  if (normalizeText(record.practiceOrganizationNames ?? "").includes(normalized)) score += 35;
  if (record.endpointOptions.some((endpoint) => normalizeText(endpoint.accessBrand).includes(normalized))) {
    score += 30;
  }

  return score;
}

function compareRecords(sort: DirectorySort, origin: DirectoryOrigin | null, query: string) {
  return (left: DirectorySearchRecord, right: DirectorySearchRecord): number => {
    if (sort === "distance" && origin) {
      const leftDistance = distanceMiles(origin, left);
      const rightDistance = distanceMiles(origin, right);
      if (leftDistance !== null || rightDistance !== null) {
        return (leftDistance ?? Number.POSITIVE_INFINITY) - (rightDistance ?? Number.POSITIVE_INFINITY);
      }
    }

    const relevance = recordRelevance(right, query) - recordRelevance(left, query);
    if (relevance !== 0) return relevance;

    return left.displayName.localeCompare(right.displayName);
  };
}

export async function searchProviders(
  query: string,
  options: SearchProvidersOptions = {}
): Promise<DirectoryProvider[]> {
  const sort = options.sort ?? "name";
  const origin = options.origin ?? null;
  const limit = options.limit ?? 50;
  const fetcher = options.fetcher ?? fetch;
  const includeSandbox = options.includeSandbox ?? true;
  const normalized = normalizeText(query);
  const sandboxes = includeSandbox ? sandboxProviders(query) : [];

  if (normalized.length < MIN_ARTIFACT_QUERY_LENGTH) return sandboxes;

  const artifactRecords = await loadDirectoryArtifact(fetcher);
  const directoryProviders = artifactRecords
    .filter((record) => matchesQuery(record, normalized))
    .sort(compareRecords(sort, origin, normalized))
    .slice(0, limit)
    .flatMap((record) => toDirectoryProviders(record, origin))
    .slice(0, limit);

  return [...sandboxes, ...directoryProviders];
}

export async function resolveDirectoryOrigin(
  input: string,
  options: { fetcher?: typeof fetch } = {}
): Promise<DirectoryOrigin | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const coordinates = parseCoordinateOrigin(trimmed);
  if (coordinates) return coordinates;

  const zip = trimmed.match(/\b\d{5}\b/)?.[0];
  if (!zip) return null;

  const artifactRecords = await loadDirectoryArtifact(options.fetcher ?? fetch);
  const matches = artifactRecords.filter(
    (record) => record.zip5 === zip && record.lat !== null && record.lon !== null
  );
  if (matches.length === 0) return null;

  const totals = matches.reduce(
    (current, record) => ({
      lat: current.lat + (record.lat ?? 0),
      lon: current.lon + (record.lon ?? 0)
    }),
    { lat: 0, lon: 0 }
  );

  return {
    lat: totals.lat / matches.length,
    lon: totals.lon / matches.length
  };
}

export async function getDirectoryProvider(id: string): Promise<DirectoryProvider | null> {
  const sandbox = sandboxProviders("").find((provider) => provider.id === id);
  if (sandbox) return sandbox;

  const providerOnlyMatch = id.match(/^directory-(\d+)-provider$/);
  const match = id.match(/^directory-(\d+)-(\d+)$/);
  if (providerOnlyMatch) {
    const records = await loadDirectoryArtifact(fetch);
    const record = records.find((item) => item.npi === providerOnlyMatch[1]);
    if (!record) return null;
    return toDirectoryProviders(record, null).find((provider) => provider.endpointStatus === "provider_only") ?? null;
  }
  if (!match) return null;

  const records = await loadDirectoryArtifact(fetch);
  const record = records.find((item) => item.npi === match[1]);
  if (!record) return null;

  return toDirectoryProviders(record, null)[Number(match[2])] ?? null;
}
