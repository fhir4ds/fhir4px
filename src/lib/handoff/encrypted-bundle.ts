import { decryptJson, encryptJson, importVaultKey } from "../vault/crypto";
import { base64UrlToBytes, bytesToBase64Url, toArrayBuffer } from "../vault/encoding";
import type { EncryptedEnvelope } from "../vault/types";

export interface EncryptedBundleArtifact {
  kind: "fhir4px.local-encrypted-bundle";
  version: 1;
  createdAt: string;
  envelope: EncryptedEnvelope;
}

export async function createEncryptedBundleArtifact<T>(
  key: CryptoKey,
  bundle: T
): Promise<EncryptedBundleArtifact> {
  return {
    kind: "fhir4px.local-encrypted-bundle",
    version: 1,
    createdAt: new Date().toISOString(),
    envelope: await encryptJson(key, bundle, "fhir4px.local-encrypted-bundle.v1")
  };
}

export interface LocalEncryptedBundleExport {
  artifact: EncryptedBundleArtifact;
  decryptionKey: string;
}

async function generateExtractableExportKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

async function exportBundleKey(key: CryptoKey): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export async function importBundleKey(decryptionKey: string): Promise<CryptoKey> {
  return importVaultKey(toArrayBuffer(base64UrlToBytes(decryptionKey)));
}

export async function createLocalEncryptedBundleExport<T>(bundle: T): Promise<LocalEncryptedBundleExport> {
  const key = await generateExtractableExportKey();
  return {
    artifact: await createEncryptedBundleArtifact(key, bundle),
    decryptionKey: await exportBundleKey(key)
  };
}

export async function decryptEncryptedBundleArtifact<T>(
  artifact: EncryptedBundleArtifact,
  decryptionKey: string
): Promise<T> {
  if (artifact.kind !== "fhir4px.local-encrypted-bundle" || artifact.version !== 1) {
    throw new Error("Unsupported encrypted Bundle artifact");
  }
  return decryptJson<T>(await importBundleKey(decryptionKey), artifact.envelope);
}
