/**
 * Quality area → Quality measures: one card per CMS measure. By default only
 * the measures whose initial population the patient is in are listed; a
 * measure that failed to run is always listed. "Show all" adds the rest.
 */

import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Button, Chip, Stack, Typography } from "@mui/material";
import { ArrowRight } from "lucide-react";
import {
  evaluateMeasures,
  measureStatus,
  type MeasureEvaluation,
  type MeasureResult,
  type MeasureStatus
} from "../lib/fhir/measures";

const STATUS_CHIP: Record<MeasureStatus, { label: string; color: "error" | "success" | "warning" | "default" }> = {
  "care-gap": { label: "care gap", color: "error" },
  met: { label: "met", color: "success" },
  excluded: { label: "excluded", color: "warning" },
  "not-in-denominator": { label: "not in denominator", color: "default" }
};

function populationChip(name: string, met: boolean, color: "success" | "warning" = "success") {
  return (
    <Chip
      size="small"
      variant={met ? "filled" : "outlined"}
      color={met ? color : "default"}
      label={met ? `${name} ✓` : `${name} ✕`}
    />
  );
}

interface QualityMeasuresViewProps {
  measures: MeasureResult[];
  /** Measure to bring into view when the view opens (from a care gap). */
  focusMeasureId: string | null;
}

export default function QualityMeasuresView({ measures, focusMeasureId }: QualityMeasuresViewProps) {
  const [showAll, setShowAll] = useState(false);

  const evaluations = useMemo(
    () =>
      measures.map((measure) => ({
        measure,
        evaluation: evaluateMeasures([measure])[0] as MeasureEvaluation
      })),
    [measures]
  );
  const applicable = evaluations.filter(
    ({ measure, evaluation }) => Boolean(measure.error) || evaluation.initialPopulation
  );
  const shown = showAll ? evaluations : applicable;

  useEffect(() => {
    if (!focusMeasureId) return;
    document.getElementById(`measure-${focusMeasureId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusMeasureId, showAll]);

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography fontWeight={700}>Quality measures (CMS)</Typography>
        <Chip
          size="small"
          variant="outlined"
          label={showAll ? `All ${evaluations.length}` : `${applicable.length} of ${evaluations.length} apply`}
        />
        <Button
          size="small"
          sx={{ textTransform: "none" }}
          onClick={() => setShowAll((current) => !current)}
          aria-pressed={showAll}
        >
          {showAll ? "Show only measures that apply" : `Show all ${evaluations.length}`}
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Evaluated once per loaded dataset and shared with the Records summary care-gap band.
        The measurement period is data-driven — it follows the patient&apos;s latest dated record.
        By default only measures whose initial population the patient is in are listed.
      </Typography>
      {shown.length === 0 && (
        <Alert severity="info">No quality measures apply to this patient.</Alert>
      )}
      {shown.map(({ measure, evaluation }) => {
        // A status only means something for a measure whose initial population
        // the patient is in; otherwise the text below says it does not apply.
        const status = !measure.error && evaluation.initialPopulation ? measureStatus(evaluation) : null;
        const statusChip = status ? (
          <Chip size="small" color={STATUS_CHIP[status].color} label={STATUS_CHIP[status].label} />
        ) : measure.error ? (
          <Chip size="small" color="error" label="failed" />
        ) : null;
        return (
          <Box key={measure.id} id={`measure-${measure.id}`} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography fontWeight={700}>{measure.id}</Typography>
              <Typography color="text.secondary">{measure.title}</Typography>
              {statusChip}
              <Chip size="small" variant="outlined" label={`${measure.executionMs} ms`} />
              {measure.measurementYear && (
                <Chip size="small" variant="outlined" label={`measurement year ${measure.measurementYear}`} />
              )}
            </Stack>
            {measure.error ? (
              <Typography variant="body2" color="error" sx={{ mt: 0.5, overflowWrap: "anywhere" }}>
                {measure.error.slice(0, 1200)}
              </Typography>
            ) : evaluation.initialPopulation ? (
              <Stack direction="row" spacing={0.75} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap alignItems="center">
                {populationChip("Initial population", true)}
                <ArrowRight size={13} />
                {populationChip("Denominator", evaluation.denominator)}
                {evaluation.excluded && populationChip("Excluded", true, "warning")}
                {evaluation.denominator && !evaluation.excluded && (
                  <>
                    <ArrowRight size={13} />
                    {populationChip("Numerator", evaluation.numerator)}
                    <Typography variant="caption" color="text.secondary">
                      {evaluation.numerator
                        ? "— numerator requirement documented"
                        : "— numerator requirement not documented"}
                    </Typography>
                  </>
                )}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Not in initial population — measure does not apply to this patient.
              </Typography>
            )}
          </Box>
        );
      })}
    </Stack>
  );
}
