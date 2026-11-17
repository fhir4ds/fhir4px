import { useEffect, useState } from "react";
import { Alert, Button, Card, CardContent, Chip, Divider, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { Play, Users } from "lucide-react";
import { engineLoadResources, engineQuery } from "../lib/engine/engine-client";
import { loadSessionResources } from "../lib/engine/session-data";
import { COHORT_DEFINITIONS, type CohortDefinition } from "../lib/fhir/cohorts";

interface CohortResult {
  definition: CohortDefinition;
  columns: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[][];
  error?: string;
  executionMs: number;
}

export default function CohortsPage() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Connect a source on the Records page, then run cohort identification here");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CohortResult[]>([]);
  const [resourceCount, setResourceCount] = useState<number | null>(null);

  async function runCohorts() {
    setBusy(true);
    setError(null);
    setResults([]);
    try {
      setStatus("Loading patient data into the analysis engine…");
      const resources = await loadSessionResources();
      await engineLoadResources(resources);
      setResourceCount(resources.length);

      const next: CohortResult[] = [];
      for (const definition of COHORT_DEFINITIONS) {
        setStatus(`Evaluating cohort: ${definition.title}…`);
        const started = performance.now();
        try {
          const result = await engineQuery(definition.sql);
          next.push({ definition, columns: result.columns, rows: result.rows, executionMs: Math.round(performance.now() - started) });
        } catch (caught) {
          next.push({
            definition,
            columns: [],
            rows: [],
            error: caught instanceof Error ? caught.message : String(caught),
            executionMs: Math.round(performance.now() - started)
          });
        }
      }
      setResults(next);
      const matched = next.filter((r) => !r.error && r.rows.length > 0).length;
      setStatus(`Completed — ${matched}/${next.length} cohorts matched over ${resources.length} resources`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Cohort run failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => () => undefined, []);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={3}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Users size={22} />
            <Typography variant="h2">Cohorts</Typography>
          </Stack>
          <Typography color="text.secondary">{status}</Typography>
          {busy && <LinearProgress />}
          {error && <Alert severity="error">{error}</Alert>}

          <Button variant="contained" startIcon={<Play size={18} />} onClick={() => void runCohorts()} disabled={busy}>
            Run cohort identification
          </Button>
          {resourceCount !== null && <Chip label={`${resourceCount} resources loaded into the engine`} />}

          {results.length > 0 && (
            <Stack spacing={1.5}>
              <Divider />
              <Typography variant="body2" color="text.secondary">
                Static definitions (curated criteria). A builder UI can author definitions against the same execution path later.
              </Typography>
              {results.map((result) => (
                <Stack key={result.definition.id} spacing={0.75} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography fontWeight={700}>{result.definition.title}</Typography>
                    <Chip size="small" variant="outlined" label={result.definition.category} />
                    {result.error ? (
                      <Chip size="small" color="error" label="failed" />
                    ) : (
                      <Chip
                        size="small"
                        color={result.rows.length > 0 ? "success" : "default"}
                        label={result.rows.length > 0 ? `${result.rows.length} patient${result.rows.length === 1 ? "" : "s"}` : "no matches"}
                      />
                    )}
                    <Chip size="small" variant="outlined" label={`${result.executionMs} ms`} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {result.definition.description}
                  </Typography>
                  {result.error ? (
                    <Typography variant="body2" color="error" sx={{ overflowWrap: "anywhere" }}>
                      {result.error.slice(0, 300)}
                    </Typography>
                  ) : result.rows.length > 0 ? (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          {result.columns.map((column) => (
                            <TableCell key={column} sx={{ fontWeight: 700 }}>
                              {column}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {result.rows.slice(0, 20).map((row, index) => (
                          <TableRow key={index}>
                            {row.map((cell, cellIndex) => (
                              <TableCell key={cellIndex}>
                                {cell === null || cell === undefined ? "—" : typeof cell === "object" ? JSON.stringify(cell).slice(0, 60) : String(cell)}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : null}
                </Stack>
              ))}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
