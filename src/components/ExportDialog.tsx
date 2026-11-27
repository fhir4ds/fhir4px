/**
 * Export — the four ways data leaves the app: the encrypted Bundle, an IPS
 * document, the OMOP CDM tables, and the reverse (importing a Bundle). It is a
 * dialog rather than a page because it is a task: the record list stays behind
 * it, and the result (download, key, QR) survives switching tabs.
 *
 * While a job runs the dialog cannot be dismissed by a click outside or Escape,
 * and Close is disabled, so a bundle or an extraction cannot be killed by a
 * stray click.
 */

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import { Database, Download, FileLock2, FileText, QrCode, Share2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createLocalReferralBundle } from "../lib/fhir/bundle";
import { filterResourcesByLookback } from "../lib/fhir/filters";
import { buildReferralSummary } from "../lib/fhir/normalize";
import type { PatientPatch } from "../lib/fhir/patches";
import {
  createLocalEncryptedBundleExport,
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
import { buildIpsBundle } from "../lib/fhir/ips";
import { printIpsHtml } from "../lib/fhir/ips-html";
import { extractDistinctCodes, resolveOmopConcepts } from "../lib/fhir/omop-concepts";
import { omopResultToCsv, runOmopExport, type OmopTableResult } from "../lib/fhir/omop-tables";
import { engineLoadResources } from "../lib/engine/engine-client";
import { holdAppUpdate } from "../lib/pwa/update-hold";
import { analyticResources, loadAnalyticResources } from "../lib/fhir/analytic-resources";
import { getOrCreateSessionVaultKey } from "../lib/vault/keys";
import { localVault } from "../lib/vault/store";

const DEFAULT_RESOURCE_TYPES: readonly MvpResourceType[] = [
  "Patient",
  "MedicationRequest",
  "AllergyIntolerance",
  "Condition",
  "Observation"
];

type ExportTab = "bundle" | "ips" | "omop";

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

export default function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<ExportTab>("bundle");
  const [selectedResourceTypes, setSelectedResourceTypes] = useState<readonly MvpResourceType[]>(DEFAULT_RESOURCE_TYPES);
  const [includePatches, setIncludePatches] = useState(true);
  const [lookbackDays, setLookbackDays] = useState<number | null>(365);
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareAvailable, setShareAvailable] = useState(false);
  const [exportState, setExportState] = useState<ExportState | null>(null);
  const [omopState, setOmopState] = useState<{
    results: OmopTableResult[];
    resolved: number;
    unmatched: number;
    mapUnavailable: boolean;
  } | null>(null);

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

  // An export that a version reload interrupted would leave the user with
  // nothing: keep the update waiting while one is being built.
  useEffect(() => {
    if (!busy) return;
    return holdAppUpdate();
  }, [busy]);

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
      // The shown person's records when the Records page has published them
      // (the only option for an imported Bundle), else fetched from the portal.
      const loaded = analyticResources();
      const datasetResources =
        loaded ??
        (await (async () => {
          const token = await localVault.getJson<SmartToken>(key, { type: "smart-token", id: "current" });
          const session = await localVault.getJson<SmartSessionInfo>(key, { type: "smart-session", id: "current" });
          if (!token || !session) throw new Error("No local SMART connection is available");
          return (
            await fetchPatientDataset(session, token, {
              resourceTypes: selectedResourceTypes,
              maxPages: DEFAULT_FHIR_PAGE_LIMIT
            })
          ).resources;
        })());
      const selected = loaded
        ? datasetResources.filter((resource) => selectedResourceTypes.includes(resource.resourceType as MvpResourceType))
        : datasetResources;
      const filteredResources = filterResourcesByLookback(selected, lookbackDays);
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
        fetchedResourceCount: selected.length,
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

  async function buildIpsExport(mode: "json" | "print") {
    setBusy(true);
    setError(null);
    setStatus("Building International Patient Summary");
    try {
      const key = await getOrCreateSessionVaultKey();
      const ipsTypes = [
        "Patient",
        "MedicationRequest",
        "AllergyIntolerance",
        "Condition",
        "Observation",
        "Immunization",
        "Procedure",
        "DiagnosticReport"
      ];
      const loaded = analyticResources();
      const datasetResources =
        loaded ??
        (await (async () => {
          const token = await localVault.getJson<SmartToken>(key, { type: "smart-token", id: "current" });
          const session = await localVault.getJson<SmartSessionInfo>(key, { type: "smart-session", id: "current" });
          if (!token || !session) throw new Error("No local SMART connection is available");
          return (
            await fetchPatientDataset(session, token, {
              resourceTypes: ipsTypes as MvpResourceType[],
              maxPages: DEFAULT_FHIR_PAGE_LIMIT
            })
          ).resources;
        })());
      const selected = loaded ? datasetResources.filter((resource) => ipsTypes.includes(resource.resourceType)) : datasetResources;
      const resources = filterResourcesByLookback(selected, lookbackDays);
      const bundle = buildIpsBundle(resources, { authorLabel: "fhir4px" });

      if (mode === "print") {
        printIpsHtml(bundle);
      } else {
        const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/fhir+json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `ips-${new Date().toISOString().slice(0, 10)}.json`;
        anchor.click();
        globalThis.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setStatus(
        `International Patient Summary built — ${resources.length} resources, ${
          (bundle.entry as unknown[]).length
        } bundle entries`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not build the International Patient Summary");
    } finally {
      setBusy(false);
    }
  }

  async function buildOmopExport() {
    setBusy(true);
    setError(null);
    setOmopState(null);
    try {
      setStatus("OMOP: loading patient data into the engine…");
      const resources = await loadAnalyticResources();
      await engineLoadResources(resources);

      setStatus("OMOP: resolving concepts against the terminology server…");
      const distinct = extractDistinctCodes(resources);
      const resolution = await resolveOmopConcepts(distinct, {
        onProgress: (done, total) => setStatus(`OMOP: resolving concepts… ${done}/${total}`)
      });

      setStatus("OMOP: extracting CDM tables via the fhir4ds view engine…");
      const outcome = await runOmopExport(resources, resolution);
      const okTables = outcome.results.filter((result) => !result.error).length;
      setOmopState({
        results: outcome.results,
        resolved: outcome.resolved,
        unmatched: outcome.unmatched,
        mapUnavailable: outcome.mapUnavailable
      });
      setStatus(
        `OMOP export ready — ${okTables}/${outcome.results.length} tables (fhir4ds ViewDefinition libraries), ` +
          `${outcome.resolved}/${distinct.length} concepts resolved` +
          (outcome.mapUnavailable ? " (athena map unavailable — concept_id 0)" : "")
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "OMOP export failed");
    } finally {
      setBusy(false);
    }
  }

  function downloadOmopCsv(table: { id: string }, csv: string) {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `omop_${table.id.replace("-omop", "")}.csv`;
    anchor.click();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  return (
    <Dialog
      open={open}
      maxWidth="md"
      fullWidth
      onClose={(_event, reason) => {
        // A running job must not be dismissed by a stray click.
        if (busy) return;
        if (reason === "backdropClick" || reason === "escapeKeyDown") return;
        onClose();
      }}
      PaperProps={{ sx: { maxHeight: "85vh" } }}
    >
      <DialogTitle sx={{ pb: 0 }}>
        <Typography variant="h6" component="div" fontWeight={700}>
          Export
        </Typography>
        <Tabs value={tab} onChange={(_event, next: ExportTab) => setTab(next)} variant="fullWidth" sx={{ mt: 1 }}>
          <Tab value="bundle" label="Bundle" />
          <Tab value="ips" label="IPS" />
          <Tab value="omop" label="OMOP" />
        </Tabs>
      </DialogTitle>

      <DialogContent dividers>
        <Stack spacing={2}>
          {busy && <LinearProgress />}
          {error && <Alert severity="error">{error}</Alert>}

          {tab === "bundle" && (
            <Stack spacing={2}>
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
                sx={{ alignSelf: "flex-start" }}
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
                    <Chip
                      label={`${exportState.qrBytes} QR bytes`}
                      color={exportState.qrDataUrl ? "success" : "warning"}
                    />
                  </Stack>

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
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
                  </Stack>

                  <Alert severity="warning">
                    Decryption key:{" "}
                    <Box component="code" sx={{ wordBreak: "break-all" }}>
                      {exportState.decryptionKey}
                    </Box>
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
            </Stack>
          )}

          {tab === "ips" && (
            <Stack spacing={1}>
              <Typography fontWeight={700}>International Patient Summary</Typography>
              <Typography color="text.secondary" variant="body2">
                Standards-based summary document (IPS R4): medications, allergies, problem list, procedures,
                immunizations, and results. Uses the date range chosen in Bundle.
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button
                  variant="outlined"
                  startIcon={<Download size={18} />}
                  onClick={() => void buildIpsExport("json")}
                  disabled={busy}
                >
                  Download IPS JSON
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<FileText size={18} />}
                  onClick={() => void buildIpsExport("print")}
                  disabled={busy}
                >
                  Print IPS (PDF)
                </Button>
              </Stack>
            </Stack>
          )}

          {tab === "omop" && (
            <Stack spacing={1}>
              <Typography fontWeight={700}>OMOP CDM export</Typography>
              <Typography color="text.secondary" variant="body2">
                OMOP CDM v5.5 tables extracted locally. Concepts resolve in batch against the medterm4ds
                terminology server (cached in the browser); unmapped codes keep OMOP concept_id 0 with source
                values preserved.
              </Typography>
              <Button
                variant="outlined"
                startIcon={<Database size={18} />}
                onClick={() => void buildOmopExport()}
                disabled={busy}
                sx={{ alignSelf: "flex-start" }}
              >
                Build OMOP export
              </Button>
              {omopState && (
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Chip
                      label={`${omopState.resolved} concepts resolved`}
                      color={omopState.resolved > 0 ? "success" : "default"}
                    />
                    {omopState.unmatched > 0 && (
                      <Chip label={`${omopState.unmatched} unmapped → concept_id 0`} variant="outlined" />
                    )}
                    {omopState.mapUnavailable && (
                      <Chip label="athena map unavailable on server" color="warning" variant="outlined" />
                    )}
                  </Stack>
                  {omopState.results.map((entry) => (
                    <Stack key={entry.id} direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ minWidth: 180 }}>
                        {entry.id.replace("-omop", "")}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                        {entry.error ?? `${entry.rows.length} rows`}
                      </Typography>
                      {!entry.error && entry.rows.length > 0 && (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<Download size={14} />}
                          onClick={() => downloadOmopCsv(entry, omopResultToCsv(entry))}
                        >
                          CSV
                        </Button>
                      )}
                    </Stack>
                  ))}
                </Stack>
              )}
            </Stack>
          )}

        </Stack>
      </DialogContent>

      <DialogActions sx={{ justifyContent: "space-between", gap: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          {busy && <CircularProgress size={14} />}
          <Typography variant="caption" color="text.secondary" noWrap title={status}>
            {status}
          </Typography>
        </Stack>
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
