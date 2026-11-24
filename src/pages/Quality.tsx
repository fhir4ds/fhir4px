import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, Box, Card, CardContent, LinearProgress, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { ClipboardCheck } from "lucide-react";
import type { MeasureResult } from "../lib/fhir/measures";
import type { QualityEvaluation } from "../lib/fhir/quality-run";
import {
  getConnectionStatus,
  subscribeConnectionStatus,
  type ConnectionStatusState
} from "../lib/app/connection-status";
import { getQualityView, setQualityView, subscribeQualityView, type QualityView } from "../lib/app/quality-view";
import { useDatasetEvaluation } from "../lib/app/use-dataset-evaluation";
import CareGapsView from "../components/CareGapsView";
import QualityMeasuresView from "../components/QualityMeasuresView";

const QUALITY_PATH = "/quality";

const VIEW_LABELS: Record<QualityView, string> = {
  "care-gaps": "Care gaps",
  measures: "Quality measures"
};

function selectMeasures(evaluation: QualityEvaluation): MeasureResult[] {
  return evaluation.measures;
}

export default function QualityPage() {
  const [status, setStatus] = useState<ConnectionStatusState>(getConnectionStatus);
  useEffect(() => subscribeConnectionStatus(setStatus), []);
  const view = useSyncExternalStore(subscribeQualityView, getQualityView);
  const { result, busy } = useDatasetEvaluation(QUALITY_PATH, selectMeasures);
  // The measure a care gap pointed at; the measures view scrolls to it.
  const [focusMeasureId, setFocusMeasureId] = useState<string | null>(null);

  function openMeasure(measureId: string) {
    setFocusMeasureId(null);
    setQualityView("measures");
    setFocusMeasureId(measureId);
  }

  const connected = status.sources.length > 0;
  const failed = result !== null && result.error !== null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
            <Stack direction="row" spacing={1} alignItems="center">
              <ClipboardCheck size={22} />
              <Typography variant="h2">{VIEW_LABELS[view]}</Typography>
            </Stack>
            {/* In-page switch where the navigation's second level is hidden. */}
            <ToggleButtonGroup
              exclusive
              size="small"
              value={view}
              onChange={(_event, value: string | null) => {
                if (value === "care-gaps" || value === "measures") setQualityView(value);
              }}
              aria-label="Quality view"
              sx={{ display: { xs: "inline-flex", md: "none" } }}
            >
              <ToggleButton value="care-gaps">Care gaps</ToggleButton>
              <ToggleButton value="measures">Quality measures</ToggleButton>
            </ToggleButtonGroup>
          </Stack>


          {busy && <LinearProgress />}
          {failed && (connected ? <Alert severity="error">{result.error}</Alert> : <Alert severity="info">Connect a portal to see quality results.</Alert>)}

          {/* Both views stay mounted so the measures filter survives switching. */}
          <Box sx={{ display: view === "care-gaps" ? "block" : "none" }}>
            <CareGapsView onOpenMeasure={openMeasure} />
          </Box>
          <Box sx={{ display: view === "measures" ? "block" : "none" }}>
            {result && result.value !== null && <QualityMeasuresView measures={result.value} focusMeasureId={focusMeasureId} />}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
