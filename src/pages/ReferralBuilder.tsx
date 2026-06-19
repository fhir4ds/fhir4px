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
import { Database, Save } from "lucide-react";
import { useState } from "react";
import type {
  DisplayAllergy,
  DisplayCondition,
  DisplayMedication,
  DisplayObservation,
  ReferralSummary
} from "../lib/fhir/types";
import { buildReferralSummary } from "../lib/fhir/normalize";
import { createPatientPatch, type PatientPatch, type PatchTargetResource } from "../lib/fhir/patches";
import { DEFAULT_FHIR_PAGE_LIMIT, fetchPatientDataset } from "../lib/smart/data";
import type { SmartSessionInfo, SmartToken } from "../lib/smart/types";
import { getOrCreateSessionVaultKey } from "../lib/vault/keys";
import { localVault } from "../lib/vault/store";

const MEDICATION_STATUS_OPTIONS = ["Taking", "Not taking", "Taking differently", "Unsure"] as const;

const PATCH_FIELD_LABELS: Record<string, string> = {
  patientMedicationStatus: "Medication status",
  patientMedicationNote: "Medication note",
  patientAllergyCorrection: "Allergy correction",
  patientConditionNote: "Condition note"
};

type Drafts = Record<string, string>;

function draftKey(targetResourceType: PatchTargetResource, targetResourceId: string, field: string): string {
  return `${targetResourceType}:${targetResourceId}:${field}`;
}

export function ReferralBuilder() {
  const [status, setStatus] = useState<string>("Ready");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [patches, setPatches] = useState<PatientPatch[]>([]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [error, setError] = useState<string | null>(null);

  function updateDraft(key: string, value: string): void {
    setDrafts((current) => ({ ...current, [key]: value }));
  }

  function clearDrafts(keys: string[]): void {
    setDrafts((current) => {
      const next = { ...current };
      for (const key of keys) delete next[key];
      return next;
    });
  }

  function patchesFor(targetResourceType: PatchTargetResource, targetResourceId: string): PatientPatch[] {
    return patches.filter(
      (patch) => patch.targetResourceType === targetResourceType && patch.targetResourceId === targetResourceId
    );
  }

  async function fetchSummary() {
    setError(null);
    setBusy(true);
    setStatus("Fetching directly from source FHIR server");
    try {
      const key = await getOrCreateSessionVaultKey();
      const token = await localVault.getJson<SmartToken>(key, { type: "smart-token", id: "current" });
      const session = await localVault.getJson<SmartSessionInfo>(key, { type: "smart-session", id: "current" });
      if (!token || !session) throw new Error("No local SMART connection is available");

      const dataset = await fetchPatientDataset(session, token, {
        resourceTypes: ["Patient", "MedicationRequest", "AllergyIntolerance", "Condition", "Observation"],
        maxPages: DEFAULT_FHIR_PAGE_LIMIT
      });
      const summary = buildReferralSummary(dataset.resources);
      const storedPatches = await localVault.listJson<PatientPatch>(key, "patient-patch");
      setSummary(summary);
      setPatches(storedPatches);
      setStatus("Summary fetched in browser");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "FHIR fetch failed");
      setStatus("Fetch failed");
    } finally {
      setBusy(false);
    }
  }

  async function savePatch(input: {
    targetResourceType: PatchTargetResource;
    targetResourceId: string;
    field: string;
    value: string;
    note?: string;
    clearKeys: string[];
  }) {
    const value = input.value.trim();
    const note = input.note?.trim();
    if (!value) return;

    setError(null);
    try {
      const key = await getOrCreateSessionVaultKey();
      const patch = createPatientPatch({
        targetResourceType: input.targetResourceType,
        targetResourceId: input.targetResourceId,
        field: input.field,
        value,
        note: note || undefined
      });
      await localVault.putJson(key, { type: "patient-patch", id: patch.id }, patch);
      setPatches((current) => [patch, ...current]);
      clearDrafts(input.clearKeys);
      setStatus("Patient correction saved locally");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save patient correction");
    }
  }

  function renderPatchList(targetPatches: PatientPatch[]) {
    if (targetPatches.length === 0) {
      return <Typography color="text.secondary">No patient correction saved</Typography>;
    }

    return (
      <Stack spacing={1}>
        {targetPatches.map((patch) => (
          <Box key={patch.id} sx={{ borderLeft: 3, borderColor: "secondary.main", pl: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Chip size="small" color="secondary" label={PATCH_FIELD_LABELS[patch.field] ?? patch.field} />
              <Typography variant="caption" color="text.secondary">
                {new Date(patch.authoredAt).toLocaleString()}
              </Typography>
            </Stack>
            <Typography>{patch.value}</Typography>
            {patch.note && <Typography color="text.secondary">{patch.note}</Typography>}
          </Box>
        ))}
      </Stack>
    );
  }

  function renderMedication(medication: DisplayMedication) {
    const targetResourceType = "MedicationRequest";
    const statusKey = draftKey(targetResourceType, medication.id, "status");
    const noteKey = draftKey(targetResourceType, medication.id, "note");
    const selectedStatus = drafts[statusKey] ?? "";
    const note = drafts[noteKey] ?? "";
    const saveValue = selectedStatus || note;

    return (
      <Box key={medication.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) minmax(280px, 0.9fr)" },
            gap: 2
          }}
        >
          <Stack spacing={0.5} minWidth={0}>
            <Typography fontWeight={700}>{medication.label}</Typography>
            <Typography color="text.secondary">Provider status: {medication.status}</Typography>
          </Stack>
          <Stack spacing={1.5}>
            {renderPatchList(patchesFor(targetResourceType, medication.id))}
            <TextField
              select
              label="Patient status"
              value={selectedStatus}
              onChange={(event) => updateDraft(statusKey, event.target.value)}
              size="small"
              fullWidth
            >
              <MenuItem value="">No status change</MenuItem>
              {MEDICATION_STATUS_OPTIONS.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Patient note"
              value={note}
              onChange={(event) => updateDraft(noteKey, event.target.value)}
              size="small"
              multiline
              minRows={2}
              fullWidth
            />
            <Button
              variant="outlined"
              startIcon={<Save size={18} />}
              disabled={!saveValue.trim()}
              onClick={() =>
                void savePatch({
                  targetResourceType,
                  targetResourceId: medication.id,
                  field: selectedStatus ? "patientMedicationStatus" : "patientMedicationNote",
                  value: saveValue,
                  note,
                  clearKeys: [statusKey, noteKey]
                })
              }
            >
              Save correction
            </Button>
          </Stack>
        </Box>
      </Box>
    );
  }

  function renderAllergy(allergy: DisplayAllergy) {
    const targetResourceType = "AllergyIntolerance";
    const noteKey = draftKey(targetResourceType, allergy.id, "correction");
    const note = drafts[noteKey] ?? "";

    return (
      <Box key={allergy.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) minmax(280px, 0.9fr)" },
            gap: 2
          }}
        >
          <Stack spacing={0.5} minWidth={0}>
            <Typography fontWeight={700}>{allergy.label}</Typography>
            <Typography color="text.secondary">
              Provider criticality: {allergy.criticality || "not recorded"}
            </Typography>
          </Stack>
          <Stack spacing={1.5}>
            {renderPatchList(patchesFor(targetResourceType, allergy.id))}
            <TextField
              label="Patient correction"
              value={note}
              onChange={(event) => updateDraft(noteKey, event.target.value)}
              size="small"
              multiline
              minRows={2}
              fullWidth
            />
            <Button
              variant="outlined"
              startIcon={<Save size={18} />}
              disabled={!note.trim()}
              onClick={() =>
                void savePatch({
                  targetResourceType,
                  targetResourceId: allergy.id,
                  field: "patientAllergyCorrection",
                  value: note,
                  clearKeys: [noteKey]
                })
              }
            >
              Save correction
            </Button>
          </Stack>
        </Box>
      </Box>
    );
  }

  function renderCondition(condition: DisplayCondition) {
    const targetResourceType = "Condition";
    const noteKey = draftKey(targetResourceType, condition.id, "note");
    const note = drafts[noteKey] ?? "";

    return (
      <Box key={condition.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) minmax(280px, 0.9fr)" },
            gap: 2
          }}
        >
          <Stack spacing={0.5} minWidth={0}>
            <Typography fontWeight={700}>{condition.label}</Typography>
            <Typography color="text.secondary">
              Provider clinical status: {condition.clinicalStatus || "not recorded"}
            </Typography>
          </Stack>
          <Stack spacing={1.5}>
            {renderPatchList(patchesFor(targetResourceType, condition.id))}
            <TextField
              label="Patient note"
              value={note}
              onChange={(event) => updateDraft(noteKey, event.target.value)}
              size="small"
              multiline
              minRows={2}
              fullWidth
            />
            <Button
              variant="outlined"
              startIcon={<Save size={18} />}
              disabled={!note.trim()}
              onClick={() =>
                void savePatch({
                  targetResourceType,
                  targetResourceId: condition.id,
                  field: "patientConditionNote",
                  value: note,
                  clearKeys: [noteKey]
                })
              }
            >
              Save note
            </Button>
          </Stack>
        </Box>
      </Box>
    );
  }

  function renderObservation(observation: DisplayObservation) {
    const range = observation.referenceRange;
    const rangeText =
      range?.text ??
      (range?.low !== undefined || range?.high !== undefined
        ? `${range?.low ?? "—"}–${range?.high ?? "—"}${range?.unit ? ` ${range.unit}` : ""}`
        : undefined);
    return (
      <Box key={observation.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}>
        <Stack spacing={1}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1} justifyContent="space-between">
            <Stack spacing={0.5} minWidth={0}>
              <Typography fontWeight={700}>{observation.label}</Typography>
              <Typography color="text.secondary">Provider value: {observation.value}</Typography>
              {rangeText && (
                <Typography variant="caption" color="text.secondary">
                  Reference range: {rangeText}
                </Typography>
              )}
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {observation.category && <Chip size="small" label={observation.category} />}
              <Chip size="small" label={observation.status} variant="outlined" />
              {observation.interpretation && (
                <Chip size="small" color="warning" label={observation.interpretation} />
              )}
            </Stack>
          </Stack>
          {observation.effectiveDate && (
            <Typography variant="caption" color="text.secondary">
              {new Date(observation.effectiveDate).toLocaleString()}
            </Typography>
          )}
        </Stack>
      </Box>
    );
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <Typography variant="h2">Referral summary</Typography>
          <Typography color="text.secondary">{status}</Typography>
          {busy && <LinearProgress />}
          {error && <Alert severity="error">{error}</Alert>}
          <Button
            variant="contained"
            startIcon={<Database size={18} />}
            onClick={() => void fetchSummary()}
            disabled={busy}
          >
            Fetch source data
          </Button>
          {summary && (
            <Stack spacing={3}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={`${summary.medications.length} medications`} />
                <Chip label={`${summary.allergies.length} allergies`} />
                <Chip label={`${summary.conditions.length} conditions`} />
                <Chip label={`${summary.observations.length} observations`} />
                <Chip label={`${patches.length} patient corrections`} color={patches.length ? "secondary" : "default"} />
              </Stack>

              <Divider />

              <Stack spacing={2}>
                <Typography variant="h3">Medications</Typography>
                {summary.medications.length ? (
                  summary.medications.map(renderMedication)
                ) : (
                  <Typography color="text.secondary">No medications returned from the source FHIR server</Typography>
                )}
              </Stack>

              <Stack spacing={2}>
                <Typography variant="h3">Allergies</Typography>
                {summary.allergies.length ? (
                  summary.allergies.map(renderAllergy)
                ) : (
                  <Typography color="text.secondary">No allergies returned from the source FHIR server</Typography>
                )}
              </Stack>

              <Stack spacing={2}>
                <Typography variant="h3">Conditions</Typography>
                {summary.conditions.length ? (
                  summary.conditions.map(renderCondition)
                ) : (
                  <Typography color="text.secondary">No conditions returned from the source FHIR server</Typography>
                )}
              </Stack>

              <Stack spacing={2}>
                <Typography variant="h3">Labs and observations</Typography>
                {summary.observations.length ? (
                  summary.observations.slice(0, 25).map(renderObservation)
                ) : (
                  <Typography color="text.secondary">No observations returned from the source FHIR server</Typography>
                )}
                {summary.observations.length > 25 && (
                  <Alert severity="info">
                    Showing the 25 most recent observations. Use encrypted export for the full selected set.
                  </Alert>
                )}
              </Stack>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
