/**
 * Two-level slide-out navigation. Level 1 is the product: Records (expands
 * to its second level), Quality, Cohorts — plus Providers as a secondary
 * entry. Level 2 is the Records page's resource tabs (Summary, Medications,
 * Allergies, …), published by PatientExplorer through the connection-status
 * store, headed by the loaded patient and ending in Add record.
 *
 * The Records page is keep-alive mounted only after its first visit, so tab
 * selection and Add record go through the records-page command registry,
 * which queues them until the page is there to run them.
 */

import { useEffect, useState } from "react";
import { Box, Button, Divider, Drawer, Stack, Typography } from "@mui/material";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, ClipboardList, Gauge, Plus, Search, Users } from "lucide-react";
import {
  dispatchRecordsPageCommand,
  getConnectionStatus,
  subscribeConnectionStatus,
  type ConnectionStatusState
} from "../lib/app/connection-status";

const RECORDS_PATH = "/records";

const LEVEL_ONE = [
  { to: RECORDS_PATH, label: "Records", icon: <ClipboardList size={18} /> },
  { to: "/quality", label: "Quality", icon: <Gauge size={18} /> },
  { to: "/cohorts", label: "Cohorts", icon: <Users size={18} /> }
];

const LEVEL_ONE_STYLE = {
  justifyContent: "flex-start",
  textTransform: "none",
  fontWeight: 700,
  px: 1.5,
  borderRadius: 1,
  color: "text.secondary",
  "&:hover": { bgcolor: "rgba(116, 192, 252, 0.08)" },
  "&.is-active": { bgcolor: "rgba(116, 192, 252, 0.12)", color: "primary.main" }
} as const;

interface AppNavDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function AppNavDrawer({ open, onClose }: AppNavDrawerProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [recordsExpanded, setRecordsExpanded] = useState(true);
  const [status, setStatus] = useState<ConnectionStatusState>(getConnectionStatus);
  useEffect(() => subscribeConnectionStatus(setStatus), []);

  const recordTabs = status.recordTabs ?? null;

  function go(to: string) {
    navigate(to);
    onClose();
  }

  function selectRecordsTab(tabId: string) {
    navigate(RECORDS_PATH);
    dispatchRecordsPageCommand({ kind: "selectTab", tabId });
    onClose();
  }

  function addRecord() {
    navigate(RECORDS_PATH);
    dispatchRecordsPageCommand({ kind: "addRecord" });
    onClose();
  }

  return (
    <Drawer
      anchor="left"
      open={open}
      onClose={onClose}
      PaperProps={{
        role: "navigation",
        "aria-label": "Main navigation",
        sx: { width: { xs: "100%", sm: 480, md: 560 }, p: 2 }
      }}
    >
      <Box sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: 2.5 }}>
        <Stack spacing={0.5} sx={{ flex: { sm: "0 0 168px" } }}>
          {LEVEL_ONE.map((item) => {
            const active = location.pathname === item.to;
            const isRecords = item.to === RECORDS_PATH;
            return (
              <Button
                key={item.to}
                startIcon={item.icon}
                endIcon={isRecords ? (recordsExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : undefined}
                className={active ? "is-active" : undefined}
                aria-expanded={isRecords ? recordsExpanded : undefined}
                onClick={() => {
                  if (!isRecords) {
                    go(item.to);
                    return;
                  }
                  navigate(RECORDS_PATH);
                  setRecordsExpanded((current) => !current);
                }}
                sx={LEVEL_ONE_STYLE}
              >
                {item.label}
              </Button>
            );
          })}
          <Divider sx={{ my: 1 }} />
          <Button
            startIcon={<Search size={18} />}
            className={location.pathname === "/providers" ? "is-active" : undefined}
            onClick={() => go("/providers")}
            sx={LEVEL_ONE_STYLE}
          >
            Providers
          </Button>
        </Stack>

        {recordsExpanded && (
          <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
            <Typography fontWeight={700} sx={{ overflowWrap: "anywhere" }}>
              {recordTabs?.patientLabel ?? "No records open"}
            </Typography>
            <Divider />
            {recordTabs ? (
              <Stack spacing={0.5}>
                {recordTabs.tabs.map((tab) => {
                  const active = recordTabs.activeTabId === tab.id;
                  return (
                    <Button
                      key={tab.id}
                      className={active ? "is-active" : undefined}
                      onClick={() => selectRecordsTab(tab.id)}
                      sx={LEVEL_ONE_STYLE}
                    >
                      {tab.label}
                      <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: "auto", pl: 2 }}>
                        {tab.count}
                      </Typography>
                    </Button>
                  );
                })}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Open Records to load a patient and see their record types here.
              </Typography>
            )}
            <Divider sx={{ my: 1 }} />
            <Button variant="outlined" startIcon={<Plus size={16} />} onClick={addRecord} sx={{ alignSelf: "flex-start" }}>
              Add record
            </Button>
          </Stack>
        )}
      </Box>
    </Drawer>
  );
}
