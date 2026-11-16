import { useEffect, useState } from "react";
import { Alert, Box, Button, Card, CardContent, Chip, Divider, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { Activity, ClipboardCheck, Play } from "lucide-react";
import { engineLoadResources, engineQuery } from "../lib/engine/engine-client";
import { US_CORE_CHECKS, type UsCoreCheck } from "../lib/fhir/uscore-checks";
import { DEFAULT_FHIR_PAGE_LIMIT, fetchPatientDataset } from "../lib/smart/data";
import type { MvpResourceType } from "../lib/smart/scopes";
import type { SmartSessionInfo, SmartToken } from "../lib/smart/types";
import { getOrCreateSessionVaultKey } from "../lib/vault/keys";
import { localVault } from "../lib/vault/store";
import type { FhirResource } from "../lib/smart/data";

interface CheckResult {
  check: UsCoreCheck;
  rows: Array<{ patientId: string; total: number; conforming: number }>;
  error?: string;
}

interface MeasureManifest {
  measures: Record<string, { title: string; populations: string[]; sql: string }>;
}

interface MeasureResult {
  id: string;
  title: string;
  columns: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[][];
  error?: string;
  executionMs: number;
}

const FETCH_TYPES: readonly MvpResourceType[] = [
  "Patient",
  "MedicationRequest",
  "AllergyIntolerance",
  "Condition",
  "Observation",
  "Immunization",
  "Procedure",
  "Encounter",
  "DiagnosticReport",
  "DocumentReference"
];

function terminologyBaseUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return `${base.replace(/\/?$/, "/")}fhir4ds/measures`;
}

export default function QualityPage() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Connect a source on the Records page, then run quality checks here");
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<CheckResult[]>([]);
  const [measures, setMeasures] = useState<MeasureResult[]>([]);
  const [resourceCount, setResourceCount] = useState<number | null>(null);

  async function loadSessionResources(): Promise<FhirResource[]> {
    const key = await getOrCreateSessionVaultKey();
    const token = await localVault.getJson<SmartToken>(key, { type: "smart-token", id: "current" });
    const session = await localVault.getJson<SmartSessionInfo>(key, { type: "smart-session", id: "current" });
    if (!token || !session) throw new Error("No local SMART connection is available — connect a source first");
    const dataset = await fetchPatientDataset(session, token, {
      resourceTypes: FETCH_TYPES,
      maxPages: DEFAULT_FHIR_PAGE_LIMIT
    });
    return dataset.resources;
  }

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

      setStatus("Running US Core data-presence checks…");
      const results: CheckResult[] = [];
      for (const check of US_CORE_CHECKS) {
        try {
          const result = await engineQuery(check.sql);
          results.push({
            check,
            rows: result.rows.map((row) => ({ patientId: String(row[0]), total: Number(row[1]), conforming: Number(row[2]) }))
          });
        } catch (caught) {
          results.push({ check, rows: [], error: caught instanceof Error ? caught.message : String(caught) });
        }
      }
      setChecks(results);

      setStatus("Running quality measures…");
      const manifestResponse = await fetch(`${terminologyBaseUrl()}/manifest.json`);
      if (!manifestResponse.ok) throw new Error(`Measure manifest unavailable (${manifestResponse.status})`);
      const manifest = (await manifestResponse.json()) as MeasureManifest;
      const measureResults: MeasureResult[] = [];
      for (const [id, measure] of Object.entries(manifest.measures)) {
        const sqlResponse = await fetch(`${terminologyBaseUrl()}/${measure.sql}`);
        if (!sqlResponse.ok) {
          measureResults.push({ id, title: measure.title, columns: [], rows: [], error: `SQL unavailable (${sqlResponse.status})`, executionMs: 0 });
          continue;
        }
        let sql = await sqlResponse.text();
        // Measure SQL is generated for the 2026 measurement period; shift to
        // the current year so live data windows line up.
        const year = new Date().getFullYear();
        if (year !== 2026) {
          sql = sql
            .replaceAll("2026-01-01T00:00:00.000", `${year}-01-01T00:00:00.000`)
            .replaceAll("2026-12-31T23:59:59.999", `${year}-12-31T23:59:59.999`);
        }
        const started = performance.now();
        try {
          const result = await engineQuery(sql);
          measureResults.push({ id, title: measure.title, columns: result.columns, rows: result.rows, executionMs: Math.round(performance.now() - started) });
        } catch (caught) {
          measureResults.push({ id, title: measure.title, columns: [], rows: [], error: caught instanceof Error ? caught.message : String(caught), executionMs: Math.round(performance.now() - started) });
        }
      }
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

  function conformanceChip(result: CheckResult): React.ReactNode {
    if (result.error) return <Chip size="small" color="error" label="error" />;
    const total = result.rows.reduce((sum, row) => sum + row.total, 0);
    const conforming = result.rows.reduce((sum, row) => sum + row.conforming, 0);
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
                Profile enforcement off — these report required-element presence per resource type.
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
                      <TableCell>{result.check.title}</TableCell>
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
