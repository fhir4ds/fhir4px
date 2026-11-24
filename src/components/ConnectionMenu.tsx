/**
 * Connection menu — the popover and its clear-data confirmation, shared by
 * every connection control: the patient profile's connection chip on the
 * Records page, and the top-bar pill on pages without one. It lists the
 * connections and offers the Records page's source filter ("Viewing") and
 * refresh, Add portal, and Clear local data (with the no-undo confirmation).
 */

import { useEffect, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link as MuiLink,
  Popover,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  dispatchRecordsPageCommand,
  getConnectionStatus,
  subscribeConnectionStatus,
  type ConnectionStatusState
} from "../lib/app/connection-status";
import { clearAllLocalData } from "../lib/vault/clear-local";

interface ConnectionMenuProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  onClose: () => void;
}

export default function ConnectionMenu({ open, anchorEl, onClose }: ConnectionMenuProps) {
  const [status, setStatus] = useState<ConnectionStatusState>(getConnectionStatus);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => subscribeConnectionStatus(setStatus), []);

  const working = status.phase === "loading" || status.phase === "evaluating";

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
              <Stack spacing={1}>
                {status.sources.map((source) => (
                  <Stack key={source.id} direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
                      {source.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ flex: "0 0 auto" }}>
                      {source.recordCount !== undefined ? `${source.recordCount.toLocaleString()} records · ` : ""}
                      {source.status}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </>
          )}

          {status.recordTabs && status.sources.length > 1 && (
            <>
              <Divider />
              <Stack spacing={0.5}>
                <Typography variant="caption" color="text.secondary">
                  Viewing
                </Typography>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={status.recordTabs.activeSourceId}
                  onChange={(_event, value: string | null) => {
                    if (value) dispatchRecordsPageCommand({ kind: "selectSource", sourceId: value });
                  }}
                  aria-label="Records to show"
                  sx={{ flexWrap: "wrap", "& .MuiToggleButton-root": { whiteSpace: "nowrap" } }}
                >
                  <ToggleButton value="all">All portals ({status.sources.length})</ToggleButton>
                  {status.sources.map((source) => (
                    <ToggleButton key={source.id} value={source.id}>
                      {source.label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Stack>
            </>
          )}

          <Divider />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {status.recordTabs && status.sources.length > 0 && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<RefreshCw size={15} />}
                onClick={() => {
                  onClose();
                  dispatchRecordsPageCommand({ kind: "refreshSources" });
                }}
              >
                Refresh
              </Button>
            )}
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
