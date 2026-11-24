/**
 * Connection chip — the patient profile's filled source chip, promoted into
 * the connection control: clicking it opens the connection menu. While
 * records load or measures evaluate it shows a spinner and the current phase
 * in place of its label; once settled it keeps its own label and carries a
 * status dot (green connected, amber when a portal needs reconnecting).
 */

import { useEffect, useState } from "react";
import { Box, Chip, CircularProgress } from "@mui/material";
import ConnectionMenu from "./ConnectionMenu";
import {
  getConnectionStatus,
  subscribeConnectionStatus,
  type ConnectionStatusState
} from "../lib/app/connection-status";

export default function ConnectionChip({ label }: { label?: string }) {
  const [status, setStatus] = useState<ConnectionStatusState>(getConnectionStatus);
  useEffect(() => subscribeConnectionStatus(setStatus), []);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const working = status.phase === "loading" || status.phase === "evaluating";
  const dotColor =
    status.phase === "connected" ? "success.main" : status.phase === "warning" ? "warning.main" : "text.disabled";
  const text = working || label === undefined ? status.label : label;

  return (
    <>
      <Chip
        size="small"
        label={text}
        onClick={(event) => setAnchorEl(event.currentTarget)}
        aria-label={`Connection status: ${text}`}
        icon={
          working ? (
            <CircularProgress size={12} />
          ) : (
            <Box
              component="span"
              aria-hidden
              sx={{ display: "block", width: 8, height: 8, borderRadius: "50%", bgcolor: dotColor }}
            />
          )
        }
        sx={{
          cursor: "pointer",
          maxWidth: "100%",
          minWidth: 0,
          "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
        }}
      />
      <ConnectionMenu open={Boolean(anchorEl)} anchorEl={anchorEl} onClose={() => setAnchorEl(null)} />
    </>
  );
}
