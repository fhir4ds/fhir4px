import type { GroupableRecord, PatientObservationBucket } from "../../fhir/patient-groups";
import promptsData from "../prompts.json";

const PROMPTS = promptsData as {
  version: string;
  tasks: Record<string, { system_prompt: string; output_shape: string }>;
};

// ── Truncation constants ──────────────────────────────────────────────────
const MAX_CONCEPT_TEXT_LENGTH = 500;
const MAX_CODING_DISPLAY_LENGTH = 350;
const MAX_DOSAGE_FORM_LENGTH = 120;
const MAX_ROUTE_LENGTH = 120;
const MAX_CODING_KEYS = 6;
const MAX_AVAILABLE_NAMES = 30;

export function truncateText(value: string | undefined | null, maxLength: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

export function takeDefined<T>(values: T[], limit: number): T[] {
  return values.filter((v): v is NonNullable<T> => v !== undefined && v !== null).slice(0, limit);
}

export function takeCodings(
  codings: { code?: string; display?: string }[] | undefined,
  limit: number
): { code: string; display: string }[] | undefined {
  if (!codings?.length) return undefined;
  const result = takeDefined(
    codings.map((c) => ({
      code: c.code?.trim() || "",
      display: truncateText(c.display?.trim(), MAX_CODING_DISPLAY_LENGTH) || ""
    })),
    limit
  ).filter((c) => c.code || c.display);
  return result.length > 0 ? result : undefined;
}

export function removeUndefinedValues<T extends Record<string, unknown>>(value: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (val !== undefined && val !== null && val !== "") result[key] = val;
  }
  return result as Partial<T>;
}

export function promptRecord(record: GroupableRecord): Record<string, unknown> {
  const conceptTexts = takeDefined(
    record.codeTexts?.map((text) => truncateText(text, MAX_CONCEPT_TEXT_LENGTH)).filter(Boolean) as string[],
    4
  );
  const conceptCodings = takeCodings(record.codeCodings, MAX_CODING_KEYS);
  return removeUndefinedValues({
    id: record.id,
    resourceType: record.resourceType,
    concept:
      conceptTexts || conceptCodings
        ? removeUndefinedValues({ text: conceptTexts, coding: conceptCodings })
        : removeUndefinedValues({ text: [truncateText(record.sourceLabel, MAX_CONCEPT_TEXT_LENGTH)] }),
    ingredients: takeDefined(record.ingredients ?? [], 4),
    dosageForm: truncateText(record.dosageForm, MAX_DOSAGE_FORM_LENGTH),
    route: truncateText(record.route, MAX_ROUTE_LENGTH),
    categoryCode: record.categoryCode,
    resourceCount: record.resourceCount
  });
}

// ── Canonical naming helpers ──────────────────────────────────────────────
export function canonicalName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slug(value: string): string {
  return canonicalName(value).replace(/\s+/g, "-").slice(0, 60) || "group";
}

// ── Available name selection ──────────────────────────────────────────────
export function availableNamesForRecords(records: GroupableRecord[], availableNames: string[]): string[] {
  if (records.length > 0 && records.every((record) => record.resourceType === "MedicationRequest")) {
    return [];
  }
  return availableNames;
}

function availableNameChoices(availableNames: string[]): string[] {
  return [...new Set(availableNames.map((name) => name.trim()).filter(Boolean))].slice(0, MAX_AVAILABLE_NAMES);
}

function availableNameTokens(name: string): string[] {
  return canonicalName(name).split(" ").filter((token) => token.length >= 3);
}

function recordAvailableNameText(record: GroupableRecord): string {
  return canonicalName(
    [record.sourceLabel, ...(record.codeTexts ?? []), ...(record.codeCodings ?? []).map((c) => c.display ?? "")]
      .filter(Boolean)
      .join(" ")
  );
}

function tokensOverlap(a: string[], b: string[]): boolean {
  const setB = new Set(b);
  return a.some((token) => setB.has(token));
}

function availableNameRelevance(name: string, recordTexts: string[]): number {
  const nameTokens = availableNameTokens(name);
  if (nameTokens.length === 0) return 0;
  return recordTexts.reduce((max, text) => {
    const overlap = tokensOverlap(nameTokens, availableNameTokens(text));
    return overlap ? Math.max(max, 1) : max;
  }, 0);
}

export function relevantAvailableNameChoices(records: GroupableRecord[], availableNames: string[]): string[] {
  const choices = availableNameChoices(availableNames);
  if (choices.length === 0 || records.length === 0) return choices;

  const recordTexts = records.map(recordAvailableNameText);
  const scored = choices.map((name) => ({ name, score: availableNameRelevance(name, recordTexts) }));
  const relevant = scored.filter((s) => s.score > 0).map((s) => s.name);
  const irrelevant = scored.filter((s) => s.score === 0).map((s) => s.name);

  const sortedRelevant = relevant.length > 0 ? relevant : choices;
  return [...sortedRelevant, ...irrelevant].slice(0, MAX_AVAILABLE_NAMES);
}

// ── Observation bucket helpers ────────────────────────────────────────────
export function observationBucketFromRecord(record: GroupableRecord): PatientObservationBucket {
  const bucket = (record as GroupableRecord & { observationBucket?: PatientObservationBucket }).observationBucket;
  if (bucket) return bucket;
  const category = canonicalName(record.category ?? "");
  const categoryCode = canonicalName(record.categoryCode ?? "");
  if (category.includes("vital") || categoryCode.includes("vital")) return "vitals";
  if (category.includes("laboratory") || categoryCode.includes("laboratory") || categoryCode.includes("lab")) return "labs";
  return "other";
}

// ── Batch size helpers ────────────────────────────────────────────────────
const DEFAULT_INCREMENTAL_NAMING_BATCH_SIZE = 3;
const MAX_INCREMENTAL_NAMING_BATCH_SIZE = 8;

export function incrementalNamingBatchSize(options: { namingMode?: string; namingBatchSize?: number }): number {
  if (options.namingMode === "single") return 1;
  const requested = options.namingBatchSize ?? DEFAULT_INCREMENTAL_NAMING_BATCH_SIZE;
  if (!Number.isFinite(requested)) return DEFAULT_INCREMENTAL_NAMING_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_INCREMENTAL_NAMING_BATCH_SIZE, Math.floor(requested)));
}

// ── Prompt accessors ──────────────────────────────────────────────────────
export function getNamingSystemPrompt(): string {
  return PROMPTS.tasks.app_patient_friendly_name.system_prompt;
}

export function getNamingOutputShape(): string {
  return PROMPTS.tasks.app_patient_friendly_name.output_shape;
}

// ── Prompt builders ───────────────────────────────────────────────────────
export function namingUserPrompt(record: GroupableRecord, availableNames: string[]): string {
  const choices = relevantAvailableNameChoices([record], availableNamesForRecords([record], availableNames));
  return JSON.stringify({
    outputShape: getNamingOutputShape(),
    availableNames: choices,
    record: promptRecord(record)
  });
}

export function namingBatchUserPrompt(records: GroupableRecord[], availableNames: string[]): string {
  const observationOnly = records.length > 0 && records.every((record) => record.resourceType === "Observation");
  const choices = relevantAvailableNameChoices(records, availableNamesForRecords(records, availableNames));
  return JSON.stringify({
    outputShape: observationOnly
      ? "JSON object: {items:[{id,patientFriendlyName,observationBucket,confidence,fallback}]}"
      : "JSON object: {items:[{id,patientFriendlyName,confidence,fallback}]}",
    availableNames: choices,
    records: records.map(promptRecord)
  });
}
