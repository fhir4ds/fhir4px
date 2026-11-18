import { useEffect, useMemo, useState } from "react";
import { Alert, Box, Card, CardContent, Chip, Divider, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { Activity, ArrowRight, ClipboardCheck } from "lucide-react";
import { engineLoadResources } from "../lib/engine/engine-client";
import { runUsCoreChecks, type UsCoreCheckResult } from "../lib/fhir/uscore-checks";
import { loadSessionResources } from "../lib/engine/session-data";
import { runQualityMeasures, evaluateMeasures, type MeasureEvaluation, type MeasureResult } from "../lib/fhir/measures";



export default function QualityPage() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Connect a source on the Records page, then run quality checks here");
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<UsCoreCheckResult[]>([]);
  const [measures, setMeasures] = useState<MeasureResult[]>([]);
  const [resourceCount, setResourceCount] = useState<number | null>(null);

  async function runChecks() {
    setBusy(true);
    setError(null);
    setChecks([]);
    setMeasures([]);
    try {
      setStatus("Loading patient data into the analysis engine…");
      const resources = await loadSessionResources();
      await engineLoadResources(resources);
      setResourceCount(resources.length);

      setStatus("Running US Core checks via the fhir4ds view engine…");
      const results = await runUsCoreChecks(resources);
      setChecks(results);

      setStatus("Running quality measures…");
      const measureResults = await runQualityMeasures();
      setMeasures(measureResults);
      setStatus(`Completed — ${results.length} conformance checks and ${measureResults.length} measures over ${resources.length} resources`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Quality run failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // Auto-run once per mount — results are dataset-scoped and cached at
    // module level (shared with the Records summary care-gap band), so there
    // is no manual trigger. Without a connected session the run throws and
    // the connect hint stays up.
    void runChecks();
    return () => {
      // engine frame is session-scoped; nothing to dispose here
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const measureEvaluations = useMemo(
    () =>
      measures.map((measure) => ({
        measure,
        evaluation: evaluateMeasures([measure])[0] as MeasureEvaluation
      })),
    [measures]
  );

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

  function conformanceChip(result: UsCoreCheckResult): React.ReactNode {
    if (result.error) return <Chip size="small" color="error" label="error" />;
    const total = result.total;
    const conforming = result.conforming;
    if (total === 0) return <Chip size="small" variant="outlined" label="no data" />;
    const share = conforming / total;
    return (
      <Chip
        size="small"
        color={share >= 0.99 ? "success" : share >= 0.9 ? "warning" : "error"}
        label={`${conforming}/${total} (${Math.round(share * 100)}%)`}
      />
    );
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <Stack direction="row" spacing={1} alignItems="center">
            <ClipboardCheck size={22} />
            <Typography variant="h2">Quality</Typography>
          </Stack>
          <Typography color="text.secondary">{status}</Typography>
          {busy && <LinearProgress />}
          {error && <Alert severity="error">{error}</Alert>}

          <Typography variant="caption" color="text.secondary">
            Runs automatically from the loaded dataset — results are shared with the Records summary care-gap band.
          </Typography>
          {resourceCount !== null && <Chip label={`${resourceCount} resources loaded into the engine`} />}

          {checks.length > 0 && (
            <Stack spacing={1}>
              <Divider />
              <Stack direction="row" spacing={1} alignItems="center">
                <Activity size={16} />
                <Typography fontWeight={700}>US Core data presence</Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Profile enforcement off — fhir4ds ViewDefinitions report required-element presence per resource type.
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Check</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Requirement</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Conforming</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {checks.map((result) => (
                    <TableRow key={result.check.id}>
                      <TableCell>{result.check.name}</TableCell>
                      <TableCell color="text.secondary">{result.error ?? result.check.description}</TableCell>
                      <TableCell>{conformanceChip(result)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Stack>
          )}

          {measureEvaluations.length > 0 && (
            <Stack spacing={1}>
              <Divider />
              <Typography fontWeight={700}>Quality measures (CMS, pre-translated CQL→SQL)</Typography>
              <Typography variant="body2" color="text.secondary">
                Evaluated once per loaded dataset and shared with the Records summary care-gap band.
                Measures whose initial population is false are listed compactly — they do not apply to this patient.
              </Typography>
              {measureEvaluations.map(({ measure, evaluation }) => (
                <Box key={measure.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography fontWeight={700}>{measure.id}</Typography>
                    <Typography color="text.secondary">{measure.title}</Typography>
                    {measure.error ? (
                      <Chip size="small" color="error" label="failed" />
                    ) : evaluation.negative ? (
                      <Chip size="small" color="error" label="care gap" />
                    ) : evaluation.initialPopulation ? (
                      <Chip size="small" color="success" label="met" />
                    ) : null}
                    <Chip size="small" variant="outlined" label={`${measure.executionMs} ms`} />
                  </Stack>
                  {measure.error ? (
                    <Typography variant="body2" color="error" sx={{ mt: 0.5, overflowWrap: "anywhere" }}>
                      {measure.error.slice(0, 300)}
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
              ))}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
