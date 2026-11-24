/**
 * Persistent two-level navigation — part of the page layout, not an overlay.
 *
 * Level 1 is an icon rail: Records, Quality, Cohorts and LLM Lab, with
 * Providers as a secondary entry. Level 2 shows the active section's
 * children. Records has its resource tabs (Summary, Medications,
 * Allergies, …), ending in Add record. Quality has its two views, Care gaps
 * and Quality measures. The level can be collapsed from a control in the
 * rail and collapses by itself for sections without children. Both levels
 * share one border, with a separator between them.
 * Below the md breakpoint only the rail is shown and each page offers its
 * own switch; they share that breakpoint.
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

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Box, Button, Chip, Divider, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  ClipboardList,
  FlaskConical,
  Gauge,
  Plus,
  Search,
  Users
} from "lucide-react";
import { recordTypeIcon } from "./RecordTypeIcon";
import {
  dispatchRecordsPageCommand,
  getConnectionStatus,
  subscribeConnectionStatus,
  type ConnectionStatusState
} from "../lib/app/connection-status";
import { getQualityView, setQualityView, subscribeQualityView, type QualityView } from "../lib/app/quality-view";

const RECORDS_PATH = "/records";
const QUALITY_PATH = "/quality";
const SECTIONS_PANEL_ID = "nav-sections";

/** Shown from this breakpoint up; Records and Quality hide their own
 *  switches at the same one. */
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
  { to: QUALITY_PATH, label: "Quality", icon: <Gauge size={20} /> },
  { to: "/cohorts", label: "Cohorts", icon: <Users size={20} /> },
  { to: "/llm-playground", label: "LLM Lab", icon: <FlaskConical size={20} /> }
];

const SECONDARY: readonly RailItem[] = [{ to: "/providers", label: "Providers", icon: <Search size={20} /> }];

/** The Quality area's two views, in display order. */
const QUALITY_VIEWS: ReadonlyArray<{ id: QualityView; label: string; icon: ReactElement }> = [
  { id: "care-gaps", label: "Care gaps", icon: <CalendarClock size={16} /> },
  { id: "measures", label: "Quality measures", icon: <ClipboardCheck size={16} /> }
];

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

/** A second-level entry: leading content, then a count chip at the end. */
function SectionButton({
  active,
  onClick,
  count,
  children
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: ReactNode;
}) {
  return (
    <Button
      aria-current={active ? "true" : undefined}
      onClick={onClick}
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
      {children}
      {count !== undefined && <Chip component="span" size="small" label={count} sx={{ ml: "auto" }} />}
    </Button>
  );
}

export default function AppNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<ConnectionStatusState>(getConnectionStatus);
  const [qualityView, setView] = useState<QualityView>(getQualityView);
  const [sectionsExpanded, setSectionsExpanded] = useState(true);
  useEffect(() => subscribeConnectionStatus(setStatus), []);
  useEffect(() => subscribeQualityView(() => setView(getQualityView)), []);

  const recordsActive = location.pathname === RECORDS_PATH;
  const qualityActive = location.pathname === QUALITY_PATH;
  const sectionHasChildren = recordsActive || qualityActive;
  const showSections = sectionHasChildren && sectionsExpanded;
  const recordTabs = recordsActive ? status.recordTabs ?? null : null;
  const recordsOpen = recordTabs ? recordTabs.tabs.some((tab) => tab.count > 0) : false;
  const openCareGaps = status.careGaps?.open.length;

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
            {recordTabs?.tabs.map((tab) => (
              <SectionButton key={tab.id} active={recordTabs.activeTabId === tab.id} onClick={() => selectRecordsTab(tab.id)} count={tab.count}>
                {recordTypeIcon(tab.id, 16)}
                {tab.label}
              </SectionButton>
            ))}
            {qualityActive &&
              QUALITY_VIEWS.map((item) => (
                <SectionButton
                  key={item.id}
                  active={qualityView === item.id}
                  onClick={() => setQualityView(item.id)}
                  count={item.id === "care-gaps" ? openCareGaps : undefined}
                >
                  {item.icon}
                  {item.label}
                </SectionButton>
              ))}
            {recordsActive && (
              <>
                <Divider sx={{ my: 0.5 }} />
                <Button variant="outlined" size="small" fullWidth startIcon={<Plus size={15} />} onClick={addRecord}>
                  Add record
                </Button>
              </>
            )}
          </Stack>
        </>
      )}
    </Stack>
  );
}
