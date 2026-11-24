/**
 * Persistent two-level navigation — part of the page layout, not an overlay.
 *
 * Level 1 is an icon rail: Records, Quality, Cohorts and LLM Lab, with
 * Providers as a secondary entry. Level 2 shows the active section's
 * children; today only Records has any — its resource tabs (Summary,
 * Medications, Allergies, …), ending in Add record. It can be collapsed from
 * a control in the rail and collapses by itself for sections without
 * children. Both levels share one border, with a separator between them.
 * Below the md breakpoint only the rail is shown and the Records page uses
 * its own horizontal tab strip; the two share that breakpoint.
 *
 * The box stretches the full height of the page, while the rail and the
 * second level stay in view as the page scrolls. The collapse control
 * therefore follows the section icons rather than sitting at the foot of
 * the box, which can be far below the viewport.
 *
 * The Records page is keep-alive mounted only after its first visit, so its
 * tabs come from the connection-status store and tab selection and Add
 * record go through the records-page command registry, which queues them
 * until the page is there to run them.
 */

import { useEffect, useState, type ReactElement } from "react";
import { Box, Button, Chip, Divider, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronsLeft, ChevronsRight, ClipboardList, FlaskConical, Gauge, Plus, Search, Users } from "lucide-react";
import { recordTypeIcon } from "./RecordTypeIcon";
import {
  dispatchRecordsPageCommand,
  getConnectionStatus,
  subscribeConnectionStatus,
  type ConnectionStatusState
} from "../lib/app/connection-status";

const RECORDS_PATH = "/records";
const SECTIONS_PANEL_ID = "nav-sections";

/** Shown from this breakpoint up; the Records page hides its own tab strip
 *  at the same one. */
const SECTIONS_BREAKPOINT = { xs: "none", md: "flex" } as const;

/** A level that stays in view while the page scrolls. */
const STICKY_LEVEL_STYLE = {
  position: "sticky",
  top: 16,
  alignSelf: "flex-start",
  maxHeight: "calc(100vh - 32px)",
  overflowY: "auto"
} as const;

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

const RAIL_BUTTON_STYLE = {
  width: 40,
  height: 40,
  borderRadius: 1,
  color: "text.secondary",
  bgcolor: "transparent",
  "&:hover": { bgcolor: "rgba(116, 192, 252, 0.08)" }
} as const;

const ACTIVE_STYLE = { color: "primary.main", bgcolor: "rgba(116, 192, 252, 0.12)" } as const;

function RailButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactElement }) {
  return (
    <Tooltip title={label} placement="right">
      <IconButton
        size="small"
        aria-label={label}
        aria-current={active ? "page" : undefined}
        onClick={onClick}
        sx={{ ...RAIL_BUTTON_STYLE, ...(active ? ACTIVE_STYLE : {}) }}
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
  const [sectionsExpanded, setSectionsExpanded] = useState(true);
  useEffect(() => subscribeConnectionStatus(setStatus), []);

  const recordsActive = location.pathname === RECORDS_PATH;
  const sectionHasChildren = recordsActive;
  const showSections = sectionHasChildren && sectionsExpanded;
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

  const collapseLabel = sectionsExpanded ? "Collapse sections" : "Expand sections";

  return (
    // Stretches to the height of the page row it sits in; the levels inside
    // are what stay in view.
    <Stack
      component="nav"
      aria-label="Main navigation"
      direction="row"
      sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}
    >
      {/* A plain flex column, not a Stack: a Stack's spacing would override
          children's own margins. */}
      <Box sx={{ ...STICKY_LEVEL_STYLE, display: "flex", flexDirection: "column", gap: 0.5, p: 0.75 }}>
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
        {sectionHasChildren && (
          <Box sx={{ display: { xs: "none", md: "flex" }, flexDirection: "column", gap: 0.5 }}>
            <Divider sx={{ my: 0.5 }} />
            <Tooltip title={collapseLabel} placement="right">
              <IconButton
                size="small"
                aria-label={collapseLabel}
                aria-expanded={sectionsExpanded}
                aria-controls={SECTIONS_PANEL_ID}
                onClick={() => setSectionsExpanded((current) => !current)}
                sx={RAIL_BUTTON_STYLE}
              >
                {sectionsExpanded ? <ChevronsLeft size={18} /> : <ChevronsRight size={18} />}
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Box>

      {showSections && (
        <>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5, display: { xs: "none", md: "block" } }} />
          <Stack id={SECTIONS_PANEL_ID} spacing={0.5} sx={{ ...STICKY_LEVEL_STYLE, display: SECTIONS_BREAKPOINT, width: 200, p: 0.75 }}>
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
                    gap: 1,
                    px: 1.25,
                    borderRadius: 1,
                    color: active ? "primary.main" : "text.secondary",
                    bgcolor: active ? "rgba(116, 192, 252, 0.12)" : "transparent",
                    "&:hover": { bgcolor: "rgba(116, 192, 252, 0.08)" }
                  }}
                >
                  {recordTypeIcon(tab.id, 16)}
                  {tab.label}
                  <Chip component="span" size="small" label={tab.count} sx={{ ml: "auto" }} />
                </Button>
              );
            })}
            <Divider sx={{ my: 0.5 }} />
            <Button variant="outlined" size="small" fullWidth startIcon={<Plus size={15} />} onClick={addRecord}>
              Add record
            </Button>
          </Stack>
        </>
      )}
    </Stack>
  );
}
