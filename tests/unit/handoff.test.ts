import { describe, expect, it } from "vitest";
import { createLocalReferralBundle, type LocalReferralBundle } from "../../src/lib/fhir/bundle";
import {
  createLocalEncryptedBundleExport,
  decryptEncryptedBundleArtifact
} from "../../src/lib/handoff/encrypted-bundle";
import {
  createQrSummaryEnvelope,
  estimateUtf8Bytes,
  isScannerSafeQrPayload
} from "../../src/lib/handoff/qr-summary";

describe("handoff artifacts", () => {
  it("creates decryptable encrypted Bundle exports with a shareable one-time key", async () => {
    const bundle = createLocalReferralBundle([
      { resourceType: "Patient", id: "patient-123" },
      { resourceType: "Condition", id: "condition-1" }
    ]);

    const exported = await createLocalEncryptedBundleExport(bundle);
    const plaintext = JSON.stringify(bundle);
    const artifactJson = JSON.stringify(exported.artifact);
    const decrypted = await decryptEncryptedBundleArtifact<LocalReferralBundle>(
      exported.artifact,
      exported.decryptionKey
    );

    expect(exported.artifact.kind).toBe("fhir4px.local-encrypted-bundle");
    expect(exported.decryptionKey.length).toBeGreaterThan(40);
    expect(artifactJson).not.toContain(plaintext);
    expect(artifactJson).not.toContain("patient-123");
    expect(decrypted.entry.map((entry) => entry.resource.id)).toEqual(["patient-123", "condition-1"]);
  });

  it("can include patient patch records in local referral Bundles", () => {
    const bundle = createLocalReferralBundle([{ resourceType: "Patient", id: "patient-123" }], [
      {
        id: "patch-1",
        targetResourceType: "MedicationRequest",
        targetResourceId: "med-1",
        field: "patientMedicationStatus",
        value: "Not taking",
        authoredAt: "2026-05-25T00:00:00.000Z"
      }
    ]);

    expect(bundle.entry).toHaveLength(2);
    expect(bundle.entry[1].fullUrl).toBe("PatientPatch/patch-1");
    expect(bundle.entry[1].resource).toMatchObject({
      targetResourceType: "MedicationRequest",
      value: "Not taking"
    });
  });

  it("estimates QR summary payload size before QR generation", () => {
    const envelope = createQrSummaryEnvelope({
      patient: { resourceType: "Patient", id: "patient-123" },
      medications: [],
      allergies: [],
      conditions: [{ id: "condition-1", label: "Hypertension", source: "provider" }],
      observations: [],
      immunizations: [],
      encounters: [],
      procedures: [],
      diagnosticReports: [],
      generatedAt: "2026-05-25T00:00:00.000Z"
    });

    expect(estimateUtf8Bytes(envelope)).toBeGreaterThan(0);
    expect(isScannerSafeQrPayload(envelope)).toBe(true);
    expect(isScannerSafeQrPayload(envelope, 16)).toBe(false);
  });
});
