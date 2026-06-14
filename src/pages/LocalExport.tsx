import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { Download, FileLock2, QrCode, Share2, Upload, UnlockKeyhole } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createLocalReferralBundle, type LocalReferralBundle } from "../lib/fhir/bundle";
import { filterResourcesByLookback } from "../lib/fhir/filters";
import { buildReferralSummary } from "../lib/fhir/normalize";
import type { PatientPatch } from "../lib/fhir/patches";
import {
  createLocalEncryptedBundleExport,
  decryptEncryptedBundleArtifact,
  type EncryptedBundleArtifact
} from "../lib/handoff/encrypted-bundle";
import {
  createQrSummaryEnvelope,
  estimateUtf8Bytes,
  isScannerSafeQrPayload,
  qrSummaryToDataUrl
} from "../lib/handoff/qr-summary";
import { DEFAULT_FHIR_PAGE_LIMIT, fetchPatientDataset } from "../lib/smart/data";
import { MVP_RESOURCE_TYPES, type MvpResourceType } from "../lib/smart/scopes";
import type { SmartSessionInfo, SmartToken } from "../lib/smart/types";
import { getOrCreateSessionVaultKey } from "../lib/vault/keys";
import { localVault } from "../lib/vault/store";

const DEFAULT_RESOURCE_TYPES: readonly MvpResourceType[] = [
  "Patient",
  "MedicationRequest",
  "AllergyIntolerance",
  "Condition",
  "Observation"
];

interface ExportState {
  downloadUrl: string;
  fileName: string;
  decryptionKey: string;
  artifact: EncryptedBundleArtifact;
  resourceCount: number;
  fetchedResourceCount: number;
  patchCount: number;
  qrDataUrl: string | null;
  qrBytes: number;
  qrFallbackReason: string | null;
}

interface ImportState {
  fileName: string;
  resourceCount: number;
  resourceTypes: string[];
}

export function LocalExport() {
  const [selectedResourceTypes, setSelectedResourceTypes] = useState<readonly MvpResourceType[]>(DEFAULT_RESOURCE_TYPES);
  const [includePatches, setIncludePatches] = useState(true);
  const [lookbackDays, setLookbackDays] = useState<number | null>(365);
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareAvailable, setShareAvailable] = useState(false);
  const [exportState, setExportState] = useState<ExportState | null>(null);
  const [importKey, setImportKey] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importState, setImportState] = useState<ImportState | null>(null);

  const selectedSet = useMemo(() => new Set(selectedResourceTypes), [selectedResourceTypes]);

  function toggleResource(resourceType: MvpResourceType): void {
    if (resourceType === "Patient") return;
    setSelectedResourceTypes((current) =>
      current.includes(resourceType)
        ? current.filter((item) => item !== resourceType)
        : [...current, resourceType]
    );
  }

  useEffect(() => {
    return () => {
      if (exportState?.downloadUrl) URL.revokeObjectURL(exportState.downloadUrl);
    };
  }, [exportState?.downloadUrl]);

  useEffect(() => {
    const testFile = new File(["{}"], "fhir4px-test.json", { type: "application/json" });
    setShareAvailable(Boolean(navigator.canShare?.({ files: [testFile] })));
  }, []);

  async function shareExport() {
    if (!exportState) return;
    setError(null);

    try {
      const file = new File([JSON.stringify(exportState.artifact, null, 2)], exportState.fileName, {
        type: "application/json"
      });
      if (!navigator.canShare?.({ files: [file] })) {
        throw new Error("File sharing is not available in this browser");
      }
      await navigator.share({
        files: [file],
        title: "fhir4px encrypted Bundle",
        text: "Encrypted fhir4px referral Bundle"
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not share encrypted Bundle");
    }
  }

  async function buildExport() {
    setBusy(true);
    setError(null);
    setStatus("Fetching selected resources directly from the source FHIR server");
    if (exportState?.downloadUrl) URL.revokeObjectURL(exportState.downloadUrl);
    setExportState(null);

    try {
      const key = await getOrCreateSessionVaultKey();
      const token = await localVault.getJson<SmartToken>(key, { type: "smart-token", id: "current" });
      const session = await localVault.getJson<SmartSessionInfo>(key, { type: "smart-session", id: "current" });
      if (!token || !session) throw new Error("No local SMART connection is available");

      const dataset = await fetchPatientDataset(session, token, {
        resourceTypes: selectedResourceTypes,
        maxPages: DEFAULT_FHIR_PAGE_LIMIT
      });
      const filteredResources = filterResourcesByLookback(dataset.resources, lookbackDays);
      const resourceKeys = new Set(
        filteredResources
          .filter((resource) => resource.id)
          .map((resource) => `${resource.resourceType}:${resource.id}`)
      );
      const storedPatches = includePatches ? await localVault.listJson<PatientPatch>(key, "patient-patch") : [];
      const patches = storedPatches.filter((patch) =>
        resourceKeys.has(`${patch.targetResourceType}:${patch.targetResourceId}`)
      );
      const bundle = createLocalReferralBundle(filteredResources, patches);
      const encryptedExport = await createLocalEncryptedBundleExport(bundle);
      const artifactJson = JSON.stringify(encryptedExport.artifact, null, 2);
      const blob = new Blob([artifactJson], { type: "application/json" });
      const downloadUrl = URL.createObjectURL(blob);
      const fileName = `fhir4px-bundle-${new Date().toISOString().slice(0, 10)}.encrypted.json`;

      const qrEnvelope = createQrSummaryEnvelope(buildReferralSummary(filteredResources));
      const qrBytes = estimateUtf8Bytes(qrEnvelope);
      const qrDataUrl = isScannerSafeQrPayload(qrEnvelope) ? await qrSummaryToDataUrl(qrEnvelope) : null;

      setExportState({
        downloadUrl,
        fileName,
        decryptionKey: encryptedExport.decryptionKey,
        artifact: encryptedExport.artifact,
        resourceCount: filteredResources.length,
        fetchedResourceCount: dataset.resources.length,
        patchCount: patches.length,
        qrDataUrl,
        qrBytes,
        qrFallbackReason: qrDataUrl ? null : "QR summary is too large for scanner-safe transfer"
      });
      setStatus("Encrypted export ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Local export failed");
      setStatus("Export failed");
    } finally {
      setBusy(false);
    }
  }

  async function importEncryptedBundle(file: File | undefined) {
    if (!file) return;

    setImportError(null);
    setImportState(null);

    try {
      if (!importKey.trim()) throw new Error("Enter the decryption key before importing");
      const artifact = JSON.parse(await file.text()) as EncryptedBundleArtifact;
      const bundle = await decryptEncryptedBundleArtifact<LocalReferralBundle>(artifact, importKey.trim());
      const resourceTypes = Array.from(
        new Set(
          bundle.entry
            .map((entry) => ("resourceType" in entry.resource ? entry.resource.resourceType : "PatientPatch"))
            .filter(Boolean)
        )
      ).sort();
      setImportState({
        fileName: file.name,
        resourceCount: bundle.entry.length,
        resourceTypes
      });
    } catch (caught) {
      setImportError(caught instanceof Error ? caught.message : "Could not decrypt encrypted Bundle");
    }
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <Typography variant="h2">Local encrypted Bundle</Typography>
          <Typography color="text.secondary">{status}</Typography>
          {busy && <LinearProgress />}
          {error && <Alert severity="error">{error}</Alert>}

          <Stack spacing={1}>
            <Typography fontWeight={700}>Included resources</Typography>
            <Stack direction="row" flexWrap="wrap" gap={1}>
              {MVP_RESOURCE_TYPES.map((resourceType) => (
                <FormControlLabel
                  key={resourceType}
                  control={
                    <Checkbox
                      checked={selectedSet.has(resourceType)}
                      disabled={resourceType === "Patient" || busy}
                      onChange={() => toggleResource(resourceType)}
                    />
                  }
                  label={resourceType}
                />
              ))}
            </Stack>
            <FormControlLabel
              control={
                <Checkbox
                  checked={includePatches}
                  disabled={busy}
                  onChange={(event) => setIncludePatches(event.target.checked)}
                />
              }
              label="Include patient corrections"
            />
            <TextField
              select
              label="Date range"
              value={lookbackDays ?? "all"}
              onChange={(event) => {
                const value = event.target.value;
                setLookbackDays(value === "all" ? null : Number(value));
              }}
              disabled={busy}
              sx={{ maxWidth: 260 }}
            >
              <MenuItem value={365}>Last 12 months</MenuItem>
              <MenuItem value={730}>Last 24 months</MenuItem>
              <MenuItem value="all">All available dates</MenuItem>
            </TextField>
          </Stack>

          <Button
            variant="contained"
            startIcon={<FileLock2 size={18} />}
            onClick={() => void buildExport()}
            disabled={busy}
          >
            Build encrypted export
          </Button>

          {exportState && (
            <Stack spacing={2}>
              <Divider />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={`${exportState.resourceCount} resources`} />
                {exportState.resourceCount !== exportState.fetchedResourceCount && (
                  <Chip label={`${exportState.fetchedResourceCount} fetched before date filter`} />
                )}
                <Chip label={`${exportState.patchCount} patient corrections`} />
                <Chip label={`${Math.ceil(JSON.stringify(exportState.artifact).length / 1024)} KB encrypted JSON`} />
                <Chip label={`${exportState.qrBytes} QR bytes`} color={exportState.qrDataUrl ? "success" : "warning"} />
              </Stack>

              <Button
                component="a"
                href={exportState.downloadUrl}
                download={exportState.fileName}
                variant="outlined"
                startIcon={<Download size={18} />}
              >
                Save encrypted Bundle
              </Button>
              <Button
                variant="outlined"
                onClick={() => void shareExport()}
                disabled={!shareAvailable}
                startIcon={<Share2 size={18} />}
              >
                Share encrypted Bundle
              </Button>

              <Alert severity="warning">
                Decryption key: <Box component="code" sx={{ wordBreak: "break-all" }}>{exportState.decryptionKey}</Box>
              </Alert>

              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <QrCode size={18} />
                  <Typography fontWeight={700}>QR summary</Typography>
                </Stack>
                {exportState.qrDataUrl ? (
                  <Box
                    component="img"
                    alt="QR summary"
                    src={exportState.qrDataUrl}
                    sx={{ width: 256, height: 256, bgcolor: "white", p: 1, borderRadius: 1 }}
                  />
                ) : (
                  <Alert severity="info">{exportState.qrFallbackReason}</Alert>
                )}
              </Stack>
            </Stack>
          )}

          <Divider />
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} alignItems="center">
              <UnlockKeyhole size={18} />
              <Typography fontWeight={700}>Import/decrypt dev utility</Typography>
            </Stack>
            <Alert severity="info">
              Decrypts an encrypted fhir4px Bundle locally in this browser for receiver workflow testing.
            </Alert>
            {importError && <Alert severity="error">{importError}</Alert>}
            <TextField
              label="Decryption key"
              value={importKey}
              onChange={(event) => setImportKey(event.target.value)}
              fullWidth
            />
            <Button component="label" variant="outlined" startIcon={<Upload size={18} />}>
              Import encrypted Bundle
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => void importEncryptedBundle(event.target.files?.[0])}
              />
            </Button>
            {importState && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={importState.fileName} />
                <Chip label={`${importState.resourceCount} decrypted resources`} color="success" />
                {importState.resourceTypes.map((resourceType) => (
                  <Chip key={resourceType} label={resourceType} />
                ))}
              </Stack>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
