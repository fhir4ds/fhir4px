/**
 * Receiving a Bundle file as a source, the reverse of Export.
 *
 * Two shapes are accepted: an encrypted fhir4px Bundle (needs its key) and a
 * plain FHIR or IPS Bundle (no key). The records are stored like a portal's
 * dataset, under an id derived from the file's SHA-256, so importing the same
 * file again replaces it instead of piling up duplicates.
 */

import type { LocalReferralBundle } from "../fhir/bundle";
import { patientDisplayName } from "../fhir/patient-header";
import type { FhirResource } from "../smart/data";
import type { BundleSource } from "../smart/sources";
import { getOrCreateSessionVaultKey } from "../vault/keys";
import { localVault, type LocalVault } from "../vault/store";
import { decryptEncryptedBundleArtifact, type EncryptedBundleArtifact } from "./encrypted-bundle";

export interface ImportedBundle {
  fileName: string;
  format: "encrypted" | "plain";
  /** SHA-256 of the file; the source id is derived from it. */
  fingerprint: string;
  patient: FhirResource;
  resources: FhirResource[];
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bundleResources(entry: Array<{ resource?: unknown }>): FhirResource[] {
  return entry.flatMap((item) => (item.resource ? [item.resource as FhirResource] : []));
}

/**
 * Read and check a Bundle file. The key is only needed for an encrypted
 * fhir4px export; without one the file must be a FHIR Bundle itself.
 */
export async function readBundleFile(file: File, options: { key?: string } = {}): Promise<ImportedBundle> {
  const text = await file.text();
  const key = options.key?.trim();
  let resources: FhirResource[];
  let format: ImportedBundle["format"];

  if (key) {
    const artifact = JSON.parse(text) as EncryptedBundleArtifact;
    const bundle = await decryptEncryptedBundleArtifact<LocalReferralBundle>(artifact, key);
    resources = bundleResources(bundle.entry);
    format = "encrypted";
  } else {
    const parsed = JSON.parse(text) as { resourceType?: unknown; entry?: unknown };
    if (parsed.resourceType !== "Bundle" || !Array.isArray(parsed.entry)) {
      throw new Error(
        "This file is not a FHIR Bundle. If it is an encrypted fhir4px export, enter its decryption key."
      );
    }
    resources = bundleResources(parsed.entry as Array<{ resource?: unknown }>);
    format = "plain";
  }

  const patient = resources.find((resource) => resource.resourceType === "Patient");
  if (!patient) throw new Error("This Bundle has no Patient resource.");
  return { fileName: file.name, format, fingerprint: await sha256Hex(text), patient, resources };
}

/** Store a read Bundle as a source. The same file replaces its earlier import. */
export async function storeBundleSource(options: {
  imported: ImportedBundle;
  key?: CryptoKey;
  vault?: LocalVault;
  now?: number;
}): Promise<BundleSource> {
  const vault = options.vault ?? localVault;
  const key = options.key ?? (await getOrCreateSessionVaultKey());
  const now = options.now ?? Date.now();
  const { imported } = options;
  const id = `bundle-${imported.fingerprint.slice(0, 16)}`;
  const existing = await vault.getJson<BundleSource>(key, { type: "smart-source", id });

  const source: BundleSource = {
    kind: "bundle",
    id,
    displayName: `Received bundle · ${imported.fileName}`,
    patientName: patientDisplayName(imported.patient),
    patientId: typeof imported.patient.id === "string" ? imported.patient.id : null,
    connectedAt: existing?.connectedAt ?? now,
    updatedAt: now,
    lastFetchedAt: now,
    recordCount: imported.resources.length,
    status: "ready",
    fileName: imported.fileName,
    fingerprint: imported.fingerprint
  };

  // Dataset first: a source row never points at records that are not stored.
  await vault.putJson(
    key,
    { type: "source-dataset", id },
    { patient: imported.patient, resources: imported.resources, fetchedAt: now, vendor: "unknown" }
  );
  await vault.putJson(key, { type: "smart-source", id }, source);
  return source;
}
