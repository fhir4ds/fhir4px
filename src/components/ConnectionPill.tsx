/**
 * Connection pill — the top-bar connection control on pages that have no
 * patient profile chip (the Records page carries that chip instead, so the
 * pill is not shown there). States: disconnected (connect CTA), loading /
 * evaluating (spinner + phase), connected (summary), warning (reconnect
 * needed). Clicking opens the shared connection menu.
 */

import { useEffect, useState } from "react";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import ConnectionMenu from "./ConnectionMenu";
import {
  getConnectionStatus,
  subscribeConnectionStatus,
  type ConnectionStatusState
} from "../lib/app/connection-status";

function PhaseVisual({ phase }: { phase: ConnectionStatusState["phase"] }) {
  if (phase === "loading" || phase === "evaluating") {
    return <CircularProgress size={13} sx={{ flex: "0 0 auto" }} />;
  }
  const color = phase === "connected" ? "success.main" : phase === "warning" ? "warning.main" : "text.secondary";
  return <Box aria-hidden sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, flex: "0 0 auto" }} />;
}

export default function ConnectionPill() {
  const [status, setStatus] = useState<ConnectionStatusState>(getConnectionStatus);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  useEffect(() => subscribeConnectionStatus(setStatus), []);

  const pillLabel = status.phase === "disconnected" && status.sources.length === 0 ? "Connect portal" : status.label;

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        onClick={(event) => setAnchorEl(event.currentTarget)}
        aria-label={`Connection status: ${pillLabel}`}
        startIcon={<PhaseVisual phase={status.phase} />}
        sx={{ textTransform: "none", maxWidth: 320 }}
      >
        <Typography variant="body2" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {pillLabel}
        </Typography>
      </Button>
      <ConnectionMenu open={Boolean(anchorEl)} anchorEl={anchorEl} onClose={() => setAnchorEl(null)} />
    </>
  );
}
