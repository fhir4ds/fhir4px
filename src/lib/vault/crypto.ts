import { base64UrlToBytes, bytesToBase64Url, decodeText, encodeText, toArrayBuffer } from "./encoding";
import type { EncryptedEnvelope } from "./types";

export async function generateVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function importVaultKey(rawKey: ArrayBuffer): Promise<CryptoKey> {
  if (rawKey.byteLength !== 32) {
    throw new Error("Vault keys must be 32 bytes");
  }
  return crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function derivePassphraseVaultKey(
  passphrase: string,
  salt: Uint8Array,
  iterations = 210_000
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", toArrayBuffer(encodeText(passphrase)), "PBKDF2", false, [
    "deriveKey"
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJson<T>(key: CryptoKey, value: T, aad = ""): Promise<EncryptedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encodeText(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: aad ? toArrayBuffer(encodeText(aad)) : undefined
    },
    key,
    toArrayBuffer(plaintext)
  );

  return {
    version: 1,
    algorithm: "AES-GCM",
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
    aad: aad || undefined
  };
}

export async function decryptJson<T>(key: CryptoKey, envelope: EncryptedEnvelope): Promise<T> {
  if (envelope.version !== 1 || envelope.algorithm !== "AES-GCM") {
    throw new Error("Unsupported vault envelope");
  }

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64UrlToBytes(envelope.iv)),
      additionalData: envelope.aad ? toArrayBuffer(encodeText(envelope.aad)) : undefined
    },
    key,
    toArrayBuffer(base64UrlToBytes(envelope.ciphertext))
  );

  return JSON.parse(decodeText(new Uint8Array(decrypted))) as T;
}
