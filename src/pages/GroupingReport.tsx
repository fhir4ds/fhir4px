import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { Database, RefreshCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildReferralSummary } from "../lib/fhir/normalize";
import {
  loadPatientFriendlyLookupForRecords,
  lookupPatientFriendlyName,
  type PatientFriendlyLookupResult
} from "../lib/fhir/patient-friendly-lookup";
import {
  buildGroupableRecords,
  compactRecordsForModel,
  deterministicPatientGrouping,
  expandCompactGrouping,
  validateGroupingResult,
  type GroupableRecord,
  type GroupableResourceType,
  type PatientFriendlyGroup,
  type PatientGroupingResult
} from "../lib/fhir/patient-groups";
import {
  browserCanAttemptWebLlm,
  groupWithWebLlmIncremental,
  DEFAULT_WEBLLM_MODEL_PREFERENCE,
  WEBLLM_GROUPING_CUSTOM_MODEL,
  WEBLLM_GROUPING_FALLBACK_MODEL,
  WEBLLM_GROUPING_MODEL,
  type WebLlmModelPreference
} from "../lib/llm/webllm";
import {
  DEFAULT_FHIR_PAGE_LIMIT,
  DEFAULT_REFERENCE_FETCH_LIMIT,
  fetchPatientDataset,
  type FhirDataset
} from "../lib/smart/data";
import { EXPANDED_CLINICAL_SCOPES } from "../lib/smart/scopes";

const SMART_DEV_SANDBOX_BASE_URL =
  import.meta.env.VITE_SMART_DEV_SANDBOX_BASE_URL ||
  "http://localhost:4004/hapi-fhir-jpaserver/fhir";
const SMART_DEV_SANDBOX_PATIENT_ID =
  import.meta.env.VITE_SMART_DEV_SANDBOX_REPORT_PATIENT_ID ||
  "fhir4px-large-sandbox-patient";
const JORDAN_FIXTURE_URL = "/tests/fixtures/fhir/large-patient-r4.json";

const RESOURCE_TYPES: GroupableResourceType[] = ["MedicationRequest", "Condition", "Observation", "Immunization"];
type ReportSource = "jordan-fixture" | "smart-dev-sandbox";
type ReportMode = "lookup-seeded-model" | "model-only" | "lookup-only";
type LocalGroupingMode = "one-b-batch" | "one-b-single" | "three-b-batch" | "custom-single";

const REPORT_MODE_OPTIONS: Array<{ value: ReportMode; label: string }> = [
  { value: "lookup-seeded-model", label: "Lookup seeded model" },
  { value: "model-only", label: "Model only" },
  { value: "lookup-only", label: "Lookup only" }
];

const LOCAL_GROUPING_MODE_OPTIONS: Array<{ value: LocalGroupingMode; label: string }> = [
  { value: "one-b-batch", label: "1B batch" },
  { value: "one-b-single", label: "1B single" },
  { value: "three-b-batch", label: "3B batch" },
  { value: "custom-single", label: "Custom single" }
];

function localGroupingModelId(mode: LocalGroupingMode): string {
  if (mode === "custom-single") return WEBLLM_GROUPING_CUSTOM_MODEL;
  return mode === "three-b-batch" ? WEBLLM_GROUPING_FALLBACK_MODEL : WEBLLM_GROUPING_MODEL;
}

function localGroupingModelPreference(mode: LocalGroupingMode): WebLlmModelPreference {
  if (mode === "custom-single") return "custom";
  return mode === "three-b-batch" ? "three-b" : "one-b";
}

function defaultLocalGroupingMode(): LocalGroupingMode {
  if (DEFAULT_WEBLLM_MODEL_PREFERENCE === "custom") return "custom-single";
  if (DEFAULT_WEBLLM_MODEL_PREFERENCE === "three-b") return "three-b-batch";
  return "one-b-batch";
}

function localGroupingBatchSize(mode: LocalGroupingMode): number {
  return mode === "one-b-single" || mode === "custom-single" ? 1 : 3;
}

function localGroupingNamingMode(mode: LocalGroupingMode): "batch" | "single" {
  return mode === "one-b-single" || mode === "custom-single" ? "single" : "batch";
}

interface GroupingReportSection {
  resourceType: GroupableResourceType;
  inputCount: number;
  inputRecords: GroupableRecord[];
  compactInputCount: number;
  compactInputRecords: GroupableRecord[];
  lookupHitCount: number;
  lookupHits: Array<{ compactRecordId: string; result: PatientFriendlyLookupResult }>;
  modelInputCount: number;
  deterministic: PatientGroupingResult;
  deterministicCompact: PatientGroupingResult;
  lookupOnly?: PatientGroupingResult;
  modelOutput?: unknown;
  validatedCompact?: PatientGroupingResult;
  validated?: PatientGroupingResult;
  final?: PatientGroupingResult;
  error?: string;
}

interface GroupingReportResult {
  generatedAt: string;
  model: string;
  mode: ReportMode;
  source: ReportSource;
  fhirBaseUrl: string;
  patientId: string;
  referenceResolution?: FhirDataset["referenceResolution"];
  sections: GroupingReportSection[];
}

declare global {
  interface Window {
    __FHIR4PX_GROUPING_REPORT__?: GroupingReportResult;
  }
}

function sectionRecords(records: GroupableRecord[], resourceType: GroupableResourceType): GroupableRecord[] {
  return records.filter((record) => record.resourceType === resourceType && !record.hidden);
}

function reportPreview(report: GroupingReportResult | null): string {
  return report ? JSON.stringify(report, null, 2) : "No report generated yet.";
}

function lookupGrouping(compactRecords: GroupableRecord[], lookupHits: GroupingReportSection["lookupHits"]): PatientGroupingResult {
  const recordsById = new Map(compactRecords.map((record) => [record.id, record]));
  const grouped = new Map<string, PatientFriendlyGroup>();

  for (const { compactRecordId, result } of lookupHits) {
    const record = recordsById.get(compactRecordId);
    if (!record) continue;
    const groupKey = `${record.resourceType}:${result.patientFriendlyName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    const groupId = `${record.resourceType.toLowerCase()}-lookup-${result.patientFriendlyName}`.replace(/[^a-zA-Z0-9-]+/g, "-");
    const existing = grouped.get(groupKey);
    if (existing) {
      existing.resourceIds.push(compactRecordId);
      existing.confidence = Math.min(existing.confidence, result.confidence);
      existing.fallback = existing.fallback || result.fallback;
      continue;
    }

    grouped.set(groupKey, {
      groupId,
      patientFriendlyName: result.patientFriendlyName,
      resourceIds: [compactRecordId],
      resourceTypes: [record.resourceType],
      observationBucket:
        record.resourceType === "Observation"
          ? record.categoryCode === "vital-signs"
            ? "vitals"
            : record.categoryCode === "laboratory"
              ? "labs"
              : "other"
          : undefined,
      confidence: result.confidence,
      reason: `Lookup ${result.system}:${result.code} (${result.matchType}, ${result.friendlySource}).`,
      fallback: result.fallback
    });
  }

  const assigned = new Set([...grouped.values()].flatMap((group) => group.resourceIds));
  const fallback = deterministicPatientGrouping(compactRecords.filter((record) => !assigned.has(record.id)));
  return {
    groups: [...grouped.values(), ...fallback.groups],
    unassigned: fallback.unassigned,
    source: grouped.size && fallback.groups.length ? "mixed" : grouped.size ? "lookup" : "deterministic"
  };
}

export function GroupingReport() {
  const didAutorun = useRef(false);
  const [busy, setBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState<string | null>(null);
  const [dataset, setDataset] = useState<FhirDataset | null>(null);
  const [records, setRecords] = useState<GroupableRecord[]>([]);
  const [report, setReport] = useState<GroupingReportResult | null>(null);
  const [reportMode, setReportMode] = useState<ReportMode>("lookup-seeded-model");
  const [localGroupingMode, setLocalGroupingMode] = useState<LocalGroupingMode>(defaultLocalGroupingMode());
  const [loadedSource, setLoadedSource] = useState<ReportSource>("jordan-fixture");

  const counts = useMemo(
    () =>
      Object.fromEntries(
        RESOURCE_TYPES.map((resourceType) => [resourceType, sectionRecords(records, resourceType).length])
      ) as Record<GroupableResourceType, number>,
    [records]
  );

  async function loadSandboxData(): Promise<{ nextDataset: FhirDataset; nextRecords: GroupableRecord[] }> {
    setBusy(true);
    setError(null);
    setStatus("Fetching local SMART Dev Sandbox data");
    try {
      const nextDataset = await fetchPatientDataset(
        { fhirBaseUrl: SMART_DEV_SANDBOX_BASE_URL, vendor: "unknown", clientId: "local-grouping-report" },
        {
          accessToken: "local-sandbox",
          tokenType: "Bearer",
          expiresAt: Date.now() + 60_000,
          patientId: SMART_DEV_SANDBOX_PATIENT_ID,
          scope: EXPANDED_CLINICAL_SCOPES
        },
        {
          resourceTypes: [
            "Patient",
            "MedicationRequest",
            "AllergyIntolerance",
            "Condition",
            "Observation",
            "DiagnosticReport",
            "Encounter",
            "Procedure",
            "Immunization"
          ],
          maxPages: DEFAULT_FHIR_PAGE_LIMIT,
          resolveReferences: true,
          maxReferenceFetches: DEFAULT_REFERENCE_FETCH_LIMIT
        }
      );
      const summary = buildReferralSummary(nextDataset.resources);
      const nextRecords = buildGroupableRecords(summary);
      setDataset(nextDataset);
      setRecords(nextRecords);
      setReport(null);
      setLoadedSource("smart-dev-sandbox");
      setStatus("Sandbox records loaded");
      return { nextDataset, nextRecords };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to load sandbox records";
      setError(message);
      setStatus("Load failed");
      throw caught;
      } finally {
      setBusy(false);
    }
  }

  async function loadJordanFixture(): Promise<{ nextDataset: FhirDataset; nextRecords: GroupableRecord[] }> {
    setBusy(true);
    setError(null);
    setStatus("Loading Jordan Longitudinal fixture");
    try {
      const response = await fetch(JORDAN_FIXTURE_URL, { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to load ${JORDAN_FIXTURE_URL} (${response.status})`);
      const bundle = (await response.json()) as { entry?: Array<{ resource?: FhirDataset["resources"][number] }> };
      const resources = (bundle.entry ?? []).flatMap((entry) => (entry.resource ? [entry.resource] : []));
      const patient = resources.find((resource) => resource.resourceType === "Patient");
      if (!patient) throw new Error("Jordan fixture did not include a Patient resource");
      const nextDataset: FhirDataset = {
        patient,
        resources,
        fetchedAt: Date.now(),
        vendor: "unknown"
      };
      const summary = buildReferralSummary(resources);
      const nextRecords = buildGroupableRecords(summary);
      setDataset(nextDataset);
      setRecords(nextRecords);
      setReport(null);
      setLoadedSource("jordan-fixture");
      setStatus("Jordan Longitudinal fixture loaded");
      return { nextDataset, nextRecords };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to load Jordan fixture";
      setError(message);
      setStatus("Load failed");
      throw caught;
    } finally {
      setBusy(false);
    }
  }

  async function runModelReport(nextRecords = records, nextDataset = dataset) {
    if (nextRecords.length === 0) return;
    setModelBusy(true);
    setError(null);
    const selectedModelId = localGroupingModelId(localGroupingMode);
    setStatus(`Running ${reportMode} grouping report with ${selectedModelId}`);

    const sections: GroupingReportSection[] = [];
    try {
      for (const resourceType of RESOURCE_TYPES) {
        const inputRecords = sectionRecords(nextRecords, resourceType);
        const compactInputRecords = compactRecordsForModel(inputRecords);
        const lookup = await loadPatientFriendlyLookupForRecords(compactInputRecords);
        const lookupHits = compactInputRecords.flatMap((record) => {
          const result = lookupPatientFriendlyName(record, lookup);
          return result && !result.needsModelFallback ? [{ compactRecordId: record.id, result }] : [];
        });
        const lookupOnly = lookupGrouping(compactInputRecords, lookupHits);
        const lookupNames = lookupHits.map((hit) => hit.result.patientFriendlyName);
        const modelInputRecords = reportMode === "lookup-only" ? [] : compactInputRecords;
        const deterministic = deterministicPatientGrouping(inputRecords);
        const deterministicCompact = deterministicPatientGrouping(compactInputRecords);
        const section: GroupingReportSection = {
          resourceType,
          inputCount: inputRecords.length,
          inputRecords,
          compactInputCount: compactInputRecords.length,
          compactInputRecords,
          lookupHitCount: lookupHits.length,
          lookupHits,
          modelInputCount: modelInputRecords.length,
          deterministic,
          deterministicCompact,
          lookupOnly
        };

        if (reportMode === "lookup-only") {
          section.final = expandCompactGrouping(compactInputRecords, lookupOnly);
        } else if (modelInputRecords.length > 0) {
          try {
            setStatus(`Grouping ${resourceType} (${inputRecords.length} records, ${modelInputRecords.length} clusters)`);
            const modelOutput = await groupWithWebLlmIncremental(modelInputRecords, {
              initialAvailableNames: reportMode === "lookup-seeded-model" ? lookupNames : [],
              modelPreference: localGroupingModelPreference(localGroupingMode),
              namingMode: localGroupingNamingMode(localGroupingMode),
              namingBatchSize: localGroupingBatchSize(localGroupingMode),
              onProgress: (message) => setStatus(message),
              onDiagnostic: (diagnostic) => {
                console.warn("[fhir4px:grouping-report]", {
                  resourceType,
                  reportMode,
                  localGroupingMode,
                  ...diagnostic
                });
              }
            });
            section.modelOutput = modelOutput;
            section.validatedCompact = validateGroupingResult(modelInputRecords, modelOutput, deterministicCompact);
            section.validated = expandCompactGrouping(modelInputRecords, section.validatedCompact);
            section.final = section.validated;
          } catch (caught) {
            section.error = caught instanceof Error ? caught.message : "Local model grouping failed";
            section.final = deterministic;
          }
        }

        sections.push(section);
      }

      const nextReport: GroupingReportResult = {
        generatedAt: new Date().toISOString(),
        model: selectedModelId,
        mode: reportMode,
        source: loadedSource,
        fhirBaseUrl: SMART_DEV_SANDBOX_BASE_URL,
        patientId: nextDataset?.patient.id ?? SMART_DEV_SANDBOX_PATIENT_ID,
        referenceResolution: nextDataset?.referenceResolution,
        sections
      };
      window.__FHIR4PX_GROUPING_REPORT__ = nextReport;
      setReport(nextReport);
      setStatus("Grouping report generated");
    } finally {
      setModelBusy(false);
    }
  }

  useEffect(() => {
    if (didAutorun.current || !new URLSearchParams(window.location.search).has("autorun")) return;
    didAutorun.current = true;
    const params = new URLSearchParams(window.location.search);
    const loader = params.get("source") === "sandbox" ? loadSandboxData : loadJordanFixture;
    void loader().then(({ nextDataset, nextRecords }) => runModelReport(nextRecords, nextDataset));
  }, []);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <Stack spacing={1}>
            <Typography variant="h2">Grouping Report</Typography>
            <Typography color="text.secondary">{status}</Typography>
          </Stack>

          {(busy || modelBusy) && <LinearProgress />}
          {error && <Alert severity="warning">{error}</Alert>}
          {!browserCanAttemptWebLlm() && (
            <Alert severity="info">
              WebGPU is not available in this browser context. You can still load the deterministic input report.
            </Alert>
          )}

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              variant="contained"
              startIcon={<Database size={18} />}
              onClick={() => void loadJordanFixture()}
              disabled={busy || modelBusy}
            >
              Load Jordan fixture
            </Button>
            <Button
              variant="outlined"
              startIcon={<Database size={18} />}
              onClick={() => void loadSandboxData()}
              disabled={busy || modelBusy}
            >
              Load sandbox records
            </Button>
            <TextField
              select
              size="small"
              label="Report mode"
              value={reportMode}
              onChange={(event) => setReportMode(event.target.value as ReportMode)}
              disabled={busy || modelBusy}
              sx={{ minWidth: 210 }}
            >
              {REPORT_MODE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Local model"
              value={localGroupingMode}
              onChange={(event) => setLocalGroupingMode(event.target.value as LocalGroupingMode)}
              disabled={busy || modelBusy || reportMode === "lookup-only"}
              sx={{ minWidth: 150 }}
            >
              {LOCAL_GROUPING_MODE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="outlined"
              startIcon={<RefreshCcw size={18} />}
              onClick={() => void runModelReport()}
              disabled={busy || modelBusy || records.length === 0}
            >
              Run model report
            </Button>
          </Stack>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {RESOURCE_TYPES.map((resourceType) => (
              <Chip key={resourceType} label={`${resourceType}: ${counts[resourceType]}`} />
            ))}
            {RESOURCE_TYPES.map((resourceType) => (
              <Chip
                key={`${resourceType}:clusters`}
                variant="outlined"
                label={`${resourceType} clusters: ${compactRecordsForModel(sectionRecords(records, resourceType)).length}`}
              />
            ))}
            {dataset?.referenceResolution && (
              <Chip label={`References fetched: ${dataset.referenceResolution.fetched}`} />
            )}
            {records.length > 0 && <Chip variant="outlined" label={`Source: ${loadedSource}`} />}
          </Stack>

          <Divider />

          <Box
            component="pre"
            sx={{
              m: 0,
              p: 2,
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              maxHeight: "65vh",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              fontSize: 12,
              lineHeight: 1.5
            }}
          >
            {reportPreview(report)}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
