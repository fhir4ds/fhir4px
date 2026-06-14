import { describe, expect, it, vi } from "vitest";
import { ensureConnectedSources, listConnectedSources, upsertConnectedSource } from "../../src/lib/smart/sources";
import { Fhir4PxVaultDatabase } from "../../src/lib/vault/db";
import { decryptJson, encryptJson, generateVaultKey } from "../../src/lib/vault/crypto";
import {
  clearSessionVaultKey,
  clearWebAuthnPrfProfile,
  loadWebAuthnPrfProfile,
  saveWebAuthnPrfProfile
} from "../../src/lib/vault/keys";
import { LocalVault } from "../../src/lib/vault/store";

describe("local vault crypto", () => {
  it("encrypts and decrypts JSON without exposing plaintext in the envelope", async () => {
    const key = await generateVaultKey();
    const payload = { accessToken: "secret-token", patientId: "patient-123" };
    const envelope = await encryptJson(key, payload, "smart-token:current");

    expect(envelope.ciphertext).not.toContain("secret-token");
    expect(JSON.stringify(envelope)).not.toContain("patient-123");
    await expect(decryptJson(key, envelope)).resolves.toEqual(payload);
  });

  it("stores only encrypted vault envelopes in IndexedDB", async () => {
    const db = new Fhir4PxVaultDatabase(`test-vault-${crypto.randomUUID()}`);
    const vault = new LocalVault(db);
    const key = await generateVaultKey();

    await vault.putJson(key, { type: "smart-token", id: "current" }, { accessToken: "secret-token" });
    const rawItems = await db.items.toArray();

    expect(rawItems).toHaveLength(1);
    expect(JSON.stringify(rawItems[0])).not.toContain("secret-token");
    await expect(vault.getJson(key, { type: "smart-token", id: "current" })).resolves.toEqual({
      accessToken: "secret-token"
    });
    await db.delete();
  });

  it("lists records by type without exposing plaintext patch data", async () => {
    const db = new Fhir4PxVaultDatabase(`test-vault-${crypto.randomUUID()}`);
    const vault = new LocalVault(db);
    const key = await generateVaultKey();

    await vault.putJson(key, { type: "patient-patch", id: "patch-1" }, { value: "patient correction" });
    await vault.putJson(key, { type: "smart-session", id: "current" }, { fhirBaseUrl: "https://example.test/fhir" });

    const rawItems = await db.items.toArray();
    expect(JSON.stringify(rawItems)).not.toContain("patient correction");
    await expect(vault.listJson<{ value: string }>(key, "patient-patch")).resolves.toEqual([
      { value: "patient correction" }
    ]);
    await db.delete();
  });

  it("keeps session-only vault keys available across same-tab reloads", async () => {
    window.sessionStorage.clear();
    vi.resetModules();
    const firstKeys = await import("../../src/lib/vault/keys");
    const firstCrypto = await import("../../src/lib/vault/crypto");
    const firstKey = await firstKeys.getOrCreateSessionVaultKey();
    const envelope = await firstCrypto.encryptJson(firstKey, { value: "portal data" }, "smart-source:first");

    vi.resetModules();
    const secondKeys = await import("../../src/lib/vault/keys");
    const secondCrypto = await import("../../src/lib/vault/crypto");
    const secondKey = await secondKeys.getOrCreateSessionVaultKey();

    await expect(secondCrypto.decryptJson(secondKey, envelope)).resolves.toEqual({ value: "portal data" });
    secondKeys.clearSessionVaultKey();
  });

  it("keeps earlier portal sources decryptable after a second SMART redirect reload", async () => {
    window.sessionStorage.clear();
    const db = new Fhir4PxVaultDatabase(`test-vault-${crypto.randomUUID()}`);
    const vault = new LocalVault(db);

    vi.resetModules();
    const firstKeys = await import("../../src/lib/vault/keys");
    const firstKey = await firstKeys.getOrCreateSessionVaultKey();
    await upsertConnectedSource(
      firstKey,
      {
        fhirBaseUrl: "https://first.example.test/fhir",
        vendor: "epic",
        clientId: "first-client",
        providerName: "First Portal"
      },
      {
        accessToken: "first-token",
        tokenType: "Bearer",
        expiresAt: Date.now() + 60_000,
        patientId: "patient-123",
        scope: "patient/Patient.read"
      },
      { vault, now: 1_000 }
    );

    vi.resetModules();
    const secondKeys = await import("../../src/lib/vault/keys");
    const secondKey = await secondKeys.getOrCreateSessionVaultKey();
    await upsertConnectedSource(
      secondKey,
      {
        fhirBaseUrl: "https://second.example.test/fhir",
        vendor: "cerner",
        clientId: "second-client",
        providerName: "Second Portal"
      },
      {
        accessToken: "second-token",
        tokenType: "Bearer",
        expiresAt: Date.now() + 60_000,
        patientId: "patient-123",
        scope: "patient/Patient.read"
      },
      { vault, now: 2_000 }
    );

    await expect(listConnectedSources(secondKey, vault)).resolves.toMatchObject([
      { providerName: "Second Portal" },
      { providerName: "First Portal" }
    ]);
    secondKeys.clearSessionVaultKey();
    await db.delete();
  });

  it("skips stale undecryptable list records without hiding decryptable records", async () => {
    const db = new Fhir4PxVaultDatabase(`test-vault-${crypto.randomUUID()}`);
    const vault = new LocalVault(db);
    const staleKey = await generateVaultKey();
    const activeKey = await generateVaultKey();

    await vault.putJson(staleKey, { type: "smart-source", id: "old" }, { id: "old" });
    await vault.putJson(activeKey, { type: "smart-source", id: "new" }, { id: "new" });

    await expect(vault.listJson<{ id: string }>(activeKey, "smart-source")).resolves.toEqual([{ id: "new" }]);
    await db.delete();
  });

  it("does not let stale legacy current credentials block portal loading", async () => {
    const db = new Fhir4PxVaultDatabase(`test-vault-${crypto.randomUUID()}`);
    const vault = new LocalVault(db);
    const staleKey = await generateVaultKey();
    const activeKey = await generateVaultKey();

    await vault.putJson(staleKey, { type: "smart-token", id: "current" }, { accessToken: "old-token" });
    await vault.putJson(staleKey, { type: "smart-session", id: "current" }, { fhirBaseUrl: "https://old.test/fhir" });

    await expect(ensureConnectedSources(activeKey, vault)).resolves.toEqual([]);
    await db.delete();
  });

  it("stores only non-PHI WebAuthn PRF profile metadata in localStorage", () => {
    window.localStorage.clear();
    saveWebAuthnPrfProfile({
      credentialId: "credential-id",
      salt: "salt",
      label: "fhir4px vault",
      createdAt: "2026-05-25T00:00:00.000Z",
      prfEnabled: true
    });

    expect(loadWebAuthnPrfProfile()).toMatchObject({
      credentialId: "credential-id",
      salt: "salt",
      label: "fhir4px vault"
    });
    expect(JSON.stringify(window.localStorage)).not.toContain("accessToken");
    expect(JSON.stringify(window.localStorage)).not.toContain("patient-123");

    clearWebAuthnPrfProfile();
    clearSessionVaultKey();
    expect(loadWebAuthnPrfProfile()).toBeNull();
  });
});
