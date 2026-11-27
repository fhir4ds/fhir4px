/**
 * Connection menu — the popover and its confirmations, shared by every
 * connection control: the header's connection chip and the top-bar pill on
 * pages without one. It lists the portals with their own refresh and delete
 * actions, a one-line US Core data summary that opens the full table, the
 * state of the duplicate check, Add portal, and Clear local data for every
 * portal at once. Choosing which patient is shown belongs to the header, not
 * here.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link as MuiLink,
  MenuItem,
  Popover,
  Select,
  Stack,
  Typography
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  dispatchRecordsPageCommand,
  getConnectionStatus,
  subscribeConnectionStatus,
  type ConnectionStatusSource,
  type ConnectionStatusState
} from "../lib/app/connection-status";
import { clearAllLocalData } from "../lib/vault/clear-local";
import { deleteSourceData } from "../lib/vault/delete-source";
import { summarizeUsCore, usCoreSummaryText } from "../lib/fhir/uscore-summary";
import DuplicateRecordsTable from "./DuplicateRecordsTable";
import UsCoreDataTable from "./UsCoreDataTable";

interface ConnectionMenuProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

export default function ConnectionMenu({ open, anchorEl, onClose }: ConnectionMenuProps) {
  const [status, setStatus] = useState<ConnectionStatusState>(getConnectionStatus);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [usCoreOpen, setUsCoreOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [sourceToDelete, setSourceToDelete] = useState<ConnectionStatusSource | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => subscribeConnectionStatus(setStatus), []);

  const working = status.phase === "loading" || status.phase === "evaluating";
  const usCore = status.usCore && status.usCore.length > 0 ? status.usCore : null;
  const usCoreLine = useMemo(() => (usCore ? usCoreSummaryText(summarizeUsCore(usCore)) : null), [usCore]);
  const patientMatch = status.recordChecks?.patientMatch ?? null;
  const matchLine = !patientMatch
    ? null
    : patientMatch.state === "running"
      ? "checking…"
      : patientMatch.state === "failed"
        ? "check unavailable"
        : patientMatch.verdict === "same"
          ? "these portals look like one person"
          : patientMatch.verdict === "different"
            ? "these portals look like different people"
            : patientMatch.verdict === "unconfirmed"
              ? "could not confirm these portals are one person"
              : null;
  const placements = status.patientPlacements ?? null;
  const dedupCheck = status.recordChecks?.dedup ?? null;
  const duplicates = dedupCheck?.state === "done" ? dedupCheck.duplicates ?? null : null;
  const duplicateCopies = duplicates?.copies ?? dedupCheck?.merged ?? 0;
  const duplicateLine = !dedupCheck
    ? null
    : dedupCheck.state === "running"
      ? "checking…"
      : dedupCheck.state === "failed"
        ? "check unavailable"
        : duplicateCopies > 0
          ? duplicates
            ? `${duplicateCopies} ${duplicateCopies === 1 ? "copy" : "copies"} in ${duplicates.groups.length} ${
                duplicates.groups.length === 1 ? "group" : "groups"
              }`
            : `${duplicateCopies} ${duplicateCopies === 1 ? "copy" : "copies"} of other records merged`
          : "none found";

  return (
    <>
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={onClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { width: 380, p: 2 } } }}
      >
        <Stack spacing={1.5}>
          <Stack spacing={0.25}>
            <Typography fontWeight={700}>{status.label}</Typography>
            {status.detail && (
              <Typography variant="caption" color="text.secondary">
                {status.detail}
              </Typography>
            )}
          </Stack>

          {working && <CircularProgress size={18} sx={{ alignSelf: "flex-start" }} />}

          {status.sources.length > 0 && (
            <>
              <Divider />
              <Stack spacing={1.25}>
                {status.sources.map((source) => (
                  <Stack key={source.id} spacing={0.25}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                      <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                        {source.label}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ flex: "0 0 auto" }}>
                        {source.recordCount !== undefined ? `${source.recordCount.toLocaleString()} records · ` : ""}
                        {source.status}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.5}>
                      <Button
                        size="small"
                        startIcon={<RefreshCw size={14} />}
                        onClick={() => {
                          onClose();
                          dispatchRecordsPageCommand({ kind: "refreshSource", sourceId: source.id });
                        }}
                        sx={{ textTransform: "none" }}
                      >
                        Refresh
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<Trash2 size={14} />}
                        onClick={() => {
                          onClose();
                          setDeleteError(null);
                          setSourceToDelete(source);
                        }}
                        sx={{ textTransform: "none" }}
                      >
                        Delete
                      </Button>
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            </>
          )}

          {matchLine && (
            <>
              <Divider />
              <Stack spacing={0.25}>
                <Typography variant="body2" color={patientMatch?.verdict === "same" ? "text.primary" : "warning.main"}>
                  Patient matching: {matchLine}
                </Typography>
                {patientMatch?.verdict !== undefined && patientMatch.verdict !== null && patientMatch.verdict !== "same" && (
                  <Typography variant="caption" color="text.secondary">
                    Set a portal's person below if that is wrong.
                  </Typography>
                )}
              </Stack>
            </>
          )}

          {placements && status.sources.length > 1 && (
            <>
              <Divider />
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  Which person each portal belongs to
                </Typography>
                {status.sources.map((source) => {
                  const placement = placements[source.id];
                  const value =
                    placement === undefined || placement.kind === "auto"
                      ? "auto"
                      : placement.kind === "alone"
                        ? "alone"
                        : placement.sourceId;
                  return (
                    <Stack key={source.id} spacing={0.25}>
                      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                        {source.label}
                      </Typography>
                      <Select
                        size="small"
                        displayEmpty
                        value={value}
                        onChange={(event) => {
                          const next = String(event.target.value);
                          dispatchRecordsPageCommand({
                            kind: "setPatientIdentity",
                            sourceId: source.id,
                            placement:
                              next === "auto"
                                ? { kind: "auto" }
                                : next === "alone"
                                  ? { kind: "alone" }
                                  : { kind: "sameAs", sourceId: next }
                          });
                        }}
                        inputProps={{ "aria-label": `Person for ${source.label}` }}
                        sx={{ maxWidth: 300 }}
                      >
                        <MenuItem value="auto">Automatic (as matched)</MenuItem>
                        <MenuItem value="alone">This portal only</MenuItem>
                        {status.sources
                          .filter((other) => other.id !== source.id)
                          .map((other) => (
                            <MenuItem key={other.id} value={other.id}>
                              Same person as {other.label}
                            </MenuItem>
                          ))}
                      </Select>
                    </Stack>
                  );
                })}
              </Stack>
            </>
          )}

          {usCore && (
            <>
              <Divider />
              <Button
                size="small"
                aria-label="US Core data presence"
                onClick={() => {
                  onClose();
                  setUsCoreOpen(true);
                }}
                sx={{ textTransform: "none", justifyContent: "flex-start", px: 0, color: "text.primary" }}
              >
                US Core data: {usCoreLine}
              </Button>
            </>
          )}

          {duplicateLine && (
            <>
              <Divider />
              {duplicates && duplicates.copies > 0 ? (
                <Button
                  size="small"
                  aria-label="Duplicate records"
                  onClick={() => {
                    onClose();
                    setDuplicatesOpen(true);
                  }}
                  sx={{ textTransform: "none", justifyContent: "flex-start", px: 0, color: "text.primary" }}
                >
                  Duplicate records: {duplicateLine}
                </Button>
              ) : (
                <Typography variant="body2">Duplicate records (fhir4ds): {duplicateLine}</Typography>
              )}
              {duplicates && duplicates.copies > 0 && (
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {duplicates.byType.map((entry) => (
                    <Chip
                      key={entry.resourceType}
                      size="small"
                      variant="outlined"
                      label={`${entry.resourceType} · ${entry.copies}`}
                    />
                  ))}
                </Stack>
              )}
            </>
          )}

          <Divider />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button size="small" variant="outlined" component={RouterLink} to="/providers" onClick={onClose} startIcon={<Plus size={15} />}>
              Add portal
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="error"
              onClick={() => {
                onClose();
                setConfirmOpen(true);
              }}
              startIcon={<Trash2 size={15} />}
            >
              Clear local data
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            Manage records on the <MuiLink component={RouterLink} to="/records" onClick={onClose}>Records page</MuiLink>.
          </Typography>
        </Stack>
      </Popover>

      <Dialog open={duplicatesOpen} onClose={() => setDuplicatesOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Duplicate records</DialogTitle>
        <DialogContent dividers>{duplicates && <DuplicateRecordsTable summary={duplicates} />}</DialogContent>
        <DialogActions>
          <Button onClick={() => setDuplicatesOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={usCoreOpen} onClose={() => setUsCoreOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>US Core data presence</DialogTitle>
        <DialogContent dividers>{usCore && <UsCoreDataTable checks={usCore} />}</DialogContent>
        <DialogActions>
          <Button onClick={() => setUsCoreOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(sourceToDelete)}
        onClose={() => {
          if (!deleting) setSourceToDelete(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Delete this portal's data?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" component="div">
            {sourceToDelete?.label} and everything stored for it:
          </Typography>
          <Box component="ul" pl={2} mb={1}>
            <li>The connection and its stored sign-in material</li>
            <li>The records fetched from this portal, with their groupings and edits</li>
            <li>Care-gap dismissals for this portal's patient</li>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Other portals keep their data, and records you added yourself are kept — they are not tied to a portal.
          </Typography>
          <Typography variant="body2" fontWeight={700} mt={1}>
            This cannot be undone.
          </Typography>
          {deleteError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={deleting} onClick={() => setSourceToDelete(null)}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={deleting || !sourceToDelete}
            onClick={() => {
              const target = sourceToDelete;
              if (!target) return;
              setDeleting(true);
              void deleteSourceData(target.id)
                .then(() => window.location.assign("/records"))
                .catch((error: unknown) => {
                  setDeleting(false);
                  setDeleteError(error instanceof Error ? error.message : String(error));
                });
            }}
            startIcon={<Trash2 size={16} />}
          >
            {deleting ? "Deleting…" : "Delete this portal"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Clear all local data?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" component="div">
            This permanently deletes all locally stored patient data
            {status.sources.length > 0 && (
              <>
                {" "}— {status.sources.length} connection{status.sources.length === 1 ? "" : "s"}
              </>
            )}
            :
          </Typography>
          <Box component="ul" pl={2} mb={1}>
            <li>Portal connections and token material</li>
            <li>Fetched medical records</li>
            <li>Record groupings, patches, and authored entries</li>
            <li>Care-gap dismissals</li>
          </Box>
          <Typography variant="body2" fontWeight={700} mt={1}>
            This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => void clearAllLocalData()} startIcon={<Trash2 size={16} />}>
            Delete everything
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
