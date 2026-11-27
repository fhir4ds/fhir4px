import { describe, expect, it } from "vitest";
import { createLocalReferralBundle } from "../../src/lib/fhir/bundle";
import { createLocalEncryptedBundleExport } from "../../src/lib/handoff/encrypted-bundle";
import { readBundleFile, storeBundleSource } from "../../src/lib/handoff/import-bundle";
import { generateVaultKey } from "../../src/lib/vault/crypto";
import { Fhir4PxVaultDatabase } from "../../src/lib/vault/db";
import { LocalVault } from "../../src/lib/vault/store";
import { listConnectedSources } from "../../src/lib/smart/sources";
import type { FhirResource } from "../../src/lib/smart/data";

const patient: FhirResource = {
  resourceType: "Patient",
  id: "imported-patient",
  name: [{ family: "Lopez", given: ["Camila"] }],
  birthDate: "1987-09-12"
} as FhirResource;

const observation: FhirResource = {
  resourceType: "Observation",
  id: "obs-1",
  status: "final",
  code: { text: "Hemoglobin A1c" }
} as FhirResource;

function bundleFile(value: unknown, name = "camila.json"): File {
  return new File([JSON.stringify(value)], name, { type: "application/json" });
}

const plainBundle = {
  resourceType: "Bundle",
  type: "collection",
  entry: [{ resource: patient }, { resource: observation }]
};

describe("readBundleFile", () => {
  it("reads a plain FHIR bundle without a key", async () => {
    const imported = await readBundleFile(bundleFile(plainBundle));

    expect(imported.format).toBe("plain");
    expect(imported.fileName).toBe("camila.json");
    expect(imported.patient.id).toBe("imported-patient");
    expect(imported.resources).toHaveLength(2);
    expect(imported.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads an encrypted fhir4px export with its key", async () => {
    const bundle = createLocalReferralBundle([patient, observation]);
    const { artifact, decryptionKey } = await createLocalEncryptedBundleExport(bundle);

    const imported = await readBundleFile(bundleFile(artifact), { key: decryptionKey });

    expect(imported.format).toBe("encrypted");
    expect(imported.resources.map((resource) => resource.resourceType).sort()).toEqual(["Observation", "Patient"]);
    expect(imported.patient.id).toBe("imported-patient");
  });

  it("refuses an encrypted export that is given without its key", async () => {
    const bundle = createLocalReferralBundle([patient]);
    const { artifact } = await createLocalEncryptedBundleExport(bundle);

    await expect(readBundleFile(bundleFile(artifact))).rejects.toThrow(/not a FHIR Bundle.*decryption key/i);
  });

  it("refuses a bundle without a patient", async () => {
    const noPatient = { resourceType: "Bundle", type: "collection", entry: [{ resource: observation }] };

    await expect(readBundleFile(bundleFile(noPatient))).rejects.toThrow(/no Patient resource/i);
  });

  it("refuses a wrong decryption key", async () => {
    const bundle = createLocalReferralBundle([patient]);
    const { artifact } = await createLocalEncryptedBundleExport(bundle);

    await expect(readBundleFile(bundleFile(artifact), { key: "not-the-key" })).rejects.toThrow();
  });
});

describe("storeBundleSource", () => {
  async function vaultWithKey(): Promise<{ vault: LocalVault; key: CryptoKey }> {
    const db = new Fhir4PxVaultDatabase(`test-vault-${crypto.randomUUID()}`);
    return { vault: new LocalVault(db), key: await generateVaultKey() };
  }

  it("stores the bundle as a source with its records", async () => {
    const { vault, key } = await vaultWithKey();
    const imported = await readBundleFile(bundleFile(plainBundle));

    const source = await storeBundleSource({ imported, key, vault, now: 1000 });

    expect(source.kind).toBe("bundle");
    expect(source.displayName.startsWith("Received bundle · ")).toBe(true);
    expect(source.displayName).not.toContain("camila.json");
    expect(source.fileName).toBe("camila.json");
    expect(source.patientName).toBe("Camila Lopez");
    expect(source.recordCount).toBe(2);
    expect(source.id.startsWith("bundle-")).toBe(true);

    const stored = await vault.getJson<{ resources: FhirResource[] }>(key, {
      type: "source-dataset",
      id: source.id
    });
    expect(stored?.resources).toHaveLength(2);

    const listed = await listConnectedSources(key, vault);
    expect(listed.map((entry) => entry.id)).toEqual([source.id]);
    expect(listed[0].kind).toBe("bundle");
  });

  it("replaces the same file instead of adding it twice", async () => {
    const { vault, key } = await vaultWithKey();
    const imported = await readBundleFile(bundleFile(plainBundle));

    const first = await storeBundleSource({ imported, key, vault, now: 1000 });
    const second = await storeBundleSource({ imported, key, vault, now: 2000 });

    expect(second.id).toBe(first.id);
    expect(second.connectedAt).toBe(1000);
    expect(second.updatedAt).toBe(2000);
    expect(await listConnectedSources(key, vault)).toHaveLength(1);
  });
});
