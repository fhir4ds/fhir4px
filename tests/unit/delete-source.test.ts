import { beforeEach, describe, expect, it } from "vitest";
import { generateVaultKey } from "../../src/lib/vault/crypto";
import { Fhir4PxVaultDatabase } from "../../src/lib/vault/db";
import { deleteSourceData } from "../../src/lib/vault/delete-source";
import { LocalVault } from "../../src/lib/vault/store";
import { CURRENT_SOURCE_ID, type ConnectedSource } from "../../src/lib/smart/sources";
import type { FhirDataset, FhirResource } from "../../src/lib/smart/data";

function source(id: string): ConnectedSource {
  return {
    id,
    displayName: `Portal ${id}`,
    providerName: `Portal ${id}`,
    fhirBaseUrl: `https://${id}.example.org`,
    vendor: "unknown",
    clientId: "client",
    patientId: `patient-${id}`,
    tokenRef: `token-${id}`,
    sessionRef: `session-${id}`,
    connectedAt: 1,
    updatedAt: 1,
    status: "ready"
  };
}

function dataset(patientId: string): FhirDataset {
  return {
    patient: { resourceType: "Patient", id: patientId } as FhirResource,
    resources: [{ resourceType: "Observation", id: "obs-1" }] as FhirResource[],
    fetchedAt: 1,
    vendor: "unknown"
  };
}

describe("deleteSourceData", () => {
  let vault: LocalVault;
  let db: Fhir4PxVaultDatabase;
  let key: CryptoKey;

  beforeEach(async () => {
    db = new Fhir4PxVaultDatabase(`test-vault-${crypto.randomUUID()}`);
    vault = new LocalVault(db);
    key = await generateVaultKey();

    for (const id of ["a", "b"]) {
      const connected = source(id);
      await vault.putJson(key, { type: "smart-source", id }, connected);
      await vault.putJson(key, { type: "smart-token", id: connected.tokenRef }, { accessToken: `token-${id}` });
      await vault.putJson(key, { type: "smart-session", id: connected.sessionRef }, { fhirBaseUrl: connected.fhirBaseUrl });
      await vault.putJson(key, { type: "source-dataset", id }, dataset(connected.patientId ?? ""));
      await vault.putJson(key, { type: "patient-patch", id: `patch-${id}` }, {
        id: `patch-${id}`,
        targetResourceType: "Observation",
        targetResourceId: `${id}:obs-1`,
        field: "note",
        value: "edited",
        authoredAt: "2026-01-01"
      });
      await vault.putJson(key, { type: "care-gap-dismissal", id: `dismissal-${id}` }, {
        id: `dismissal-${id}`,
        patientId: connected.patientId,
        dismissedAt: "2026-01-01"
      });
    }
    // The legacy pointer the quality evaluation reads starts on portal a.
    await vault.putJson(key, { type: "smart-token", id: CURRENT_SOURCE_ID }, { accessToken: "token-a" });
    await vault.putJson(key, { type: "smart-session", id: CURRENT_SOURCE_ID }, { fhirBaseUrl: "https://a.example.org" });
  });

  it("deletes one portal and leaves the other one whole", async () => {
    const result = await deleteSourceData("a", { vault, key });

    expect(result).toEqual({ deleted: true, remaining: 1 });
    expect(await vault.getJson(key, { type: "smart-source", id: "a" })).toBeNull();
    expect(await vault.getJson(key, { type: "smart-token", id: "token-a" })).toBeNull();
    expect(await vault.getJson(key, { type: "smart-session", id: "session-a" })).toBeNull();
    expect(await vault.getJson(key, { type: "source-dataset", id: "a" })).toBeNull();
    expect(await vault.getJson(key, { type: "patient-patch", id: "patch-a" })).toBeNull();
    expect(await vault.getJson(key, { type: "care-gap-dismissal", id: "dismissal-a" })).toBeNull();

    expect(await vault.getJson(key, { type: "smart-source", id: "b" })).not.toBeNull();
    expect(await vault.getJson(key, { type: "source-dataset", id: "b" })).not.toBeNull();
    expect(await vault.getJson(key, { type: "patient-patch", id: "patch-b" })).not.toBeNull();
    expect(await vault.getJson(key, { type: "care-gap-dismissal", id: "dismissal-b" })).not.toBeNull();
  });

  it("moves the legacy current session to a portal that still exists", async () => {
    await deleteSourceData("a", { vault, key });

    await expect(vault.getJson(key, { type: "smart-token", id: CURRENT_SOURCE_ID })).resolves.toEqual({
      accessToken: "token-b"
    });
    await expect(vault.getJson(key, { type: "smart-session", id: CURRENT_SOURCE_ID })).resolves.toEqual({
      fhirBaseUrl: "https://b.example.org"
    });
  });

  it("clears the legacy current session when no portal is left", async () => {
    await deleteSourceData("a", { vault, key });
    const result = await deleteSourceData("b", { vault, key });

    expect(result).toEqual({ deleted: true, remaining: 0 });
    expect(await vault.getJson(key, { type: "smart-token", id: CURRENT_SOURCE_ID })).toBeNull();
    expect(await vault.getJson(key, { type: "smart-session", id: CURRENT_SOURCE_ID })).toBeNull();
  });

  it("does nothing for a portal that is not connected any more", async () => {
    const result = await deleteSourceData("gone", { vault, key });

    expect(result).toEqual({ deleted: false, remaining: 2 });
    expect(await vault.getJson(key, { type: "smart-source", id: "a" })).not.toBeNull();
  });
});
