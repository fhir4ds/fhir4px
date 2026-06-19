import type { GroupableRecord } from "../../fhir/patient-groups";
import type { NamingResult, NamingOptions, NamingDiagnostic } from "./types";
import { getNamingSystemPrompt, namingUserPrompt, namingBatchUserPrompt, relevantAvailableNameChoices, availableNamesForRecords } from "./shared-helpers";
import { extractJson, parseNamingResponse, parseNamingBatchResponse } from "./parse";
import { validatedNamingResult, fallbackNamingForRecord } from "./validate";
import { generate, isLlmLoaded } from "../transformers-llm";

function isContextWindowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /memory/i.test(message) ||
    /out of memory/i.test(message) ||
    /context length/i.test(message) ||
    /sequence length/i.test(message) ||
    /too long/i.test(message) ||
    error instanceof RangeError
  );
}

function logParseFailure(scope: string, content: string, error: unknown): void {
  console.warn("[fhir4px:naming]", {
    event: "naming-parse-failed",
    scope,
    rawContentPreview: content.slice(0, 800),
    rawContentLength: content.length,
    error: error instanceof Error ? error.message : String(error),
    timestamp: new Date().toISOString()
  });
}

export async function nameOne(
  record: GroupableRecord,
  availableNames: string[],
  options: NamingOptions = {}
): Promise<NamingResult> {
  if (!isLlmLoaded()) {
    console.info("[fhir4px:naming]", {
      event: "naming-awaiting-model",
      message: "Waiting for the AI model to finish loading...",
      recordId: record.id,
      timestamp: new Date().toISOString()
    });
    options.onProgress?.("Loading AI model (first use only, please wait)...");
  }
  const namingAvailableNames = relevantAvailableNameChoices([record], availableNamesForRecords([record], availableNames));
  const { content } = await generate({
    systemPrompt: getNamingSystemPrompt(),
    userPayload: namingUserPrompt(record, namingAvailableNames),
    maxTokens: 180,
    temperature: 0
  });
  let parsed: unknown;
  try {
    parsed = extractJson(content);
  } catch (error) {
    logParseFailure("single", content, error);
    throw error;
  }
  return validatedNamingResult(record, { id: record.id, ...parseNamingResponse(parsed) });
}

export async function nameBatch(
  records: GroupableRecord[],
  availableNames: string[],
  options: NamingOptions = {}
): Promise<NamingResult[]> {
  if (records.length === 0) return [];
  if (records.length === 1) return [await nameOne(records[0], availableNames, options)];

  const namingAvailableNames = relevantAvailableNameChoices(records, availableNamesForRecords(records, availableNames));
  const maxTokens = Math.min(900, 120 + records.length * 140);
  const { content } = await generate({
    systemPrompt: getNamingSystemPrompt(),
    userPayload: namingBatchUserPrompt(records, namingAvailableNames),
    maxTokens,
    temperature: 0
  });
  let parsed: unknown;
  try {
    parsed = extractJson(content);
  } catch (error) {
    logParseFailure("batch", content, error);
    throw error;
  }
  return parseNamingBatchResponse(parsed, records).map((result) =>
    validatedNamingResult(
      records.find((r) => r.id === result.id)!,
      result
    )
  );
}

export async function nameRecords(
  records: GroupableRecord[],
  availableNames: string[],
  options: NamingOptions = {}
): Promise<NamingResult[]> {
  if (records.length === 0) return [];

  try {
    return await nameBatch(records, availableNames, options);
  } catch (error) {
    if (records.length <= 1) {
      options.onDiagnostic?.({
        phase: "single record naming",
        message: error instanceof Error ? error.message : String(error),
        affectedRecordIds: records.map((r) => r.id),
        affectedCount: 1,
        fallbackScope: "single-concept"
      });
      return [fallbackNamingForRecord(records[0])];
    }

    if (isContextWindowError(error)) {
      const midpoint = Math.ceil(records.length / 2);
      const left = await nameRecords(records.slice(0, midpoint), availableNames, options);
      const rightAvailable = [...availableNames, ...left.map((r) => r.patientFriendlyName)];
      const right = await nameRecords(records.slice(midpoint), rightAvailable, options);
      return [...left, ...right];
    }

    // Generic batch failure (JSON parse, model error, etc.) → batch fallback for
    // ALL records in the batch. We intentionally do NOT retry per-record here:
    // on the transformers.js WASM backend, each per-record call is a full
    // inference pass (10-30s on a 1.3GB model), and a model that failed JSON
    // formatting in batch mode almost always fails the same way per-record.
    // The cascade turns one bad batch into a minute-plus frozen UI.
    options.onDiagnostic?.({
      phase: "batch record naming",
      message: error instanceof Error ? error.message : String(error),
      affectedRecordIds: records.map((r) => r.id),
      affectedCount: records.length,
      fallbackScope: "batch",
      recovered: true
    });

    return records.map((record) => fallbackNamingForRecord(record));
  }
}
