import { buildReferralSummary } from "../fhir/normalize";
import {
  DEFAULT_FHIR_PAGE_LIMIT,
  DEFAULT_REFERENCE_FETCH_LIMIT,
  fetchPatientDataset,
  type FhirDataset,
  type FhirResource
} from "./data";
import type { SmartProvider, SmartSessionInfo, SmartToken, Vendor } from "./types";
import { localVault, type LocalVault } from "../vault/store";

export type ConnectedSourceStatus = "connected" | "fetching" | "ready" | "error" | "needs-reconnect";

export interface ConnectedSource {
  id: string;
  displayName: string;
  providerId?: string;
  providerName?: string;
  patientName?: string;
  fhirBaseUrl: string;
  vendor: Vendor;
  clientId: string;
  patientId: string | null;
  requestedScopes?: string;
  tokenRef: string;
  sessionRef: string;
  connectedAt: number;
  updatedAt: number;
  lastFetchedAt?: number;
  recordCount?: number;
  status: ConnectedSourceStatus;
  lastError?: string;
}

export interface SourceFetchResult {
  source: ConnectedSource;
  dataset: FhirDataset;
}

export const CURRENT_SOURCE_ID = "current";

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function patientName(patient: FhirResource | null | undefined): string | undefined {
  const names = Array.isArray(patient?.name) ? patient.name : [];
  const official = names.find((name) => {
    const use = (name as { use?: unknown }).use;
    return use === "official";
  });
  const selected = (official ?? names[0]) as
    | {
        text?: unknown;
        given?: unknown;
        family?: unknown;
      }
    | undefined;
  if (!selected) return undefined;
  if (typeof selected.text === "string" && selected.text.trim()) return selected.text.trim();
  const given = Array.isArray(selected.given) ? selected.given.filter((value): value is string => typeof value === "string") : [];
  const family = typeof selected.family === "string" ? selected.family : "";
  const label = [...given, family].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return label || undefined;
}

function hostLabel(fhirBaseUrl: string): string {
  try {
    return new URL(fhirBaseUrl).hostname.replace(/^www\./, "");
  } catch {
    return fhirBaseUrl;
  }
}

export function sourceIdForConnection(session: SmartSessionInfo, token: SmartToken): string {
  const patient = token.patientId || "unknown-patient";
  return `src-${stableHash(`${session.fhirBaseUrl.replace(/\/$/, "")}|${patient}`)}`;
}

export function sourceLabel(source: ConnectedSource): string {
  if (source.providerName && source.patientName) return `${source.providerName} · ${source.patientName}`;
  return source.providerName || source.patientName || source.displayName || hostLabel(source.fhirBaseUrl);
}

function createSource(
  session: SmartSessionInfo,
  token: SmartToken,
  existing?: ConnectedSource | null,
  now = Date.now(),
  statusOverride?: ConnectedSourceStatus
): ConnectedSource {
  const id = sourceIdForConnection(session, token);
  const providerName = session.providerName || existing?.providerName;
  const displayName = providerName || existing?.displayName || hostLabel(session.fhirBaseUrl);
  return {
    id,
    displayName,
    providerId: session.providerId || existing?.providerId,
    providerName,
    patientName: existing?.patientName,
    fhirBaseUrl: session.fhirBaseUrl,
    vendor: session.vendor,
    clientId: session.clientId,
    patientId: token.patientId,
    requestedScopes: session.requestedScopes || token.scope || existing?.requestedScopes,
    tokenRef: id,
    sessionRef: id,
    connectedAt: existing?.connectedAt ?? now,
    updatedAt: now,
    lastFetchedAt: existing?.lastFetchedAt,
    recordCount: existing?.recordCount,
    status: statusOverride ?? (existing?.status === "ready" ? "ready" : "connected"),
    lastError: undefined
  };
}

export async function upsertConnectedSource(
  key: CryptoKey,
  session: SmartSessionInfo,
  token: SmartToken,
  options: { vault?: LocalVault; now?: number; statusOverride?: ConnectedSourceStatus } = {}
): Promise<ConnectedSource> {
  const vault = options.vault ?? localVault;
  const now = options.now ?? Date.now();
  const id = sourceIdForConnection(session, token);
  const existing = await vault.getJson<ConnectedSource>(key, { type: "smart-source", id });
  const source = createSource(session, token, existing, now, options.statusOverride);
  await vault.putJson(key, { type: "smart-token", id: source.tokenRef }, token);
  await vault.putJson(key, { type: "smart-session", id: source.sessionRef }, session);
  await vault.putJson(key, { type: "smart-source", id: source.id }, source);

  // Keep legacy single-source pages and older tests working while the app moves
  // to source-scoped records.
  await vault.putJson(key, { type: "smart-token", id: CURRENT_SOURCE_ID }, token);
  await vault.putJson(key, { type: "smart-session", id: CURRENT_SOURCE_ID }, session);
  return source;
}

export async function upsertLocalTestSource(
  key: CryptoKey,
  provider: SmartProvider,
  options: { vault?: LocalVault; now?: number } = {}
): Promise<ConnectedSource> {
  if (!provider.localTestPatientId) throw new Error("Local sandbox provider is missing a test patient id");
  const token: SmartToken = {
    accessToken: "local-smart-dev-sandbox-token",
    tokenType: "Bearer",
    expiresAt: (options.now ?? Date.now()) + 60 * 60 * 1000,
    patientId: provider.localTestPatientId,
    scope: provider.scopes || ""
  };
  const session: SmartSessionInfo = {
    fhirBaseUrl: provider.fhirBaseUrl,
    vendor: provider.vendor,
    clientId: provider.clientId,
    requestedScopes: provider.scopes,
    providerId: provider.id,
    providerName: provider.name
  };
  return upsertConnectedSource(key, session, token, { ...options, statusOverride: "connected" });
}

export async function listConnectedSources(key: CryptoKey, vault = localVault): Promise<ConnectedSource[]> {
  const sources = await vault.listJson<ConnectedSource>(key, "smart-source");
  return sources.sort((left, right) => right.updatedAt - left.updatedAt || sourceLabel(left).localeCompare(sourceLabel(right)));
}

export async function ensureConnectedSources(
  key: CryptoKey,
  vault = localVault
): Promise<ConnectedSource[]> {
  const existing = await listConnectedSources(key, vault);
  if (existing.length > 0) return existing;

  let token: SmartToken | null = null;
  let session: SmartSessionInfo | null = null;
  try {
    token = await vault.getJson<SmartToken>(key, { type: "smart-token", id: CURRENT_SOURCE_ID });
    session = await vault.getJson<SmartSessionInfo>(key, { type: "smart-session", id: CURRENT_SOURCE_ID });
  } catch {
    return [];
  }
  if (!token || !session) return [];

  await upsertConnectedSource(key, session, token, { vault });
  return listConnectedSources(key, vault);
}

export async function getSourceCredentials(
  key: CryptoKey,
  source: ConnectedSource,
  vault = localVault
): Promise<{ token: SmartToken; session: SmartSessionInfo }> {
  const token = await vault.getJson<SmartToken>(key, { type: "smart-token", id: source.tokenRef });
  const session = await vault.getJson<SmartSessionInfo>(key, { type: "smart-session", id: source.sessionRef });
  if (!token || !session) throw new Error(`Connection material is missing for ${sourceLabel(source)}`);
  return { token, session };
}

export async function getSourceDataset(
  key: CryptoKey,
  sourceId: string,
  vault = localVault
): Promise<FhirDataset | null> {
  return vault.getJson<FhirDataset>(key, { type: "source-dataset", id: sourceId });
}

export async function putSourceDataset(
  key: CryptoKey,
  sourceId: string,
  dataset: FhirDataset,
  vault = localVault
): Promise<void> {
  await vault.putJson(key, { type: "source-dataset", id: sourceId }, dataset);
}

async function updateSource(
  key: CryptoKey,
  source: ConnectedSource,
  updates: Partial<ConnectedSource>,
  vault = localVault
): Promise<ConnectedSource> {
  const next: ConnectedSource = {
    ...source,
    ...updates,
    updatedAt: Date.now()
  };
  await vault.putJson(key, { type: "smart-source", id: next.id }, next);
  return next;
}

export async function fetchAndStoreSourceDataset(
  key: CryptoKey,
  source: ConnectedSource,
  options: {
    vault?: LocalVault;
    fetcher?: typeof fetch;
    onStatus?: (source: ConnectedSource) => void;
  } = {}
): Promise<SourceFetchResult> {
  const vault = options.vault ?? localVault;
  let current = await updateSource(key, source, { status: "fetching", lastError: undefined }, vault);
  options.onStatus?.(current);

  try {
    const { token, session } = await getSourceCredentials(key, current, vault);
    const dataset = await fetchPatientDataset(session, token, {
      resourceTypes: [
        "Patient",
        "MedicationRequest",
        "AllergyIntolerance",
        "Condition",
        "Observation",
        "DiagnosticReport",
        "Encounter",
        "Procedure",
        "Immunization"
      ],
      maxPages: DEFAULT_FHIR_PAGE_LIMIT,
      resolveReferences: true,
      maxReferenceFetches: DEFAULT_REFERENCE_FETCH_LIMIT,
      fetcher: options.fetcher
    });

    // Delete the old dataset before writing the new one to avoid doubling
    // storage usage during the write (which can trigger QuotaExceededError
    // if the browser's per-origin quota is tight).
    const oldDataset = await vault.getJson<FhirDataset>(key, { type: "source-dataset", id: current.id });
    if (oldDataset) {
      await vault.delete({ type: "source-dataset", id: current.id });
    }

    await putSourceDataset(key, current.id, dataset, vault);
    const summary = buildReferralSummary(dataset.resources);
    const nextPatientName = patientName(summary.patient);
    current = await updateSource(
      key,
      current,
      {
        displayName: current.providerName || nextPatientName || current.displayName,
        patientName: nextPatientName,
        lastFetchedAt: dataset.fetchedAt,
        recordCount: dataset.resources.length,
        status: "ready",
        lastError: undefined
      },
      vault
    );
    options.onStatus?.(current);
    return { source: current, dataset };
  } catch (error) {
    const message = error instanceof Error ? error.message : "FHIR fetch failed";
    current = await updateSource(
      key,
      current,
      {
        status: message.includes("expired") || message.includes("invalid") ? "needs-reconnect" : "error",
        lastError: message
      },
      vault
    );
    options.onStatus?.(current);
    throw error;
  }
}
