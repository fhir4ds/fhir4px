import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { Braces, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  browserCanAttemptWebLlm,
  runStructuredWebLlmPlayground,
  LAB_CONDITION_SYSTEM_PROMPT_OVERRIDE_KEY,
  LAB_CONDITION_USER_PAYLOAD_OVERRIDE_KEY,
  webLlmPlaygroundCases,
  WEBLLM_GROUPING_CUSTOM_MODEL,
  WEBLLM_GROUPING_FALLBACK_MODEL,
  WEBLLM_GROUPING_MODEL,
  type ChatMessage,
  type WebLlmDiagnostic,
  type WebLlmModelPreference,
  type WebLlmPlaygroundCase,
  type WebLlmPlaygroundRunResult
} from "../lib/llm/webllm";

type LocalModelMode = "one-b" | "three-b" | "custom";

const MODEL_OPTIONS: Array<{ value: LocalModelMode; label: string; modelId: string }> = [
  { value: "one-b", label: "1B", modelId: WEBLLM_GROUPING_MODEL },
  { value: "three-b", label: "3B", modelId: WEBLLM_GROUPING_FALLBACK_MODEL },
  { value: "custom", label: "Custom", modelId: WEBLLM_GROUPING_CUSTOM_MODEL }
];

function modelPreference(mode: LocalModelMode): WebLlmModelPreference {
  if (mode === "custom") return "custom";
  return mode === "three-b" ? "three-b" : "one-b";
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function prettyJsonText(value: string): string {
  return prettyJson(JSON.parse(value));
}

function messageByRole(messages: ChatMessage[], role: ChatMessage["role"]): string {
  return messages.find((message) => message.role === role)?.content ?? "";
}

function readSessionStorageValue(key: string): string {
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeSessionStorageValue(key: string, value: string): void {
  try {
    if (value.trim()) {
      window.sessionStorage.setItem(key, value);
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures in constrained/private contexts.
  }
}

function firstCase(cases: WebLlmPlaygroundCase[]): WebLlmPlaygroundCase {
  const first = cases[0];
  if (!first) throw new Error("No WebLLM playground cases are configured");
  return first;
}

export function LlmPlayground() {
  const cases = useMemo(() => webLlmPlaygroundCases(), []);
  const [selectedCaseId, setSelectedCaseId] = useState(firstCase(cases).id);
  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? firstCase(cases);
  const [modelMode, setModelMode] = useState<LocalModelMode>("one-b");
  const [systemPrompt, setSystemPrompt] = useState(messageByRole(selectedCase.messages, "system"));
  const [userPayload, setUserPayload] = useState(prettyJsonText(messageByRole(selectedCase.messages, "user")));
  const [schemaText, setSchemaText] = useState(prettyJsonText(selectedCase.schemaText));
  const [labSystemPromptOverride, setLabSystemPromptOverride] = useState("");
  const [labUserPayloadOverride, setLabUserPayloadOverride] = useState("");
  const [maxTokens, setMaxTokens] = useState(String(selectedCase.maxTokens));
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<WebLlmDiagnostic[]>([]);
  const [result, setResult] = useState<WebLlmPlaygroundRunResult | null>(null);

  const selectedModel = MODEL_OPTIONS.find((option) => option.value === modelMode) ?? MODEL_OPTIONS[0];
  const canAttemptLocalModel = browserCanAttemptWebLlm();

  useEffect(() => {
    setLabSystemPromptOverride(readSessionStorageValue(LAB_CONDITION_SYSTEM_PROMPT_OVERRIDE_KEY));
    setLabUserPayloadOverride(readSessionStorageValue(LAB_CONDITION_USER_PAYLOAD_OVERRIDE_KEY));
  }, [selectedCaseId]);

  function loadCase(nextCase: WebLlmPlaygroundCase) {
    setSelectedCaseId(nextCase.id);
    setSystemPrompt(messageByRole(nextCase.messages, "system"));
    setUserPayload(prettyJsonText(messageByRole(nextCase.messages, "user")));
    setSchemaText(prettyJsonText(nextCase.schemaText));
    setMaxTokens(String(nextCase.maxTokens));
    setError(null);
    setDiagnostics([]);
    setResult(null);
    setStatus("Ready");
  }

  function resetCurrentCase() {
    loadCase(selectedCase);
  }

  function formatJsonEditors() {
    try {
      setUserPayload(prettyJsonText(userPayload));
      setSchemaText(prettyJsonText(schemaText));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function runCase() {
    setBusy(true);
    setError(null);
    setDiagnostics([]);
    setResult(null);
    setStatus("Loading local model");
    try {
      const normalizedUserPayload = prettyJsonText(userPayload);
      const normalizedSchema = prettyJsonText(schemaText);
      setUserPayload(normalizedUserPayload);
      setSchemaText(normalizedSchema);
      const nextResult = await runStructuredWebLlmPlayground(
        {
          operationLabel: selectedCase.operationLabel,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: normalizedUserPayload }
          ],
          schemaText: normalizedSchema,
          maxTokens: Math.max(1, Number.parseInt(maxTokens, 10) || selectedCase.maxTokens)
        },
        {
          modelPreference: modelPreference(modelMode),
          onProgress: setStatus,
          onDiagnostic: (diagnostic) => setDiagnostics((current) => [...current, diagnostic])
        }
      );
      setResult(nextResult);
      setStatus(`Complete in ${nextResult.elapsedMs} ms`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("Failed");
    } finally {
      setBusy(false);
    }
  }

  function loadCurrentLabOverridesFromCase() {
    if (selectedCase.operationLabel !== "lab condition association") {
      setError("Live lab-condition overrides only apply to lab-condition association cases.");
      return;
    }
    setLabSystemPromptOverride(messageByRole(selectedCase.messages, "system"));
    setLabUserPayloadOverride(messageByRole(selectedCase.messages, "user"));
    setError(null);
  }

  function applyLabPromptOverrides() {
    writeSessionStorageValue(LAB_CONDITION_SYSTEM_PROMPT_OVERRIDE_KEY, labSystemPromptOverride);
    writeSessionStorageValue(LAB_CONDITION_USER_PAYLOAD_OVERRIDE_KEY, labUserPayloadOverride);
    setStatus("Lab prompt overrides saved to sessionStorage");
  }

  function clearLabPromptOverrides() {
    writeSessionStorageValue(LAB_CONDITION_SYSTEM_PROMPT_OVERRIDE_KEY, "");
    writeSessionStorageValue(LAB_CONDITION_USER_PAYLOAD_OVERRIDE_KEY, "");
    setLabSystemPromptOverride("");
    setLabUserPayloadOverride("");
    setStatus("Lab prompt overrides cleared");
  }

  return (
    <Stack spacing={2.5}>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }}>
              <Box flexGrow={1}>
                <Typography variant="h2">Local LLM Playground</Typography>
                <Typography color="text.secondary">{selectedCase.description}</Typography>
              </Box>
              <Chip label={selectedModel.modelId} variant="outlined" />
            </Stack>

            {!canAttemptLocalModel && (
              <Alert severity="warning">
                WebGPU is not available in this browser context. The editor is still available, but local model runs may fail.
              </Alert>
            )}

            <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
              <TextField
                select
                label="Test case"
                value={selectedCaseId}
                onChange={(event) => {
                  const next = cases.find((item) => item.id === event.target.value);
                  if (next) loadCase(next);
                }}
                sx={{ minWidth: { md: 320 } }}
              >
                {cases.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.title}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Model"
                value={modelMode}
                onChange={(event) => setModelMode(event.target.value as LocalModelMode)}
                sx={{ minWidth: { md: 160 } }}
              >
                {MODEL_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Max tokens"
                value={maxTokens}
                onChange={(event) => setMaxTokens(event.target.value)}
                inputProps={{ inputMode: "numeric" }}
                sx={{ width: { md: 140 } }}
              />
            </Stack>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button variant="contained" startIcon={<Play size={18} />} onClick={runCase} disabled={busy}>
                Run
              </Button>
              <Button variant="outlined" startIcon={<Braces size={18} />} onClick={formatJsonEditors} disabled={busy}>
                Format JSON
              </Button>
              <Button variant="outlined" startIcon={<RotateCcw size={18} />} onClick={resetCurrentCase} disabled={busy}>
                Reset Case
              </Button>
            </Stack>
            {busy && <LinearProgress />}
            <Typography variant="body2" color="text.secondary">
              {status}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction={{ xs: "column", lg: "row" }} spacing={2} alignItems="stretch">
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Stack spacing={1.5}>
              <Typography variant="h3">System Prompt</Typography>
              <TextField
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                multiline
                minRows={18}
                fullWidth
                spellCheck={false}
              />
            </Stack>
          </CardContent>
        </Card>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Stack spacing={1.5}>
              <Typography variant="h3">User Payload</Typography>
              <TextField
                value={userPayload}
                onChange={(event) => setUserPayload(event.target.value)}
                multiline
                minRows={18}
                fullWidth
                spellCheck={false}
              />
            </Stack>
          </CardContent>
        </Card>

        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Stack spacing={1.5}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Typography variant="h3">Lab Prompt Overrides</Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={loadCurrentLabOverridesFromCase}
                  disabled={busy || selectedCase.operationLabel !== "lab condition association"}
                >
                  Load From Case
                </Button>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Saved to sessionStorage and used by live lab-condition association.
              </Typography>
              <TextField
                label="Lab system prompt override"
                value={labSystemPromptOverride}
                onChange={(event) => setLabSystemPromptOverride(event.target.value)}
                multiline
                minRows={8}
                fullWidth
                spellCheck={false}
              />
              <TextField
                label="Lab user payload override JSON (merge patch)"
                value={labUserPayloadOverride}
                onChange={(event) => setLabUserPayloadOverride(event.target.value)}
                multiline
                minRows={8}
                fullWidth
                spellCheck={false}
              />
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="contained" onClick={applyLabPromptOverrides} disabled={busy}>
                  Apply Overrides
                </Button>
                <Button size="small" variant="outlined" onClick={clearLabPromptOverrides} disabled={busy}>
                  Clear Overrides
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Typography variant="h3">Response Schema</Typography>
            <TextField
              value={schemaText}
              onChange={(event) => setSchemaText(event.target.value)}
              multiline
              minRows={12}
              fullWidth
              spellCheck={false}
            />
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
              <Typography variant="h3" flexGrow={1}>
                Output
              </Typography>
              {result && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={result.modelId} />
                  <Chip size="small" label={`${result.elapsedMs} ms`} />
                  <Chip size="small" label={result.responseShape} />
                </Stack>
              )}
            </Stack>
            {diagnostics.length > 0 && (
              <Alert severity="info">
                {diagnostics.map((diagnostic) => diagnostic.message).join(" ")}
              </Alert>
            )}
            <Divider />
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 2,
                borderRadius: 1,
                bgcolor: "rgba(255,255,255,0.04)",
                overflowX: "auto",
                whiteSpace: "pre-wrap"
              }}
            >
              {result ? prettyJson({ parsed: result.parsed, rawContent: result.rawContent }) : "No output yet."}
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
