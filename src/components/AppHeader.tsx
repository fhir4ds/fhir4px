/**
 * App header — pinned to the top of every wide-screen page. It carries the
 * logo, the loaded patient (name, date of birth with age, sex, address and
 * contact details, as the Records page used to show at the top of its card),
 * the connection chips, and the tools that apply across the product. On
 * narrow screens it stacks and scrolls away with the page.
 *
 * While records load or measures evaluate, the connection chips give way to
 * one chip with a spinner and the current step. With no portal connected the
 * chip reads "Connect portal". Clicking a chip opens the connection menu.
 *
 * The header publishes its height as a CSS variable so the sticky side
 * navigation pins below it instead of sliding underneath.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import { Box, Button, Chip, Container, MenuItem, Select, Stack, Typography } from "@mui/material";
import { Database, Globe, Mail, MapPin, Phone, Settings } from "lucide-react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import ConnectionChip from "./ConnectionChip";
import {
  connectionChipText,
  dispatchRecordsPageCommand,
  getConnectionStatus,
  subscribeConnectionStatus,
  type ConnectionStatusState,
  type PatientChoice
} from "../lib/app/connection-status";

const navItems = [
  { to: "/export", label: "Export", icon: <Database size={18} /> },
  { to: "/settings", label: "Settings", icon: <Settings size={18} /> }
];

/** CSS variable the side navigation reads to pin below the header. */
const HEIGHT_VARIABLE = "--app-header-h";

function contactIcon(system: string): ReactElement {
  if (system === "phone") return <Phone size={13} />;
  if (system === "email") return <Mail size={13} />;
  return <Globe size={13} />;
}

/** Address, phone or email: one quiet line of text rather than a chip each. */
function ContactDetail({ icon, text }: { icon: ReactElement; text: string }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0, maxWidth: "100%" }}>
      <Box component="span" aria-hidden sx={{ display: "flex", color: "text.secondary", flexShrink: 0 }}>
        {icon}
      </Box>
      <Typography variant="caption" color="text.secondary" noWrap title={text} sx={{ minWidth: 0 }}>
        {text}
      </Typography>
    </Stack>
  );
}

/**
 * The person whose records the app is scoped to. Shown instead of the name
 * when several people are connected; changing it changes what every page
 * shows (records, care gaps, measures, cohorts).
 */
function PatientSelect({ choices, selectedId }: { choices: PatientChoice[]; selectedId: string | null }) {
  return (
    <Select
      size="small"
      variant="standard"
      disableUnderline
      value={selectedId}
      onChange={(event) => dispatchRecordsPageCommand({ kind: "selectPatient", sourceId: String(event.target.value) })}
      inputProps={{ "aria-label": "Patient" }}
      renderValue={(value) => (
        <Typography component="span" variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
          {choices.find((choice) => choice.id === String(value))?.label ?? ""}
        </Typography>
      )}
      sx={{ maxWidth: 260, minWidth: 120, "& .MuiSelect-select": { py: 0.25 } }}
    >
      {choices.map((choice) => (
        <MenuItem key={choice.id} value={choice.id}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {choice.label}
            </Typography>
            {choice.detail && (
              <Typography variant="caption" color="text.secondary" noWrap display="block">
                {choice.detail}
              </Typography>
            )}
          </Box>
        </MenuItem>
      ))}
    </Select>
  );
}

export default function AppHeader() {
  const [status, setStatus] = useState<ConnectionStatusState>(getConnectionStatus);
  useEffect(() => subscribeConnectionStatus(setStatus), []);
  const location = useLocation();
  const rootRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const publishHeight = () => {
      // Only a pinned header is in the way of the navigation.
      const pinned = getComputedStyle(element).position === "sticky";
      document.documentElement.style.setProperty(HEIGHT_VARIABLE, pinned ? `${element.offsetHeight}px` : "0px");
    };
    publishHeight();
    const observer = new ResizeObserver(publishHeight);
    observer.observe(element);
    // Crossing the breakpoint can leave the height unchanged.
    window.addEventListener("resize", publishHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publishHeight);
      document.documentElement.style.removeProperty(HEIGHT_VARIABLE);
    };
  }, []);

  const working = status.phase === "loading" || status.phase === "evaluating";
  const patient = status.patient ?? null;
  const selection = status.patientSelection && status.patientSelection.choices.length > 0 ? status.patientSelection : null;
  // What the pages are showing, as the Records page publishes it. The sum of
  // each portal's fetched records is a different, larger number.
  const shownRecordCount = status.recordTabs?.tabs.find((tab) => tab.id === "PatientSummary")?.count ?? null;
  const showContactLine = patient !== null && (Boolean(patient.address) || patient.contacts.length > 0);

  return (
    <Box
      ref={rootRef}
      component="header"
      sx={{
        // Pinned on wide screens. Stacked on narrow ones, where it would take
        // a third of the screen, so there it scrolls away with the page.
        position: { xs: "static", md: "sticky" },
        top: 0,
        zIndex: 1100,
        bgcolor: "background.default",
        borderBottom: 1,
        borderColor: "divider"
      }}
    >
      <Container maxWidth="lg" sx={{ py: 1.5 }}>
        <Box
          sx={{
            display: { xs: "flex", md: "grid" },
            flexDirection: { xs: "column", md: "unset" },
            alignItems: { xs: "flex-start", md: "center" },
            gap: { xs: 1, md: 0 },
            gridTemplateColumns: { md: "auto minmax(0, 1fr) auto" },
            columnGap: { md: 3 }
          }}
        >
          <Typography
            component={RouterLink}
            to="/records"
            variant="h1"
            sx={{
              gridColumn: { md: 1 },
              gridRow: { md: "1 / span 2" },
              color: "text.primary",
              textDecoration: "none",
              alignSelf: { md: "center" }
            }}
          >
            fhir4px
          </Typography>

          {patient !== null && (
            <Stack
              direction="row"
              spacing={0.75}
              flexWrap="wrap"
              useFlexGap
              alignItems="center"
              sx={{ gridColumn: { md: 2 }, gridRow: { md: 1 }, minWidth: 0, rowGap: 0.5 }}
            >
              {selection ? (
                <PatientSelect choices={selection.choices} selectedId={selection.selectedId} />
              ) : (
                <Typography component="h2" variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
                  {patient.name}
                </Typography>
              )}
              {patient.birthDate && (
                <Chip size="small" variant="outlined" label={`DOB ${patient.birthDate}`} />
              )}
              {patient.gender && (
                <Chip size="small" variant="outlined" label={patient.gender} />
              )}
              {/* With several people the patient selector already says so; this
                  chip is only informative when every portal is the same person. */}
              {selection === null && patient.profileCount > 1 && (
                <Chip size="small" label={`${patient.profileCount} portal profiles`} />
              )}
            </Stack>
          )}

          {showContactLine && patient !== null && (
            <Stack
              direction="row"
              spacing={0.75}
              flexWrap="wrap"
              useFlexGap
              sx={{ gridColumn: { md: "2 / span 2" }, gridRow: { md: 2 }, minWidth: 0, rowGap: 0.5, mt: { md: 0.5 } }}
            >
              {patient.address && <ContactDetail icon={<MapPin size={13} />} text={patient.address} />}
              {patient.contacts.map((contact) => (
                <ContactDetail
                  key={`${contact.system}:${contact.value}`}
                  icon={contactIcon(contact.system)}
                  text={contact.value}
                />
              ))}
            </Stack>
          )}

          <Stack
            direction="row"
            spacing={1}
            flexWrap="wrap"
            useFlexGap
            alignItems="center"
            justifyContent="flex-end"
            sx={{ gridColumn: { md: 3 }, gridRow: { md: 1 }, minWidth: 0 }}
          >
            {/* Capped so a long working step cannot squeeze the patient's name. */}
            <Box sx={{ minWidth: 0, maxWidth: { xs: "100%", md: 300 } }}>
              {working ? (
                <ConnectionChip />
              ) : status.sources.length === 0 ? (
                <ConnectionChip label="Connect portal" />
              ) : (
                <ConnectionChip label={connectionChipText(status.sources, shownRecordCount)} />
              )}
            </Box>
            {navItems.map((item) => (
              <Button
                key={item.to}
                component={RouterLink}
                to={item.to}
                startIcon={item.icon}
                variant={location.pathname === item.to ? "contained" : "outlined"}
                size="small"
              >
                {item.label}
              </Button>
            ))}
          </Stack>
        </Box>
      </Container>
    </Box>
  );
}
