/**
 * Persistent two-level navigation — part of the page layout, not an overlay.
 *
 * Level 1 is an icon rail: Records, Quality, Cohorts and LLM Lab, with
 * Providers as a secondary entry. Level 2 shows the active section's
 * children; today only Records has any — its resource tabs (Summary,
 * Medications, Allergies, …), ending in Add record — so it collapses for the
 * other sections. Below the md breakpoint only the rail is shown and the
 * Records page uses its own horizontal tab strip; the two share that
 * breakpoint.
 *
 * The Records page is keep-alive mounted only after its first visit, so its
 * tabs come from the connection-status store and tab selection and Add
 * record go through the records-page command registry, which queues them
 * until the page is there to run them.
 */

import { useEffect, useState, type ReactElement } from "react";
import { Box, Button, Divider, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import { ClipboardList, FlaskConical, Gauge, Plus, Search, Users } from "lucide-react";
import {
  dispatchRecordsPageCommand,
  getConnectionStatus,
  subscribeConnectionStatus,
  type ConnectionStatusState
} from "../lib/app/connection-status";

const RECORDS_PATH = "/records";

interface RailItem {
  to: string;
  label: string;
  icon: ReactElement;
}

const SECTIONS: readonly RailItem[] = [
  { to: RECORDS_PATH, label: "Records", icon: <ClipboardList size={20} /> },
  { to: "/quality", label: "Quality", icon: <Gauge size={20} /> },
  { to: "/cohorts", label: "Cohorts", icon: <Users size={20} /> },
  { to: "/llm-playground", label: "LLM Lab", icon: <FlaskConical size={20} /> }
];

const SECONDARY: readonly RailItem[] = [{ to: "/providers", label: "Providers", icon: <Search size={20} /> }];

const PANEL_STYLE = { p: 0.75, border: 1, borderColor: "divider", borderRadius: 1 } as const;

function RailButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactElement }) {
  return (
    <Tooltip title={label} placement="right">
      <IconButton
        size="small"
        aria-label={label}
        aria-current={active ? "page" : undefined}
        onClick={onClick}
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1,
          color: active ? "primary.main" : "text.secondary",
          bgcolor: active ? "rgba(116, 192, 252, 0.12)" : "transparent",
          "&:hover": { bgcolor: "rgba(116, 192, 252, 0.08)" }
        }}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

export default function AppNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ConnectionStatusState>(getConnectionStatus);
  useEffect(() => subscribeConnectionStatus(setStatus), []);

  const recordsActive = location.pathname === RECORDS_PATH;
  const recordTabs = recordsActive ? status.recordTabs ?? null : null;
  const recordsOpen = recordTabs ? recordTabs.tabs.some((tab) => tab.count > 0) : false;

  function selectRecordsTab(tabId: string) {
    navigate(RECORDS_PATH);
    dispatchRecordsPageCommand({ kind: "selectTab", tabId });
  }

  function addRecord() {
    navigate(RECORDS_PATH);
    dispatchRecordsPageCommand({ kind: "addRecord" });
  }

  return (
    <Stack
      component="nav"
      aria-label="Main navigation"
      direction="row"
      spacing={1.5}
      alignItems="flex-start"
      sx={{ position: "sticky", top: 16 }}
    >
      <Stack spacing={0.5} sx={PANEL_STYLE}>
        {SECTIONS.map((item) => (
          <RailButton
            key={item.to}
            label={item.label}
            active={location.pathname === item.to}
            onClick={() => navigate(item.to)}
          >
            {item.icon}
          </RailButton>
        ))}
        <Divider sx={{ my: 0.5 }} />
        {SECONDARY.map((item) => (
          <RailButton
            key={item.to}
            label={item.label}
            active={location.pathname === item.to}
            onClick={() => navigate(item.to)}
          >
            {item.icon}
          </RailButton>
        ))}
      </Stack>

      {recordsActive && (
        <Stack spacing={0.5} sx={{ ...PANEL_STYLE, display: { xs: "none", md: "flex" }, width: 200 }}>
          {recordTabs && !recordsOpen && (
            <Typography variant="caption" color="text.secondary" sx={{ px: 1, py: 0.5 }}>
              No records open
            </Typography>
          )}
          {recordTabs?.tabs.map((tab) => {
            const active = recordTabs.activeTabId === tab.id;
            return (
              <Button
                key={tab.id}
                aria-current={active ? "true" : undefined}
                onClick={() => selectRecordsTab(tab.id)}
                sx={{
                  justifyContent: "flex-start",
                  textTransform: "none",
                  px: 1.25,
                  borderRadius: 1,
                  color: active ? "primary.main" : "text.secondary",
                  bgcolor: active ? "rgba(116, 192, 252, 0.12)" : "transparent",
                  "&:hover": { bgcolor: "rgba(116, 192, 252, 0.08)" }
                }}
              >
                {tab.label}{" "}
                <Box component="span" sx={{ ml: "auto", pl: 2, fontSize: "0.75rem", color: "text.secondary" }}>
                  {tab.count}
                </Box>
              </Button>
            );
          })}
          <Divider sx={{ my: 0.5 }} />
          <Button variant="outlined" size="small" fullWidth startIcon={<Plus size={15} />} onClick={addRecord}>
            Add record
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
