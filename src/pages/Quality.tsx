import { useEffect, useState } from "react";
import { Alert, Box, Button, Card, CardContent, Chip, Divider, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { Activity, ClipboardCheck, Play } from "lucide-react";
import { engineLoadResources } from "../lib/engine/engine-client";
import { runUsCoreChecks, type UsCoreCheckResult } from "../lib/fhir/uscore-checks";
import { loadSessionResources } from "../lib/engine/session-data";
import { runQualityMeasures, type MeasureResult } from "../lib/fhir/measures";



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
    return () => {
      // engine frame is session-scoped; nothing to dispose here
    };
  }, []);

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

          <Button variant="contained" startIcon={<Play size={18} />} onClick={() => void runChecks()} disabled={busy}>
            Run US Core checks &amp; measures
          </Button>
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

          {measures.length > 0 && (
            <Stack spacing={1}>
              <Divider />
              <Typography fontWeight={700}>Quality measures (CMS, pre-translated CQL→SQL)</Typography>
              {measures.map((measure) => (
                <Box key={measure.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography fontWeight={700}>{measure.id}</Typography>
                    <Typography color="text.secondary">{measure.title}</Typography>
                    {measure.error ? (
                      <Chip size="small" color="error" label="failed" />
                    ) : (
                      <Chip size="small" variant="outlined" label={`${measure.executionMs} ms`} />
                    )}
                  </Stack>
                  {measure.error ? (
                    <Typography variant="body2" color="error" sx={{ mt: 0.5, overflowWrap: "anywhere" }}>
                      {measure.error.slice(0, 300)}
                    </Typography>
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          {measure.columns.map((column) => (
                            <TableCell key={column} sx={{ fontWeight: 700 }}>
                              {column}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {measure.rows.map((row, index) => (
                          <TableRow key={index}>
                            {row.map((cell, cellIndex) => (
                              <TableCell key={cellIndex}>{cell === null || cell === undefined ? "—" : typeof cell === "object" ? JSON.stringify(cell).slice(0, 80) : String(cell)}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
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
