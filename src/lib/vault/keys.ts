import { importVaultKey } from "./crypto";
import { base64UrlToBytes, bytesToBase64Url, toArrayBuffer } from "./encoding";

let sessionVaultKey: CryptoKey | null = null;
const WEBAUTHN_PRF_PROFILE_KEY = "fhir4px_webauthn_prf_profile";
const SESSION_VAULT_KEY_STORAGE_KEY = "fhir4px_session_vault_key";

export interface WebAuthnPrfProfile {
  credentialId: string;
  salt: string;
  label: string;
  createdAt: string;
  prfEnabled?: boolean;
}

export async function getOrCreateSessionVaultKey(): Promise<CryptoKey> {
  if (!sessionVaultKey) {
    const profile = loadWebAuthnPrfProfile();
    sessionVaultKey = profile ? await deriveVaultKeyFromProfile(profile) : await getOrCreateStoredSessionVaultKey();
  }
  return sessionVaultKey;
}

export function clearSessionVaultKey(): void {
  sessionVaultKey = null;
  getSessionStorage()?.removeItem(SESSION_VAULT_KEY_STORAGE_KEY);
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

async function getOrCreateStoredSessionVaultKey(storage = getSessionStorage()): Promise<CryptoKey> {
  const stored = storage?.getItem(SESSION_VAULT_KEY_STORAGE_KEY);
  if (stored) {
    try {
      return importVaultKey(toArrayBuffer(base64UrlToBytes(stored)));
    } catch {
      storage?.removeItem(SESSION_VAULT_KEY_STORAGE_KEY);
    }
  }

  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  storage?.setItem(SESSION_VAULT_KEY_STORAGE_KEY, bytesToBase64Url(rawKey));
  return importVaultKey(toArrayBuffer(rawKey));
}

export function isWebAuthnPrfPotentiallyAvailable(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window && Boolean(navigator.credentials);
}

export function loadWebAuthnPrfProfile(storage: Storage = window.localStorage): WebAuthnPrfProfile | null {
  const raw = storage.getItem(WEBAUTHN_PRF_PROFILE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WebAuthnPrfProfile;
    if (!parsed.credentialId || !parsed.salt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveWebAuthnPrfProfile(profile: WebAuthnPrfProfile, storage: Storage = window.localStorage): void {
  storage.setItem(WEBAUTHN_PRF_PROFILE_KEY, JSON.stringify(profile));
}

export function clearWebAuthnPrfProfile(storage: Storage = window.localStorage): void {
  storage.removeItem(WEBAUTHN_PRF_PROFILE_KEY);
  clearSessionVaultKey();
}

export async function importPrfOutputAsVaultKey(prfOutput: BufferSource): Promise<CryptoKey> {
  if (prfOutput instanceof ArrayBuffer) return importVaultKey(prfOutput);
  return importVaultKey(toArrayBuffer(new Uint8Array(prfOutput.buffer, prfOutput.byteOffset, prfOutput.byteLength)));
}

export async function deriveVaultKeyWithWebAuthnPrf(options: {
  credentialId: ArrayBuffer;
  salt: Uint8Array;
}): Promise<CryptoKey> {
  if (!isWebAuthnPrfPotentiallyAvailable()) {
    throw new Error("WebAuthn PRF is not available in this browser");
  }

  const publicKey = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: [
      {
        id: options.credentialId,
        type: "public-key" as const
      }
    ],
    userVerification: "required" as const,
    extensions: {
      prf: {
        eval: {
          first: options.salt
        }
      }
    }
  };

  const credential = (await navigator.credentials.get({ publicKey } as CredentialRequestOptions)) as
    | (PublicKeyCredential & {
        getClientExtensionResults(): { prf?: { results?: { first?: ArrayBuffer } } };
      })
    | null;

  const first = credential?.getClientExtensionResults?.().prf?.results?.first;
  if (!first) throw new Error("WebAuthn PRF did not return key material");
  return importPrfOutputAsVaultKey(first);
}

export async function deriveVaultKeyFromProfile(profile: WebAuthnPrfProfile): Promise<CryptoKey> {
  return deriveVaultKeyWithWebAuthnPrf({
    credentialId: toArrayBuffer(base64UrlToBytes(profile.credentialId)),
    salt: base64UrlToBytes(profile.salt)
  });
}

export async function createWebAuthnPrfProfile(label = "fhir4px vault"): Promise<WebAuthnPrfProfile> {
  if (!isWebAuthnPrfPotentiallyAvailable()) {
    throw new Error("WebAuthn PRF is not available in this browser");
  }

  const salt = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const publicKey = {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: {
      name: "fhir4px"
    },
    user: {
      id: userId,
      name: label,
      displayName: label
    },
    pubKeyCredParams: [
      { type: "public-key" as const, alg: -7 },
      { type: "public-key" as const, alg: -257 }
    ],
    authenticatorSelection: {
      residentKey: "preferred" as const,
      userVerification: "required" as const
    },
    timeout: 60_000,
    extensions: {
      prf: {
        eval: {
          first: salt
        }
      }
    }
  };

  const credential = (await navigator.credentials.create({ publicKey } as CredentialCreationOptions)) as
    | (PublicKeyCredential & {
        getClientExtensionResults(): { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };
      })
    | null;
  if (!credential) throw new Error("WebAuthn credential registration was cancelled");

  const profile: WebAuthnPrfProfile = {
    credentialId: bytesToBase64Url(new Uint8Array(credential.rawId)),
    salt: bytesToBase64Url(salt),
    label,
    createdAt: new Date().toISOString(),
    prfEnabled: credential.getClientExtensionResults?.().prf?.enabled
  };
  saveWebAuthnPrfProfile(profile);

  const first = credential.getClientExtensionResults?.().prf?.results?.first;
  sessionVaultKey = first ? await importPrfOutputAsVaultKey(first) : null;
  return profile;
}
