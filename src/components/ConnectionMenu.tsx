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
  IconButton,
  MenuItem,
  Popover,
  Select,
  Stack,
  Tooltip,
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

/** Green while a portal is fine; amber when it needs attention. */
function portalDotColor(status: string): string {
  return status === "error" || status === "needs-reconnect" ? "warning.main" : "success.main";
}

/** "1,614 records", plus the state only when something is wrong. */
function portalDetail(source: ConnectionStatusSource): string {
  const parts: string[] = [];
  if (source.recordCount !== undefined) {
    parts.push(`${source.recordCount.toLocaleString()} ${source.recordCount === 1 ? "record" : "records"}`);
  }
  if (source.status !== "ready" && source.status !== "connected") {
    parts.push(source.status === "needs-reconnect" ? "needs reconnect" : source.status);
  }
  return parts.join(" · ");
}

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
  const patientPeople = status.patientPeople ?? null;
  const mismatch = status.patientMismatch ?? null;
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
        slotProps={{ paper: { sx: { width: 440, p: 2 } } }}
      >
        <Stack spacing={1.5}>
          {working && <CircularProgress size={18} sx={{ alignSelf: "flex-start" }} />}

          <Typography variant="caption" color="text.secondary">
            Portals
          </Typography>

          {status.sources.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No portal connected.
            </Typography>
          ) : (
            <Stack spacing={1.75}>
              {status.sources.map((source) => {
                const namingSourceId =
                  patientPeople?.rows.find((row) => row.sourceId === source.id)?.namingSourceId ?? source.id;
                return (
                  <Stack key={source.id} spacing={0.5}>
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                        <Box
                          component="span"
                          aria-hidden
                          sx={{
                            display: "block",
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            bgcolor: portalDotColor(source.status),
                            flexShrink: 0
                          }}
                        />
                        <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                          {source.label}
                        </Typography>
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ flex: "0 0 auto" }}>
                        {portalDetail(source)}
                      </Typography>
                    </Stack>
                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                      {patientPeople && (
                        <Select
                          size="small"
                          variant="standard"
                          disableUnderline
                          displayEmpty
                          value={namingSourceId}
                          onChange={(event) =>
                            dispatchRecordsPageCommand({
                              kind: "setPatientIdentity",
                              sourceId: source.id,
                              sameAs: String(event.target.value)
                            })
                          }
                          inputProps={{ "aria-label": `Person for ${source.label}` }}
                          sx={{ flex: 1, minWidth: 150, maxWidth: 250, fontSize: "0.8rem" }}
                        >
                          {patientPeople.rows.map((row) => (
                            <MenuItem key={row.sourceId} value={row.sourceId}>
                              {row.sourceId === source.id ? row.label : `Same as ${row.label}`}
                            </MenuItem>
                          ))}
                        </Select>
                      )}
                      <Stack direction="row" spacing={0.25} sx={{ ml: "auto", flexShrink: 0 }}>
                        <Tooltip title="Refresh this portal">
                          <IconButton
                            size="small"
                            aria-label={`Refresh ${source.label}`}
                            onClick={() => {
                              onClose();
                              dispatchRecordsPageCommand({ kind: "refreshSource", sourceId: source.id });
                            }}
                          >
                            <RefreshCw size={16} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete this portal's data">
                          <IconButton
                            size="small"
                            color="error"
                            aria-label={`Delete ${source.label}`}
                            onClick={() => {
                              onClose();
                              setDeleteError(null);
                              setSourceToDelete(source);
                            }}
                          >
                            <Trash2 size={16} />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Stack>
                  </Stack>
                );
              })}
            </Stack>
          )}

          {mismatch && (
            <Typography variant="caption" color="warning.main">
              {mismatch.verdict === "different"
                ? `These ${mismatch.portalCount} portals look like different people. Set the person on each portal.`
                : `Could not confirm these ${mismatch.portalCount} portals are one person. Set the person on each portal.`}
            </Typography>
          )}

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <Button size="small" variant="outlined" component={RouterLink} to="/providers" onClick={onClose} startIcon={<Plus size={15} />}>
              Add portal
            </Button>
            {patientPeople && patientPeople.overrideCount > 0 && (
              <Button
                size="small"
                onClick={() => {
                  onClose();
                  dispatchRecordsPageCommand({ kind: "resetPatientIdentity" });
                }}
                sx={{ textTransform: "none" }}
              >
                Reset to matching
              </Button>
            )}
            {status.sources.length > 0 && (
              <Button
                size="small"
                color="error"
                onClick={() => {
                  onClose();
                  setConfirmOpen(true);
                }}
                sx={{ textTransform: "none" }}
              >
                Delete all portals' data
              </Button>
            )}
          </Stack>

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
        <DialogTitle>Delete all portals' data?</DialogTitle>
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
