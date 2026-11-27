/**
 * Import a Bundle file as a source. One file at a time: an encrypted fhir4px
 * export with its key, or a plain FHIR or IPS Bundle without one. The imported
 * records appear under "Received bundle · <file name>" and the app switches to
 * the patient they carry.
 */

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { Upload } from "lucide-react";
import { useState } from "react";
import { notifyLocalDataChanged } from "../lib/app/data-events";
import { readBundleFile, storeBundleSource } from "../lib/handoff/import-bundle";
import {
  emptyPatientIdentityRecord,
  withSelectedSourceId,
  PATIENT_IDENTITY_ID,
  type PatientIdentityRecord
} from "../lib/fhir/patient-identity";
import type { BundleSource } from "../lib/smart/sources";
import { getOrCreateSessionVaultKey } from "../lib/vault/keys";
import { localVault } from "../lib/vault/store";

export default function ImportRecordsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setKey("");
    setBusy(false);
    setError(null);
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const imported = await readBundleFile(file, { key });
      const vaultKey = await getOrCreateSessionVaultKey();
      const source: BundleSource = await storeBundleSource({ imported, key: vaultKey });
      // Show the patient that came with the file, not the one that was shown.
      const record =
        (await localVault.getJson<PatientIdentityRecord>(vaultKey, {
          type: "patient-identity",
          id: PATIENT_IDENTITY_ID
        })) ?? emptyPatientIdentityRecord();
      await localVault.putJson(
        vaultKey,
        { type: "patient-identity", id: PATIENT_IDENTITY_ID },
        withSelectedSourceId(record, source.id)
      );
      notifyLocalDataChanged();
      reset();
      onClose();
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof Error ? caught.message : "Could not import this file");
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return;
        reset();
        onClose();
      }}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Import records</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {busy && <LinearProgress />}
          <Typography variant="body2" color="text.secondary">
            An encrypted fhir4px export needs its decryption key. A plain FHIR or IPS Bundle imports without
            one. The records stay in this browser, under a source called{" "}
            <strong>Received bundle · the file name</strong>.
          </Typography>
          <Button component="label" variant="outlined" startIcon={<Upload size={18} />} sx={{ alignSelf: "flex-start" }}>
            {file ? file.name : "Choose a Bundle file"}
            <input
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Button>
          <TextField
            label="Decryption key"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            helperText="Only for an encrypted fhir4px export"
            fullWidth
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          disabled={busy}
          onClick={() => {
            reset();
            onClose();
          }}
        >
          Cancel
        </Button>
        <Button variant="contained" disabled={!file || busy} onClick={() => void submit()}>
          Import
        </Button>
      </DialogActions>
    </Dialog>
  );
}
