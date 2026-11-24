import { useEffect, useState } from "react";
import { Alert, Card, CardContent, Chip, Divider, LinearProgress, Stack, Typography } from "@mui/material";
import { Users } from "lucide-react";
import type { CohortResult } from "../lib/fhir/cohorts-runner";
import type { QualityEvaluation } from "../lib/fhir/quality-run";
import {
  getConnectionStatus,
  subscribeConnectionStatus,
  type ConnectionStatusState
} from "../lib/app/connection-status";
import { useDatasetEvaluation } from "../lib/app/use-dataset-evaluation";

const COHORTS_PATH = "/cohorts";

function selectCohorts(evaluation: QualityEvaluation): CohortResult[] {
  return evaluation.cohorts;
}

function isMatch(result: CohortResult): boolean {
  return !result.error && result.rows.length > 0;
}

export default function CohortsPage() {
  const [status, setStatus] = useState<ConnectionStatusState>(getConnectionStatus);
  useEffect(() => subscribeConnectionStatus(setStatus), []);
  // Calculated with the quality measures when the dataset loads; no button.
  const { result, busy } = useDatasetEvaluation(COHORTS_PATH, selectCohorts);

  const connected = status.sources.length > 0;
  const failed = result !== null && result.error !== null;
  const results = result && result.value !== null ? result.value : [];
  // Matched cohorts first; the rest keep their definition order.
  const ordered = [...results].sort((left, right) => Number(isMatch(right)) - Number(isMatch(left)));
  const matched = results.filter(isMatch).length;
  const severalPatients = results.some((item) => item.patients.length > 1);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2.5}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Users size={22} />
            <Typography variant="h2">Cohorts</Typography>
          </Stack>


          {busy && <LinearProgress />}
          {failed && (connected ? <Alert severity="error">{result.error}</Alert> : <Alert severity="info">Connect a portal to identify cohorts.</Alert>)}

          {results.length > 0 && (
            <Stack spacing={1.5}>
              <Divider />
              <Typography fontWeight={700}>
                {matched} of {results.length} cohorts match this patient.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Authored CQL, translated by the fhir4ds CQL translator (in-browser), executed on DuckDB-WASM. A builder UI can author definitions against the same pipeline later.
              </Typography>
              {ordered.map((item) => (
                <Stack key={item.definition.id} spacing={0.75} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography fontWeight={700}>{item.definition.title}</Typography>
                    <Chip size="small" variant="outlined" label={item.definition.category} />
                    {item.error ? (
                      <Chip size="small" color="error" label="failed" />
                    ) : (
                      <Chip size="small" color={isMatch(item) ? "success" : "default"} label={isMatch(item) ? "Matches" : "No match"} />
                    )}
                    <Chip size="small" variant="outlined" label={`${item.executionMs} ms`} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {item.definition.description}
                  </Typography>
                  {item.error ? (
                    <Typography variant="body2" color="error" sx={{ overflowWrap: "anywhere" }}>
                      {item.error.slice(0, 300)}
                    </Typography>
                  ) : item.patients.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No patient records were loaded.
                    </Typography>
                  ) : (
                    // What the match is made of: each criterion, met or not.
                    item.patients.map((patient) => (
                      <Stack key={patient.patientId} direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
                        {severalPatients && (
                          <Chip size="small" variant="outlined" label={`Patient ${patient.patientId}`} />
                        )}
                        {patient.criteria.map((criterion) => (
                          <Chip
                            key={criterion.define}
                            size="small"
                            variant={criterion.met ? "filled" : "outlined"}
                            color={criterion.met ? "success" : "default"}
                            label={`${criterion.label} ${criterion.met ? "✓" : "✕"}`}
                            title={criterion.references.length > 0 ? criterion.references.join("\n") : undefined}
                          />
                        ))}
                      </Stack>
                    ))
                  )}
                </Stack>
              ))}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
