/**
 * Quality area → Care gaps: every open care gap for the patient, most urgent
 * first, with the same dismiss and restore as the Records summary band.
 *
 * The gaps and their dismissals belong to the Records page and arrive
 * through the connection-status store; this view only sends commands back.
 * When that page has not been opened (a reload straight onto the Quality
 * area), the gaps are instead computed here from the loaded dataset; they
 * are then shown without dismissing, which stays with the Records page.
 */

import { useEffect, useState } from "react";
import { Alert, Box, Chip, LinearProgress, Stack, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import type { CareGap } from "../lib/fhir/care-gaps";
import { runCareGaps } from "../lib/fhir/care-gaps-run";
import {
  dispatchRecordsPageCommand,
  getConnectionStatus,
  subscribeConnectionStatus,
  type ConnectionStatusState
} from "../lib/app/connection-status";
import CareGapCard from "./CareGapCard";

const RECORDS_PATH = "/records";

interface CareGapsViewProps {
  /** Opens the measure a gap came from in the Quality measures view. */
  onOpenMeasure: (measureId: string) => void;
}

/** Gaps computed here because the Records page is not open. */
type Computed = { gaps: CareGap[]; error: null } | { gaps: null; error: string };

export default function CareGapsView({ onOpenMeasure }: CareGapsViewProps) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ConnectionStatusState>(getConnectionStatus);
  useEffect(() => subscribeConnectionStatus(setStatus), []);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const careGaps = status.careGaps ?? null;
  const connected = status.sources.length > 0;
  // The Records page publishes the record tabs; their presence says it is open.
  const recordsOpen = status.recordTabs != null;
  const working = status.phase === "loading" || status.phase === "evaluating";

  const [computed, setComputed] = useState<Computed | null>(null);
  useEffect(() => {
    if (careGaps || !connected || recordsOpen) return;
    let cancelled = false;
    void runCareGaps()
      .then((gaps) => {
        if (!cancelled) setComputed({ gaps, error: null });
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setComputed({ gaps: null, error: caught instanceof Error ? caught.message : String(caught) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [careGaps, connected, recordsOpen]);

  function openGap(gap: CareGap) {
    if (gap.measureId) {
      onOpenMeasure(gap.measureId);
      return;
    }
    if (gap.targetTab) {
      navigate(RECORDS_PATH);
      dispatchRecordsPageCommand({ kind: "selectTab", tabId: gap.targetTab });
    }
  }

  if (!connected) {
    return <Alert severity="info">Connect a portal to see care gaps.</Alert>;
  }

  // Which gaps to show, and whether the patient can dismiss them here.
  const open = careGaps ? careGaps.open : computed?.gaps ?? [];
  const calculating = careGaps ? working : computed === null;
  const failure = computed && computed.error !== null ? computed.error : null;

  let content;
  if (open.length > 0) {
    content = (
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" }, gap: 1.5 }}>
        {open.map((gap) => (
          <CareGapCard
            key={gap.id}
            gap={gap}
            expanded={expandedId === gap.id}
            onToggleExpanded={(toggled) => setExpandedId((current) => (current === toggled.id ? null : toggled.id))}
            selectLabel={gap.measureId ? "View measure" : "View records"}
            onSelect={openGap}
            onDismiss={careGaps ? (gap) => dispatchRecordsPageCommand({ kind: "dismissCareGap", gapId: gap.id }) : undefined}
          />
        ))}
      </Box>
    );
  } else if (calculating) {
    content = (
      <Stack spacing={0.5}>
        <LinearProgress />
        <Typography variant="body2" color="text.secondary">
          Calculating care gaps…
        </Typography>
      </Stack>
    );
  } else if (failure) {
    content = <Alert severity="error">Care gaps could not be calculated: {failure}</Alert>;
  } else {
    content = <Alert severity="success">No open care gaps for this patient.</Alert>;
  }

  return (
    <Stack spacing={1.5}>
      <Typography variant="caption" color="text.secondary">
        From the CDC adult immunization schedule and the CMS quality measures. Click a card for its evidence.
      </Typography>
      {content}
      {!careGaps && open.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          Gaps are dismissed from the Records page summary.
        </Typography>
      )}
      {careGaps && careGaps.dismissed.length > 0 && (
        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="caption" color="text.secondary">
            Dismissed:
          </Typography>
          {careGaps.dismissed.map((gap) => (
            <Chip
              key={gap.id}
              size="small"
              variant="outlined"
              label={gap.title}
              deleteIcon={<RotateCcw size={12} />}
              onDelete={() => dispatchRecordsPageCommand({ kind: "restoreCareGap", gapId: gap.id })}
              onClick={() => dispatchRecordsPageCommand({ kind: "restoreCareGap", gapId: gap.id })}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
