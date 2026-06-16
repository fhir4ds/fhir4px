import type { GroupableRecord, PatientFriendlyGroup, PatientObservationBucket } from "../fhir/patient-groups";
import type {
  AllergyClassification,
  AllergyDomain,
  AllergyAssertionType,
  EncounterVisitClass,
  EncounterVisitClassification,
  ObservationCategoryClassification
} from "../fhir/local-classification";
import type { LabConditionAssociation } from "../fhir/relationships";
import promptsData from "./prompts.json";

interface PromptTask {
  system_prompt: string;
  system_prompt_sha256?: string;
  output_shape: string;
  output_shape_sha256?: string;
}
interface PromptCatalog {
  version: string;
  generated_at?: string;
  tasks: Record<string, PromptTask>;
}

const PROMPTS = promptsData as PromptCatalog;
const EXPECTED_PROMPTS_VERSION = "1.0.0";
// Single source of truth for prompts. Published by the model team at
// https://huggingface.co/joelmontavon/fhir4px-model-webllm/resolve/main/prompts.json
// and regenerated from fhir4px-model/scripts/build_structured_cases.py whenever
// any prompt changes. Bump EXPECTED_PROMPTS_VERSION after validating a new
// publish; the warning below catches silent drift.
if (typeof console !== "undefined" && typeof console.info === "function") {
  // eslint-disable-next-line no-console
  console.info(`[fhir4px:webllm] prompts.json version: ${PROMPTS.version}`);
}
if (PROMPTS.version !== EXPECTED_PROMPTS_VERSION) {
  if (typeof console !== "undefined" && typeof console.error === "function") {
    // eslint-disable-next-line no-console
    console.error(
      `[fhir4px:webllm] prompts.json version mismatch: expected ${EXPECTED_PROMPTS_VERSION}, got ${PROMPTS.version}. ` +
        "Prompt drift may cause model failures. Update EXPECTED_PROMPTS_VERSION after validating."
    );
  }
}

export const WEBLLM_GROUPING_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
export const WEBLLM_GROUPING_CUSTOM_MODEL = "fhir4px-q4f16_1-MLC";
export const WEBLLM_GROUPING_FALLBACK_MODEL = "fhir4px-3b-q4f16_1-MLC";
const FHIR4PX_3B_MODEL_URL =
  "https://huggingface.co/joelmontavon/fhir4px-model-webllm/resolve/main/fhir4px-3b-q4f16_1-MLC/";
const FHIR4PX_3B_MODEL_LIB_URL =
  "https://huggingface.co/joelmontavon/fhir4px-model-webllm/resolve/main/libs/fhir4px-3b-q4f16_1-webgpu.wasm";
export const WEBLLM_GROUPING_Q4F32_1_MODEL = "fhir4px-q4f32_1-MLC";
const FHIR4PX_MODEL_URL = "https://huggingface.co/joelmontavon/fhir4px-model-webllm/resolve/main/fhir4px-q4f16_1-MLC/";
const FHIR4PX_MODEL_LIB_URL =
  "https://huggingface.co/joelmontavon/fhir4px-model-webllm/resolve/main/libs/fhir4px-q4f16_1-webgpu.wasm";
// q4f32_1 test variant: same 4-bit weights as q4f16_1 but with fp32 activations.
// Tests whether fp16 activations are degrading model behavior. Temporary.
// Activate via VITE_WEBLLM_USE_Q4F32_1_MODEL=1 in .env.local or:
//   sessionStorage.setItem("fhir4px_use_q4f32_1_webllm_model", "1")
// Needs ~1.5 GB VRAM.
const FHIR4PX_Q4F32_1_MODEL_URL =
  "https://huggingface.co/joelmontavon/fhir4px-model-webllm/resolve/main/fhir4px-q4f32_1-MLC/";
const FHIR4PX_Q4F32_1_MODEL_LIB_URL =
  "https://huggingface.co/joelmontavon/fhir4px-model-webllm/resolve/main/libs/fhir4px-q4f32_1-webgpu.wasm";
const DEFAULT_WEBLLM_TIMEOUT_MS = 120_000;
const DEFAULT_BATCH_SIZE = 6;
const DEFAULT_INCREMENTAL_NAMING_BATCH_SIZE = 3;
const MAX_INCREMENTAL_NAMING_BATCH_SIZE = 8;
const PROMPT_TOKEN_BUDGET = 2200;
const APPROX_CHARS_PER_TOKEN = 3.2;
const MAX_CONCEPT_TEXT_LENGTH = 500;
const MAX_CODING_DISPLAY_LENGTH = 350;
const MAX_DOSAGE_FORM_LENGTH = 120;
const MAX_ROUTE_LENGTH = 120;
const MAX_CODING_KEYS = 6;
const MAX_AVAILABLE_NAMES = 30;

export type ChatMessage = { role: "system" | "user"; content: string };
type ChatCompletionResponse = { choices?: Array<{ message?: { content?: string } }> };

interface WebLlmEngine {
  chat: {
    completions: {
      create(input: {
        messages: ChatMessage[];
        max_tokens?: number;
        temperature?: number;
        response_format?: {
          type: "json_object";
          schema?: string;
        };
      }): Promise<ChatCompletionResponse>;
    };
  };
}

interface WebLlmEngineState {
  engine: WebLlmEngine;
  modelId: string;
}

interface WebLlmDebugEntry {
  timestamp: string;
  phase: string;
  contentLength: number;
  excerpt: string;
  error?: string;
}

type WebLlmDebugWindow = Window & {
  __FHIR4PX_WEBLLM_DEBUG__?: WebLlmDebugEntry[];
};

type WebLlmLogLevel = "debug" | "info" | "warn" | "error";
export type WebLlmModelPreference = "one-b" | "three-b" | "custom" | "q4f32_1";
export type WebLlmNamingMode = "batch" | "single";
export const DEFAULT_WEBLLM_MODEL_PREFERENCE: WebLlmModelPreference = "three-b";

export interface WebLlmGroupingOptions {
  timeoutMs?: number;
  onProgress?: (message: string) => void;
  onDiagnostic?: (diagnostic: WebLlmDiagnostic) => void;
  namingBatchSize?: number;
  namingMode?: WebLlmNamingMode;
  modelPreference?: WebLlmModelPreference;
  initialAvailableNames?: string[];
}

export interface WebLlmDiagnostic {
  phase: string;
  message: string;
  modelId?: string;
  affectedRecordIds?: string[];
  affectedCount?: number;
  fallbackScope?: "single-concept" | "batch" | "resource-type";
  recovered?: boolean;
}

export interface WebLlmIncrementalGroupingUpdate {
  result: unknown;
  completedRecords: GroupableRecord[];
  pendingRecords: GroupableRecord[];
  completedCount: number;
  totalCount: number;
  batchIndex: number;
  batchCount: number;
}

export interface WebLlmPlaygroundCase {
  id: string;
  title: string;
  description: string;
  operationLabel: string;
  messages: ChatMessage[];
  schemaText: string;
  maxTokens: number;
}

export interface WebLlmPlaygroundRunResult {
  modelId: string;
  elapsedMs: number;
  rawContent: string;
  parsed: unknown;
  responseShape: string;
}

export interface ConditionAssociationChoice {
  conditionGroupId: string;
  name: string;
}

export interface WebLlmLabAssociationEvalCase {
  id: string;
  labName: string;
  labGroupId?: string;
  conditionChoices?: ConditionAssociationChoice[];
  referenceContext?: string[];
  userPayload?: unknown;
  messages?: ChatMessage[];
  schemaText?: string;
  expectedAcceptedConditionGroupIds?: string[];
}

export interface WebLlmLabAssociationEvalCaseResult {
  caseId: string;
  labName: string;
  modelId?: string;
  elapsedMs: number;
  rawContent?: string;
  parsed?: unknown;
  responseShape?: string;
  returnedAssociationCount: number;
  modelAssociations: Array<{
    conditionName: string;
    confidence: number;
    confidenceLabel: string | null;
    matchedConditionGroupId: string | null;
    matchRejectedReason: string | null;
    matchCount: number;
  }>;
  acceptedAssociations: LabConditionAssociation[];
  rejectedReasons: Record<string, number>;
  confidenceValues: number[];
  confidenceLabels: string[];
  conditionChoices: ConditionAssociationChoice[];
  expectedAcceptedConditionGroupIds?: string[];
  passed?: boolean;
  error?: string;
}

export interface WebLlmLabAssociationEvalSuiteRequest {
  systemPrompt?: string;
  userPromptTemplate?: unknown;
  messages?: ChatMessage[];
  schemaText?: string;
  operationLabel?: string;
  cases?: WebLlmLabAssociationEvalCase[];
  modelPreference?: WebLlmModelPreference;
  timeoutMs?: number;
  maxTokens?: number;
}

export interface WebLlmLabAssociationEvalSuiteResult {
  elapsedMs: number;
  caseCount: number;
  passedCount: number;
  failedCount: number;
  errorCount: number;
  results: WebLlmLabAssociationEvalCaseResult[];
}

export type WebLlmWarmupPhase = "idle" | "preparing" | "downloading" | "loading" | "ready" | "failed" | "skipped";

export interface WebLlmWarmupStatus {
  phase: WebLlmWarmupPhase;
  message?: string;
  progress?: number | null;
  reason?: string;
  modelId?: string;
  updatedAt: number;
}

let enginePromise: Promise<WebLlmEngineState> | null = null;
let enginePromiseKey: string | null = null;
let warmupStatus: WebLlmWarmupStatus = { phase: "idle", updatedAt: Date.now() };
const warmupListeners = new Set<(status: WebLlmWarmupStatus) => void>();

function appDataMessage(phase: WebLlmWarmupPhase, progress?: number | null): string | undefined {
  const percent = typeof progress === "number" ? ` ${Math.round(progress * 100)}%` : "";
  if (phase === "preparing") return "Preparing app...";
  if (phase === "downloading") return `Downloading app data...${percent}`;
  if (phase === "loading") return `Loading app data...${percent}`;
  return undefined;
}

function setWebLlmWarmupStatus(next: Omit<WebLlmWarmupStatus, "updatedAt">): void {
  warmupStatus = {
    ...next,
    message: next.message ?? appDataMessage(next.phase, next.progress),
    updatedAt: Date.now()
  };
  for (const listener of warmupListeners) listener(warmupStatus);
}

export function getWebLlmWarmupStatus(): WebLlmWarmupStatus {
  return warmupStatus;
}

export function subscribeWebLlmWarmupStatus(listener: (status: WebLlmWarmupStatus) => void): () => void {
  warmupListeners.add(listener);
  listener(warmupStatus);
  return () => warmupListeners.delete(listener);
}

function webLlmLog(level: WebLlmLogLevel, event: string, details: Record<string, unknown> = {}): void {
  if (typeof console === "undefined") return;
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    ...details
  };
  const prefix = `[fhir4px:webllm] ${event}`;
  let serialized = "";
  try {
    serialized = JSON.stringify(payload);
  } catch {
    serialized = JSON.stringify({ event, timestamp: payload.timestamp, serializationError: true });
  }
  if (typeof window !== "undefined") {
    const target = window as typeof window & { __FHIR4PX_WEBLLM_LOGS__?: string[] };
    target.__FHIR4PX_WEBLLM_LOGS__ = [...(target.__FHIR4PX_WEBLLM_LOGS__ ?? []), `${prefix} ${serialized}`].slice(-300);
  }
  if (level === "error") console.error(`${prefix} ${serialized}`);
  else if (level === "warn") console.warn(`${prefix} ${serialized}`);
  else if (level === "debug") console.debug(`${prefix} ${serialized}`);
  else console.info(`${prefix} ${serialized}`);
}

function envFlagEnabled(value: string | undefined): boolean {
  return /^(1|true|yes)$/i.test(value ?? "");
}

function envFlagDisabled(value: string | undefined): boolean {
  return /^(0|false|no)$/i.test(value ?? "");
}

function sessionFlagValue(name: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(name);
  } catch {
    return null;
  }
}

interface NamingResult {
  id: string;
  patientFriendlyName: string;
  observationBucket?: PatientObservationBucket;
  confidence: number;
  fallback: boolean;
}

const GROUPING_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["groups", "unassigned"],
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["groupId", "patientFriendlyName", "resourceIds", "resourceTypes", "confidence", "fallback"],
        properties: {
          groupId: { type: "string" },
          patientFriendlyName: { type: "string" },
          observationBucket: { enum: ["labs", "vitals", "other"] },
          resourceIds: {
            type: "array",
            items: { type: "string" }
          },
          resourceTypes: {
            type: "array",
            items: {
              enum: [
                "MedicationRequest",
                "AllergyIntolerance",
                "Condition",
                "Observation",
                "Immunization",
                "Encounter",
                "Procedure",
                "DiagnosticReport"
              ]
            }
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          fallback: { type: "boolean" }
        }
      }
    },
    unassigned: {
      type: "array",
      items: { type: "string" }
    }
  }
} as const;

const GROUPING_RESPONSE_SCHEMA_TEXT = JSON.stringify(GROUPING_RESPONSE_SCHEMA);

function uniqueAvailableNames(availableNames: string[]): string[] {
  return [...new Set(availableNames.map((name) => truncateText(name, 80)).filter(Boolean) as string[])];
}

function availableNameChoices(availableNames: string[]): string[] {
  return uniqueAvailableNames(availableNames).slice(-MAX_AVAILABLE_NAMES);
}

const AVAILABLE_NAME_STOP_WORDS = new Set([
  "and",
  "by",
  "for",
  "in",
  "of",
  "or",
  "the",
  "with",
  "lab",
  "labs",
  "laboratory",
  "level",
  "levels",
  "measurement",
  "panel",
  "result",
  "results",
  "test",
  "value",
  "values"
]);

function availableNameTokens(value: string): string[] {
  return canonicalName(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !AVAILABLE_NAME_STOP_WORDS.has(token));
}

function recordAvailableNameText(record: GroupableRecord): string {
  return [
    record.sourceLabel,
    record.groupingText,
    ...(record.codeTexts ?? []),
    ...(record.codeCodings ?? []).flatMap((coding) => [coding.code, coding.display]),
    record.category,
    record.categoryCode
  ]
    .filter(Boolean)
    .join(" ");
}

function tokensOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < 3 || right.length < 3) return false;
  return left.includes(right) || right.includes(left);
}

function availableNameRelevance(name: string, records: GroupableRecord[]): number {
  const nameTokens = availableNameTokens(name);
  if (nameTokens.length === 0) return 0;
  let score = 0;
  for (const record of records) {
    const text = recordAvailableNameText(record);
    const normalizedText = canonicalName(text);
    const recordTokens = availableNameTokens(text);
    if (normalizedText.includes(canonicalName(name))) score += 6;
    for (const nameToken of nameTokens) {
      if (recordTokens.some((recordToken) => tokensOverlap(nameToken, recordToken))) score += 2;
    }
  }
  return score;
}

function relevantAvailableNameChoices(records: GroupableRecord[], availableNames: string[]): string[] {
  const choices = uniqueAvailableNames(availableNames);
  if (records.length === 0 || choices.length <= MAX_AVAILABLE_NAMES) return choices;

  const scored = choices.map((name, index) => ({
    name,
    index,
    score: availableNameRelevance(name, records)
  }));
  const relevant = scored
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .slice(0, MAX_AVAILABLE_NAMES);

  if (relevant.length >= MAX_AVAILABLE_NAMES) return relevant.map((item) => item.name);

  const used = new Set(relevant.map((item) => item.name));
  const filler = scored
    .filter((item) => !used.has(item.name))
    .sort((left, right) => right.index - left.index)
    .slice(0, MAX_AVAILABLE_NAMES - relevant.length);

  return [...relevant, ...filler].map((item) => item.name);
}

function patientFriendlyNameSchema(availableNames: string[]) {
  const names = availableNameChoices(availableNames);
  return names.length
    ? {
        anyOf: [
          {
            enum: names
          },
          {
            type: "string",
            minLength: 1,
            maxLength: 80
          }
        ]
      }
    : {
        type: "string",
        minLength: 1,
        maxLength: 80
      };
}

function namingResponseSchemaText(availableNames: string[]): string {
  return JSON.stringify({
    type: "object",
    additionalProperties: false,
    required: ["patientFriendlyName", "confidence", "fallback"],
    properties: {
      patientFriendlyName: patientFriendlyNameSchema(availableNames),
      observationBucket: { enum: ["labs", "vitals", "other"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      fallback: { type: "boolean" }
    }
  });
}

function namingBatchResponseSchemaText(availableNames: string[]): string {
  return JSON.stringify({
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "patientFriendlyName", "confidence", "fallback"],
          properties: {
            id: { type: "string" },
            patientFriendlyName: patientFriendlyNameSchema(availableNames),
            observationBucket: { enum: ["labs", "vitals", "other"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            fallback: { type: "boolean" }
          }
        }
      }
    }
  });
}

const OBSERVATION_CATEGORY_GUIDE: Record<string, string> = {
  laboratory: "Lab result",
  exam: "Physical exam",
  therapy: "Therapy measurement",
  imaging: "Imaging finding",
  procedure: "Procedure finding",
  "vital-signs": "Vital sign",
  activity: "Activity or wellness measure"
};

const OBSERVATION_LABEL_HINTS: Record<string, string[]> = {
  laboratory: [
    "Hemoglobin A1c",
    "Glucose",
    "Creatinine",
    "eGFR",
    "LDL Cholesterol",
    "HDL Cholesterol",
    "Total Cholesterol",
    "Triglycerides",
    "Vitamin D",
    "TSH",
    "Hemoglobin",
    "White Blood Cell Count",
    "Platelet Count",
    "ALT",
    "AST",
    "Urine Protein"
  ],
  "vital-signs": [
    "Systolic Blood Pressure",
    "Diastolic Blood Pressure",
    "Heart Rate",
    "Respiratory Rate",
    "Temperature",
    "Oxygen Saturation",
    "Height",
    "Weight",
    "BMI"
  ],
  imaging: ["Ejection Fraction", "Imaging Results", "Ultrasound", "CT Scan", "MRI"],
  exam: ["Physical Exam", "Foot Exam", "Eye Exam"],
  activity: ["Steps", "Sleep", "Exercise"],
  therapy: ["Therapy Progress", "Nutrition", "Physical Therapy"],
  procedure: ["Procedure Findings", "Endoscopy Findings", "Cardiology Procedure Results"]
};

function normalizedCategoryCode(record: GroupableRecord): string | undefined {
  const raw = record.categoryCode || record.category;
  if (!raw) return undefined;
  const normalized = raw.toLowerCase().replace(/\s+/g, "-");
  if (normalized === "vital-signs" || normalized === "vital-sign") return "vital-signs";
  if (normalized === "laboratory" || normalized === "lab") return "laboratory";
  return normalized;
}

function observationBucketFromRecord(record: GroupableRecord): PatientObservationBucket | undefined {
  const category = normalizedCategoryCode(record);
  if (category === "laboratory") return "labs";
  if (category === "vital-signs") return "vitals";
  return category ? "other" : undefined;
}

function resourceGuidanceForRecords(records: GroupableRecord[]): unknown {
  const resourceTypes = new Set(records.map((record) => record.resourceType));
  if (resourceTypes.size !== 1) return undefined;
  const resourceType = records[0]?.resourceType;

  if (resourceType === "MedicationRequest") {
    return {
      medicationGrouping: [
        "Prefer ingredient plus route.",
        "Use ingredient only when route is missing.",
        "Use dosage form only as context; do not make it the grouping key unless the source has no ingredient or route."
      ],
      patientFriendlyNameSeeds: [
        "Metformin Oral",
        "Albuterol Inhaled",
        "Atorvastatin Oral",
        "Insulin Injection",
        "Eye Drops",
        "Topical Cream"
      ]
    };
  }

  if (resourceType === "Observation") {
    const categories = [...new Set(records.map(normalizedCategoryCode).filter((code): code is string => Boolean(code)))];
    return {
      observationGrouping: [
        "Use category only as context.",
        "Name the specific measurement, lab, finding, or activity.",
        "Do not infer a diagnosis, disease, body system, or treatment purpose from a lab or vital sign.",
        "Do not use broad names such as Vital Signs, Laboratory, Blood Sugar, Kidney Function, Cholesterol, or Liver Function unless the source concept is that broad.",
        "Group repeated measurements of the same specific code or concept across dates.",
        "Keep different vital signs separate.",
        "Keep different labs separate unless codes/displays clearly match."
      ],
      observationCategoryGuide: Object.fromEntries(
        categories
          .filter((category) => OBSERVATION_CATEGORY_GUIDE[category])
          .map((category) => [category, OBSERVATION_CATEGORY_GUIDE[category]])
      ),
      patientFriendlyNameSeeds: Object.fromEntries(
        categories
          .filter((category) => OBSERVATION_LABEL_HINTS[category])
          .map((category) => [category, OBSERVATION_LABEL_HINTS[category]])
      )
    };
  }

  if (resourceType === "Condition") {
    return {
      patientFriendlyNameSeeds: [
        "Type 2 Diabetes",
        "High Blood Pressure",
        "Asthma",
        "High Cholesterol",
        "Kidney Disease",
        "Anxiety",
        "Depression"
      ]
    };
  }

  if (resourceType === "Immunization") {
    return {
      immunizationGrouping: [
        "Group by vaccine family, not broad Vaccines.",
        "Use concept code, display, and text to normalize product names.",
        "Group repeated administrations of the same vaccine family across dates.",
        "MMR II and Measles, mumps and rubella virus vaccine -> MMR.",
        "DTaP and Diphtheria/tetanus/acellular pertussis -> DTaP."
      ],
      patientFriendlyNameSeeds: [
        "Flu",
        "COVID-19",
        "MMR",
        "DTaP",
        "Tetanus",
        "Hepatitis B",
        "Pneumococcal",
        "Shingles",
        "HPV"
      ]
    };
  }

  if (resourceType === "AllergyIntolerance") {
    return [
      "Resource-specific task: AllergyIntolerance grouping.",
      "For allergies and intolerances, classify by the substance or allergen name.",
      "Do not group by reaction, severity, date, or status.",
      "Allergy examples: Penicillin allergy -> Penicillin; Peanut allergy -> Peanut; Latex allergy -> Latex."
    ];
  }

  if (resourceType === "Encounter") {
    return {
      encounterGrouping: [
        "Group by visit type, encounter class, or explicit visit reason from the source concept.",
        "Do not infer diagnoses, care plans, or clinical conclusions from the visit.",
        "Keep office visits, emergency visits, hospital stays, telehealth visits, and procedure visits distinct when the source concept distinguishes them."
      ],
      patientFriendlyNameSeeds: [
        "Office Visit",
        "Emergency Visit",
        "Hospital Stay",
        "Telehealth Visit",
        "Urgent Care Visit",
        "Procedure Visit"
      ]
    };
  }

  if (resourceType === "Procedure") {
    return {
      procedureGrouping: [
        "Group by the specific procedure name from the source concept.",
        "Do not group by diagnosis, body system, date, status, performer, or encounter.",
        "Use concise patient-friendly procedure names."
      ],
      patientFriendlyNameSeeds: [
        "Colonoscopy",
        "Mammogram",
        "X-ray",
        "CT Scan",
        "MRI",
        "EKG",
        "Ultrasound",
        "Physical Therapy"
      ]
    };
  }

  if (resourceType === "DiagnosticReport") {
    return {
      diagnosticReportGrouping: [
        "Group by report type or panel/report name from the source concept.",
        "Do not group reports by individual Observation results unless the source report itself is that measurement.",
        "Keep imaging reports, lab panels, pathology reports, and procedure reports distinct when the source concept distinguishes them."
      ],
      patientFriendlyNameSeeds: [
        "Lab Report",
        "Imaging Report",
        "Pathology Report",
        "Radiology Report",
        "Microbiology Report"
      ]
    };
  }

  return undefined;
}

function resourceSpecificInstructions(resourceType: string): string[] {
  if (resourceType === "Observation") {
    return [
      "Resource-specific task: Observation grouping.",
      "For Observations, classify by the specific measured thing or finding, not by a disease or why the test may have been ordered.",
      "Observation group names should be measurements/findings such as Hemoglobin A1c, Glucose, LDL Cholesterol, Creatinine, Vitamin D, Weight, Systolic Blood Pressure, Diastolic Blood Pressure, or Oxygen Saturation.",
      "For each Observation naming result, include observationBucket as labs, vitals, or other.",
      "Use labs for lab-generated measurements, vitals for basic body function measurements, and other for imaging, procedures, exams, activity, therapy, surveys, or unclear concepts.",
      "Do not group Observations by diagnosis, disease, organ system, treatment purpose, or care program.",
      "For Observations, never output broad or diagnosis-style labels such as Type 2 Diabetes, Diabetes, Hypertension, Kidney Disease, Blood Sugar, Cholesterol, Vital Signs, or Laboratory unless that exact phrase is the input concept.",
      "Observation examples: 4548-4 Hemoglobin A1c/Hemoglobin.total in Blood -> Hemoglobin A1c; 76534-7 Systolic blood pressure by Noninvasive -> Systolic Blood Pressure; 8462-4 Diastolic blood pressure -> Diastolic Blood Pressure; 62292-8 25-hydroxyvitamin D -> Vitamin D; 2160-0 Creatinine [Mass/volume] in Serum or Plasma -> Creatinine."
    ];
  }

  if (resourceType === "Condition") {
    return [
      "Resource-specific task: Condition grouping.",
      "For Conditions, classify by patient-friendly diagnosis or problem name.",
      "Do not use lab-test, vital-sign, medication, or vaccine names as Condition group names.",
      "Condition examples: E11.65 Type 2 diabetes mellitus with hyperglycemia -> Type 2 Diabetes; I10 Essential hypertension -> High Blood Pressure; J45.909 Unspecified asthma, uncomplicated -> Asthma."
    ];
  }

  if (resourceType === "MedicationRequest") {
    return [
      "Resource-specific task: MedicationRequest grouping.",
      "For MedicationRequests, classify by medication ingredient plus route when available; otherwise use ingredient.",
      "Do not group medications by diagnosis, indication, instruction, dose strength, frequency, or date.",
      "Use dosage form only as context when ingredient or route is missing.",
      "Medication examples: Metformin with oral route -> Metformin Oral; Albuterol with inhaled route -> Albuterol Inhaled; Atorvastatin with oral route -> Atorvastatin Oral."
    ];
  }

  if (resourceType === "Immunization") {
    return [
      "Resource-specific task: Immunization grouping.",
      "For Immunizations, classify by vaccine family, not manufacturer, lot, date, or broad Vaccines.",
      "Immunization examples: MMR II and Measles, mumps and rubella virus vaccine -> MMR; DTaP and Diphtheria/tetanus/acellular pertussis -> DTaP; Influenza seasonal injectable -> Flu."
    ];
  }

  if (resourceType === "Encounter") {
    return [
      "Resource-specific task: Encounter grouping.",
      "For Encounters, classify by explicit visit type, encounter class, or source visit reason.",
      "Do not infer diagnosis or purpose beyond the source concept.",
      "Encounter examples: ambulatory office visit -> Office Visit; emergency department encounter -> Emergency Visit; virtual visit -> Telehealth Visit."
    ];
  }

  if (resourceType === "Procedure") {
    return [
      "Resource-specific task: Procedure grouping.",
      "For Procedures, classify by the specific procedure name.",
      "Do not group procedures by diagnosis, date, performer, status, or broad care category.",
      "Procedure examples: colonoscopy -> Colonoscopy; electrocardiogram -> EKG; computed tomography of chest -> Chest CT Scan."
    ];
  }

  if (resourceType === "DiagnosticReport") {
    return [
      "Resource-specific task: DiagnosticReport grouping.",
      "For DiagnosticReports, classify by explicit report or panel type.",
      "Do not collapse all reports into broad Reports unless the source concept is that broad.",
      "Do not use linked Observation values to rename a report unless the source report code itself represents that measurement."
    ];
  }

  return [
    "Apply resource-specific logic based on each record.resourceType.",
    "Do not group records from different resource types unless the input explicitly represents the same patient-facing concept."
  ];
}

export function browserCanAttemptWebLlm(): boolean {
  return typeof window !== "undefined" && "gpu" in navigator && !(navigator as Navigator & { webdriver?: boolean }).webdriver;
}

type NetworkInformationLike = {
  saveData?: boolean;
  effectiveType?: string;
};

export function shouldPreloadWebLlmGroupingModel(): { allowed: boolean; reason?: string } {
  if (!browserCanAttemptWebLlm()) return { allowed: false, reason: "WebGPU unavailable or automated browser" };
  const nav = navigator as Navigator & { connection?: NetworkInformationLike; deviceMemory?: number };
  if (nav.connection?.saveData) return { allowed: false, reason: "Data saver is enabled" };
  if (nav.connection?.effectiveType && ["slow-2g", "2g"].includes(nav.connection.effectiveType)) {
    return { allowed: false, reason: `Connection is ${nav.connection.effectiveType}` };
  }
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory < 4) {
    return { allowed: false, reason: "Device memory is below preload threshold" };
  }
  return { allowed: true };
}

export async function preloadWebLlmGroupingModel(): Promise<boolean> {
  const decision = shouldPreloadWebLlmGroupingModel();
  if (!decision.allowed) {
    setWebLlmWarmupStatus({ phase: "skipped", reason: decision.reason, progress: null });
    webLlmLog("warn", "preload-skipped", { reason: decision.reason });
    return false;
  }
  return warmWebLlmGroupingModel({ modelPreference: DEFAULT_WEBLLM_MODEL_PREFERENCE });
}

export async function warmWebLlmGroupingModel(options: WebLlmGroupingOptions = {}): Promise<boolean> {
  webLlmLog("info", "warm-start", { canAttemptWebGpu: browserCanAttemptWebLlm(), hasExistingEnginePromise: Boolean(enginePromise) });
  if (!browserCanAttemptWebLlm()) {
    setWebLlmWarmupStatus({ phase: "skipped", reason: "WebGPU unavailable or automated browser", progress: null });
    webLlmLog("warn", "warm-skipped", { reason: "WebGPU unavailable or webdriver browser" });
    return false;
  }
  try {
    const state = await getWebLlmEngine(options);
    setWebLlmWarmupStatus({ phase: "ready", modelId: state.modelId, progress: 1 });
    webLlmLog("info", "warm-success", { modelId: state.modelId });
    return true;
  } catch (error) {
    setWebLlmWarmupStatus({ phase: "failed", reason: errorMessage(error), progress: null });
    webLlmLog("warn", "warm-failed", { error: errorMessage(error) });
    return false;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function webLlmDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  return sessionFlagValue("fhir4px_debug_webllm") === "1";
}

function recordWebLlmDebug(phase: string, content: string, error?: unknown): void {
  if (typeof window === "undefined" || !webLlmDebugEnabled()) return;
  const entry: WebLlmDebugEntry = {
    timestamp: new Date().toISOString(),
    phase,
    contentLength: content.length,
    excerpt: content.replace(/\s+/g, " ").slice(0, 500),
    error: error ? errorMessage(error) : undefined
  };
  const target = window as WebLlmDebugWindow;
  target.__FHIR4PX_WEBLLM_DEBUG__ = [...(target.__FHIR4PX_WEBLLM_DEBUG__ ?? []), entry].slice(-20);
  console.debug("[fhir4px:webllm]", entry);
}

function webLlmFallbackModelsEnabled(): boolean {
  return (
    envFlagEnabled(import.meta.env.VITE_WEBLLM_ENABLE_FALLBACK_MODELS) ||
    sessionFlagValue("fhir4px_enable_webllm_fallback_models") === "1"
  );
}

function webLlmCustomModelEnabled(): boolean {
  if (envFlagDisabled(import.meta.env.VITE_WEBLLM_USE_CUSTOM_MODEL)) return false;
  const sessionFlag = sessionFlagValue("fhir4px_use_custom_webllm_model");
  if (sessionFlag === "0") return false;
  return (
    DEFAULT_WEBLLM_MODEL_PREFERENCE === "custom" ||
    envFlagEnabled(import.meta.env.VITE_WEBLLM_USE_CUSTOM_MODEL) ||
    sessionFlag === "1"
  );
}

function webLlmModelPreference(options: WebLlmGroupingOptions): WebLlmModelPreference {
  if (options.modelPreference) return options.modelPreference;
  if (q4f32_1ModelEnabled()) return "q4f32_1";
  return webLlmCustomModelEnabled() ? "custom" : "one-b";
}

function customWebLlmAppConfig() {
  return {
    model_list: [
      {
        model: FHIR4PX_MODEL_URL,
        model_id: WEBLLM_GROUPING_CUSTOM_MODEL,
        model_lib: FHIR4PX_MODEL_LIB_URL,
        vram_required_MB: 900,
        low_resource_required: true
      }
    ],
    cacheBackend: "indexeddb" as const
  };
}

function q4f32_1AppConfig() {
  return {
    model_list: [
      {
        model: FHIR4PX_Q4F32_1_MODEL_URL,
        model_id: WEBLLM_GROUPING_Q4F32_1_MODEL,
        model_lib: FHIR4PX_Q4F32_1_MODEL_LIB_URL,
        vram_required_MB: 1536,
        low_resource_required: false
      }
    ],
    cacheBackend: "indexeddb" as const
  };
}

function q4f32_1ModelEnabled(): boolean {
  if (envFlagEnabled(import.meta.env.VITE_WEBLLM_USE_Q4F32_1_MODEL)) return true;
  return sessionFlagValue("fhir4px_use_q4f32_1_webllm_model") === "1";
}

function webLlmCandidatePlan(options: WebLlmGroupingOptions): {
  preference: WebLlmModelPreference;
  engineKey: string;
  candidates: Array<{ modelId: string; engineConfig?: { appConfig: ReturnType<typeof customWebLlmAppConfig> } }>;
} {
  const preference = webLlmModelPreference(options);
  const genericCandidate = { modelId: WEBLLM_GROUPING_MODEL };
  function threeBAppConfig() {
    return {
      model_list: [
        {
          model: FHIR4PX_3B_MODEL_URL,
          model_id: WEBLLM_GROUPING_FALLBACK_MODEL,
          model_lib: FHIR4PX_3B_MODEL_LIB_URL,
          vram_required_MB: 3072,
          low_resource_required: false
        }
      ],
      cacheBackend: "indexeddb" as const
    };
  }

  const threeBCandidate = { modelId: WEBLLM_GROUPING_FALLBACK_MODEL, engineConfig: { appConfig: threeBAppConfig() } };
  const customCandidate = { modelId: WEBLLM_GROUPING_CUSTOM_MODEL, engineConfig: { appConfig: customWebLlmAppConfig() } };
  const q4f32_1Candidate = { modelId: WEBLLM_GROUPING_Q4F32_1_MODEL, engineConfig: { appConfig: q4f32_1AppConfig() } };
  const candidateList =
    preference === "q4f32_1"
      ? [q4f32_1Candidate]
      : preference === "custom"
        ? [customCandidate]
        : preference === "three-b"
          ? [threeBCandidate]
          : [genericCandidate];
  const seenCandidates = new Set<string>();
  const candidates = candidateList.filter((candidate) => {
    if (seenCandidates.has(candidate.modelId)) return false;
    seenCandidates.add(candidate.modelId);
    return true;
  });
  return {
    preference,
    engineKey: candidates.map((candidate) => candidate.modelId).join("|"),
    candidates
  };
}

function webLlmFlagSnapshot(): Record<string, unknown> {
  return {
    customModelEnabled: webLlmCustomModelEnabled(),
    customModelEnv: import.meta.env.VITE_WEBLLM_USE_CUSTOM_MODEL ?? "",
    customModelSession: sessionFlagValue("fhir4px_use_custom_webllm_model"),
    fallbackModelsEnabled: webLlmFallbackModelsEnabled(),
    fallbackModelsEnv: import.meta.env.VITE_WEBLLM_ENABLE_FALLBACK_MODELS ?? "",
    fallbackModelsSession: sessionFlagValue("fhir4px_enable_webllm_fallback_models"),
    responseDebugSession: sessionFlagValue("fhir4px_debug_webllm")
  };
}

function isContextWindowError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes("Prompt tokens exceed context window size") || message.includes("context window size");
}

function toError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(error ? String(error) : fallback);
}

function normalizeWebLlmError(error: unknown): Error {
  const message = errorMessage(error);
  if (
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed")
  ) {
    return new Error(
      "WebLLM did not load from the Vite dev server. Restart the dev server with `npm run dev -- --force` and hard-refresh the browser. Deterministic grouping is still available."
    );
  }
  if (message === "Failed to fetch" || message.includes("Failed to fetch")) {
    return new Error(
      "WebLLM model assets could not be fetched. Check internet access, browser blocking, and Hugging Face/CDN reachability. Deterministic grouping is still available."
    );
  }
  return toError(error, "Local grouping model failed to load");
}

function isWebLlmUnhandledRejection(reason: unknown): boolean {
  const message = errorMessage(reason);
  const stack = reason instanceof Error ? (reason.stack ?? "") : "";
  return (
    message.includes("BindingError") ||
    message.includes("Cannot pass non-string") ||
    message.includes("WebLLM") ||
    stack.includes("@mlc-ai") ||
    stack.includes("web-llm")
  );
}

function runBoundedWebLlmOperation<T>(
  operation: () => Promise<T>,
  options: { timeoutMs: number; timeoutMessage: string }
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      finish(false, new Error(options.timeoutMessage));
    }, options.timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutId);
      if (typeof window !== "undefined") window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };

    const finish = (ok: boolean, value: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (ok) resolve(value as T);
      else reject(toError(value, options.timeoutMessage));
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!isWebLlmUnhandledRejection(event.reason)) return;
      event.preventDefault();
      finish(false, event.reason);
    };

    if (typeof window !== "undefined") window.addEventListener("unhandledrejection", onUnhandledRejection);
    operation().then((value) => finish(true, value), (error) => finish(false, error));
  });
}

export async function getWebLlmEngine(options: WebLlmGroupingOptions = {}): Promise<WebLlmEngineState> {
  const modelPlan = webLlmCandidatePlan(options);
  if (enginePromise && enginePromiseKey !== modelPlan.engineKey) {
    webLlmLog("info", "engine-model-switch", {
      previousEngineKey: enginePromiseKey,
      nextEngineKey: modelPlan.engineKey,
      preference: modelPlan.preference
    });
    enginePromise = null;
  }
  webLlmLog("info", "engine-request", {
    hasExistingEnginePromise: Boolean(enginePromise),
    engineKey: modelPlan.engineKey,
    modelPreference: modelPlan.preference,
    canAttemptWebGpu: browserCanAttemptWebLlm(),
    ...webLlmFlagSnapshot()
  });
  if (enginePromise) return enginePromise;

  enginePromiseKey = modelPlan.engineKey;
  setWebLlmWarmupStatus({ phase: "preparing", progress: null });
  enginePromise = import("@mlc-ai/web-llm")
    .then(async (webllm) => {
      webLlmLog("info", "module-imported", webLlmFlagSnapshot());

      webLlmLog("info", "model-candidates", {
        candidates: modelPlan.candidates.map((candidate) => candidate.modelId),
        candidateCount: modelPlan.candidates.length,
        preference: modelPlan.preference,
        ignoredFallbackModel: webLlmFallbackModelsEnabled() ? WEBLLM_GROUPING_FALLBACK_MODEL : null,
        reasonFallbackIgnored: webLlmFallbackModelsEnabled()
          ? "Automatic 3B fallback is disabled so the 1B failure is visible."
          : null,
        ...webLlmFlagSnapshot()
      });
      let lastError: unknown;

      for (const [candidateIndex, { modelId, engineConfig }] of modelPlan.candidates.entries()) {
        const startedAt = performance.now();
        try {
          webLlmLog("info", "model-load-start", {
            modelId,
            candidateIndex: candidateIndex + 1,
            candidateCount: modelPlan.candidates.length,
            hasCustomEngineConfig: Boolean(engineConfig),
            timeoutMs: options.timeoutMs ?? DEFAULT_WEBLLM_TIMEOUT_MS
          });
          setWebLlmWarmupStatus({ phase: "loading", modelId, progress: null });
          options.onProgress?.(`Loading ${modelId}`);
          const engine = await runBoundedWebLlmOperation(
            () =>
              webllm.CreateMLCEngine(modelId, {
                ...engineConfig,
                initProgressCallback: (progress: { text?: string; progress?: number }) => {
                  const progressValue = typeof progress.progress === "number" ? progress.progress : null;
                  const phase = /fetch|download/i.test(progress.text ?? "") ? "downloading" : "loading";
                  const percent =
                    typeof progress.progress === "number" ? ` (${Math.round(progress.progress * 100)}%)` : "";
                  webLlmLog("info", "model-load-progress", {
                    modelId,
                    candidateIndex: candidateIndex + 1,
                    text: progress.text ?? `Loading ${modelId}`,
                    progress: typeof progress.progress === "number" ? progress.progress : null,
                    percent: typeof progress.progress === "number" ? Math.round(progress.progress * 100) : null
                  });
                  setWebLlmWarmupStatus({ phase, modelId, progress: progressValue });
                  options.onProgress?.(`${progress.text || `Loading ${modelId}`}${percent}`);
                }
              }),
            {
              timeoutMs: options.timeoutMs ?? DEFAULT_WEBLLM_TIMEOUT_MS,
              timeoutMessage: `Local grouping model did not finish loading within ${Math.round(
                (options.timeoutMs ?? DEFAULT_WEBLLM_TIMEOUT_MS) / 1000
              )} seconds`
            }
          );
          webLlmLog("info", "model-load-success", {
            modelId,
            candidateIndex: candidateIndex + 1,
            candidateCount: modelPlan.candidates.length,
            elapsedMs: Math.round(performance.now() - startedAt)
          });
          setWebLlmWarmupStatus({ phase: "ready", modelId, progress: 1 });
          return { engine: engine as unknown as WebLlmEngine, modelId };
        } catch (error) {
          lastError = error;
          webLlmLog("error", "model-load-failed", {
            modelId,
            candidateIndex: candidateIndex + 1,
            candidateCount: modelPlan.candidates.length,
            elapsedMs: Math.round(performance.now() - startedAt),
            error: errorMessage(error),
            willTryNextCandidate: candidateIndex + 1 < modelPlan.candidates.length,
            automatic3BFallbackDisabled: true,
            ...webLlmFlagSnapshot()
          });
          options.onProgress?.(`${modelId} unavailable`);
          if (errorMessage(error).includes("did not finish loading")) break;
        }
      }

      webLlmLog("error", "model-load-all-failed", {
        error: errorMessage(lastError),
        candidates: modelPlan.candidates.map((candidate) => candidate.modelId),
        automatic3BFallbackDisabled: true,
        ...webLlmFlagSnapshot()
      });
      throw toError(lastError, "Local grouping model failed to load");
    })
    .catch((error) => {
      enginePromise = null;
      enginePromiseKey = null;
      setWebLlmWarmupStatus({ phase: "failed", reason: errorMessage(error), progress: null });
      webLlmLog("error", "engine-request-failed", { error: errorMessage(error), ...webLlmFlagSnapshot() });
      throw normalizeWebLlmError(error);
    });
  return enginePromise;
}

function systemPrompt(resourceType: string): string {
  return [
    "Return only JSON for patient-friendly record grouping.",
    "Task: classification/label normalization only, not medical advice.",
    "Use only input facts. Do not create diagnoses, values, dates, statuses, instructions, risk, or next steps.",
    "Return group labels and input ids only; details stay linked to original records.",
    "Some ids are compact clusters. Treat each input id as one unit and return it exactly.",
    "Group only same patient-facing concepts. Do not group by date, status, category, or resource type alone.",
    "Use only concept text, coding code, and coding display. Category is context only.",
    "Use concise Title Case. Avoid acronyms unless common or source-provided.",
    "Acceptable acronyms: MMR, HPV, MRI, CT, BMI, COVID-19.",
    "If unsure, keep separate or mark fallback true.",
    `Resource type: ${resourceType}.`,
    ...resourceSpecificInstructions(resourceType),
    "Every resourceId must be copied exactly from an input record id."
  ].join("\n");
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function takeDefined<T>(values: T[] | undefined, maxLength: number): T[] | undefined {
  if (!values?.length) return undefined;
  const compact = [...new Set(values.filter(Boolean))].slice(0, maxLength);
  return compact.length ? compact : undefined;
}

function takeCodings(
  values: Array<{ code?: string; display?: string }> | undefined,
  maxLength: number
): Array<{ code?: string; display?: string }> | undefined {
  if (!values?.length) return undefined;
  const compact = [
    ...new Map(
      values
        .filter((coding) => coding.code || coding.display)
        .map((coding) => [
          `${coding.code ?? ""}|${coding.display ?? ""}`,
          removeUndefinedValues({
            code: truncateText(coding.code, 64),
            display: truncateText(coding.display, MAX_CODING_DISPLAY_LENGTH)
          })
        ])
    ).values()
  ].slice(0, maxLength);
  return compact.length ? compact : undefined;
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function promptRecord(record: GroupableRecord): Record<string, unknown> {
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
        ? removeUndefinedValues({
            text: conceptTexts,
            coding: conceptCodings
          })
        : removeUndefinedValues({
            text: [truncateText(record.sourceLabel, MAX_CONCEPT_TEXT_LENGTH)]
          }),
    ingredients: takeDefined(record.ingredients, 4),
    dosageForm: truncateText(record.dosageForm, MAX_DOSAGE_FORM_LENGTH),
    route: truncateText(record.route, MAX_ROUTE_LENGTH),
    categoryCode: record.categoryCode,
    resourceCount: record.resourceCount
  });
}

function userPrompt(records: GroupableRecord[]): string {
  return JSON.stringify({
    outputShape:
      "JSON object: groups[{groupId,patientFriendlyName,resourceIds,resourceTypes,confidence,fallback}], unassigned[]",
    resourceGuidance: resourceGuidanceForRecords(records),
    records: records.map(promptRecord)
  });
}

function estimatePromptTokens(records: GroupableRecord[]): number {
  const resourceType = [...new Set(records.map((record) => record.resourceType))].join(", ");
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(resourceType) },
    { role: "user", content: userPrompt(records) }
  ];
  const serializedLength = JSON.stringify(messages).length + GROUPING_RESPONSE_SCHEMA_TEXT.length;
  return Math.ceil(serializedLength / APPROX_CHARS_PER_TOKEN);
}

function completionRequest(messages: ChatMessage[], structured: boolean, schemaText = GROUPING_RESPONSE_SCHEMA_TEXT, maxTokens = 900) {
  return {
    messages,
    max_tokens: maxTokens,
    temperature: 0,
    ...(structured
      ? {
          response_format: {
            type: "json_object" as const,
            schema: schemaText
          }
        }
      : {})
  };
}

function extractBalancedJsonObject(content: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < content.length; index += 1) {
    const character = content[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }

  return null;
}

function parseJsonObjectResponse(content: string): unknown {
  let lastParseError: unknown;

  for (let start = content.indexOf("{"); start >= 0; start = content.indexOf("{", start + 1)) {
    const candidate = extractBalancedJsonObject(content, start);
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastParseError = error;
    }
  }

  recordWebLlmDebug("json-parse-failed", content, lastParseError);
  if (lastParseError instanceof Error) {
    throw new Error(`WebLLM response contained a JSON-like object that could not be parsed: ${lastParseError.message}`);
  }
  throw new Error(`WebLLM response did not contain a JSON object start token (${responseShape(content)})`);
}

function responseShape(content: string): string {
  const trimmed = content.trimStart();
  const first = trimmed[0] ? JSON.stringify(trimmed[0]) : "none";
  const flags = [
    trimmed.startsWith("```") ? "startsWithFence" : null,
    trimmed.startsWith("{") ? "startsWithObject" : null,
    content.includes("{") ? "containsObjectStart" : null
  ].filter(Boolean);
  return `responseLength=${content.length}, firstNonWhitespace=${first}${
    flags.length ? `, ${flags.join(", ")}` : ""
  }`;
}

function webLlmDebugHint(): string {
  return "For local response details, run sessionStorage.setItem('fhir4px_debug_webllm','1'), retry, then inspect window.__FHIR4PX_WEBLLM_DEBUG__.";
}

function diagnosticWebLlmError(params: {
  operationLabel: string;
  modelId: string;
  mode: "structured" | "retry";
  content?: string;
  error?: unknown;
}): Error {
  const detail = params.content ? responseShape(params.content) : errorMessage(params.error);
  return new Error(
    `WebLLM response was not usable JSON during ${params.operationLabel} (${params.mode} mode, model ${params.modelId}; ${detail}). ${webLlmDebugHint()}`
  );
}

function parseCompletionJson(
  completion: ChatCompletionResponse,
  request: {
    emptyMessage: string;
    operationLabel: string;
    modelId: string;
    mode: "structured" | "retry";
  }
): unknown {
  const content = completion.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(
      `${request.emptyMessage} (${request.operationLabel}, ${request.mode} mode, model ${request.modelId}). ${webLlmDebugHint()}`
    );
  }
  try {
    return parseJsonObjectResponse(content);
  } catch (error) {
    throw diagnosticWebLlmError({
      operationLabel: request.operationLabel,
      modelId: request.modelId,
      mode: request.mode,
      content,
      error
    });
  }
}

// One-shot diagnostic capture requested by the model team to debug the
// lab-condition abstention regression in the 3B model. Logs the verbatim
// system prompt, user payload, and JSON schema for the FIRST lab-condition
// association call in this session, gated to dev mode. Remove once the model
// team has captured their sample.
let labConditionDiagCaptured = false;

async function createJsonCompletionWithRetry(
  engine: WebLlmEngine,
  modelId: string,
  messages: ChatMessage[],
  options: WebLlmGroupingOptions,
  request: {
    operationLabel: string;
    schemaText: string;
    maxTokens: number;
    timeoutMs: number;
    timeoutMessage: string;
    emptyMessage: string;
    retryProgressMessage: string;
  }
): Promise<unknown> {
  const messageCharLengths = messages.map((message) => message.content.length);
  const requestStartedAt = performance.now();
  webLlmLog("info", "json-request-start", {
    operationLabel: request.operationLabel,
    modelId,
    structured: true,
    maxTokens: request.maxTokens,
    timeoutMs: request.timeoutMs,
    messageCount: messages.length,
    messageCharLengths,
    schemaLength: request.schemaText.length
  });
  recordWebLlmDebug(
    `request-${request.operationLabel}`,
    JSON.stringify({
      modelId,
      operationLabel: request.operationLabel,
      schema: request.schemaText,
      messages
    })
  );

  // One-shot DIAG capture for the model team (lab-condition abstention debug).
  if (
    import.meta.env.DEV &&
    !labConditionDiagCaptured &&
    request.operationLabel === "lab condition association"
  ) {
    labConditionDiagCaptured = true;
    const responseFormat = JSON.parse(request.schemaText);
    // eslint-disable-next-line no-console
    console.log("DIAG_SYSTEM", messages[0]?.content);
    // eslint-disable-next-line no-console
    console.log("DIAG_USER", messages[1]?.content);
    // eslint-disable-next-line no-console
    console.log("DIAG_SCHEMA", JSON.stringify(responseFormat));
    webLlmLog("info", "lab-condition-diag-captured", { modelId });
  }

  try {
    const completion = await runBoundedWebLlmOperation(
      () => engine.chat.completions.create(completionRequest(messages, true, request.schemaText, request.maxTokens)),
      {
        timeoutMs: request.timeoutMs,
        timeoutMessage: request.timeoutMessage
      }
    );
    webLlmLog("info", "json-response-received", {
      operationLabel: request.operationLabel,
      modelId,
      mode: "structured",
      elapsedMs: Math.round(performance.now() - requestStartedAt),
      responseShape: responseShape(completion.choices?.[0]?.message?.content ?? "")
    });
    return parseCompletionJson(completion, {
      emptyMessage: request.emptyMessage,
      operationLabel: request.operationLabel,
      modelId,
      mode: "structured"
    });
  } catch (error) {
    if (isContextWindowError(error)) throw error;
    webLlmLog("warn", "json-structured-failed", {
      operationLabel: request.operationLabel,
      modelId,
      elapsedMs: Math.round(performance.now() - requestStartedAt),
      error: errorMessage(error)
    });
    options.onDiagnostic?.({
      phase: request.operationLabel,
      modelId,
      recovered: true,
      message: `Structured output failed; retrying without response_format. ${errorMessage(error)}`
    });
    options.onProgress?.(`${request.retryProgressMessage} (${request.operationLabel}, model ${modelId})`);
    const retryStartedAt = performance.now();
    webLlmLog("info", "json-retry-start", {
      operationLabel: request.operationLabel,
      modelId,
      structured: false,
      maxTokens: request.maxTokens,
      timeoutMs: request.timeoutMs
    });
    const retry = await runBoundedWebLlmOperation(
      () => engine.chat.completions.create(completionRequest(messages, false, request.schemaText, request.maxTokens)),
      {
        timeoutMs: request.timeoutMs,
        timeoutMessage: request.timeoutMessage
      }
    );
    try {
      webLlmLog("info", "json-retry-response-received", {
        operationLabel: request.operationLabel,
        modelId,
        mode: "retry",
        elapsedMs: Math.round(performance.now() - retryStartedAt),
        responseShape: responseShape(retry.choices?.[0]?.message?.content ?? "")
      });
      return parseCompletionJson(retry, {
        emptyMessage: request.emptyMessage,
        operationLabel: request.operationLabel,
        modelId,
        mode: "retry"
      });
    } catch (retryError) {
      webLlmLog("error", "json-retry-failed", {
        operationLabel: request.operationLabel,
        modelId,
        elapsedMs: Math.round(performance.now() - retryStartedAt),
        error: errorMessage(retryError)
      });
      options.onDiagnostic?.({
        phase: request.operationLabel,
        modelId,
        recovered: true,
        message: `Retry output was still not usable JSON. ${errorMessage(retryError)}`
      });
      throw new Error(
        `WebLLM could not produce usable JSON after structured and retry attempts for ${request.operationLabel} with model ${modelId}. Latest failure: ${errorMessage(
          retryError
        )} First failure: ${errorMessage(error)}`
      );
    }
  }
}

export async function runStructuredWebLlmPlayground(
  request: {
    operationLabel: string;
    messages: ChatMessage[];
    schemaText: string;
    maxTokens: number;
    timeoutMs?: number;
  },
  options: WebLlmGroupingOptions = {}
): Promise<WebLlmPlaygroundRunResult> {
  const { engine, modelId } = await getWebLlmEngine(options);
  const startedAt = performance.now();
  const timeoutMs = request.timeoutMs ?? Math.min(options.timeoutMs ?? DEFAULT_WEBLLM_TIMEOUT_MS, 60_000);

  webLlmLog("info", "playground-request-start", {
    operationLabel: request.operationLabel,
    modelId,
    maxTokens: request.maxTokens,
    timeoutMs,
    messageCount: request.messages.length,
    messageCharLengths: request.messages.map((message) => message.content.length),
    schemaLength: request.schemaText.length
  });

  const completion = await runBoundedWebLlmOperation(
    () => engine.chat.completions.create(completionRequest(request.messages, true, request.schemaText, request.maxTokens)),
    {
      timeoutMs,
      timeoutMessage: `Local model did not finish ${request.operationLabel} within ${Math.round(timeoutMs / 1000)} seconds`
    }
  );
  const rawContent = completion.choices?.[0]?.message?.content ?? "";
  const parsed = parseJsonObjectResponse(rawContent);
  const elapsedMs = Math.round(performance.now() - startedAt);

  webLlmLog("info", "playground-request-complete", {
    operationLabel: request.operationLabel,
    modelId,
    elapsedMs,
    responseShape: responseShape(rawContent)
  });

  return {
    modelId,
    elapsedMs,
    rawContent,
    parsed,
    responseShape: responseShape(rawContent)
  };
}

export async function groupWithWebLlm(records: GroupableRecord[], options: WebLlmGroupingOptions = {}): Promise<unknown> {
  if (records.length === 0) return { groups: [], unassigned: [] };
  const { engine, modelId } = await getWebLlmEngine(options);
  const resourceType = [...new Set(records.map((record) => record.resourceType))].join(", ");
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(resourceType) },
    { role: "user", content: userPrompt(records) }
  ];
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_WEBLLM_TIMEOUT_MS, 60_000);
  return createJsonCompletionWithRetry(engine, modelId, messages, options, {
    operationLabel: "grouping",
    schemaText: GROUPING_RESPONSE_SCHEMA_TEXT,
    maxTokens: 900,
    timeoutMs,
    timeoutMessage: "Local grouping model did not finish grouping within 60 seconds",
    emptyMessage: "WebLLM returned an empty grouping response",
    retryProgressMessage: "Structured local output unavailable; retrying JSON output"
  });
}

const ALLERGY_CLASSIFICATION_SCHEMA_TEXT = JSON.stringify({
  type: "object",
  additionalProperties: false,
  required: ["assertionType", "allergyDomain", "confidence", "fallback"],
  properties: {
    assertionType: { enum: ["specific_allergy", "negative_assertion", "unknown"] },
    allergyDomain: { enum: ["generic", "drug", "food", "environmental", "latex", "other", "unknown"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    fallback: { type: "boolean" }
  }
});

const ENCOUNTER_VISIT_CLASSIFICATION_SCHEMA_TEXT = JSON.stringify({
  type: "object",
  additionalProperties: false,
  required: ["visitClass", "confidence", "fallback"],
  properties: {
    visitClass: {
      enum: ["inpatient", "outpatient", "emergency", "urgent_care", "telehealth", "procedure", "home_health", "other", "unknown"]
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    fallback: { type: "boolean" }
  }
});

const OBSERVATION_CATEGORY_CLASSIFICATION_SCHEMA_TEXT = JSON.stringify({
  type: "object",
  additionalProperties: false,
  required: ["observationCategory", "confidence", "fallback"],
  properties: {
    observationCategory: { enum: ["labs", "vitals", "other", "unknown"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    fallback: { type: "boolean" }
  }
});

const NO_DIRECT_CONDITION_ASSOCIATION_ID = "__none__";
const LAB_CONDITION_CONFIDENCE_LABELS = ["high", "medium", "low"] as const;
type LabConditionConfidenceLabel = (typeof LAB_CONDITION_CONFIDENCE_LABELS)[number];
export const LAB_CONDITION_SYSTEM_PROMPT_OVERRIDE_KEY = "fhir4px_webllm_lab_condition_system_prompt";
export const LAB_CONDITION_USER_PAYLOAD_OVERRIDE_KEY = "fhir4px_webllm_lab_condition_user_payload";

function labConditionTargetSchemaText(conditionChoices: ConditionAssociationChoice[] = []): string {
  const seenConditionNames = new Set<string>();
  const conditionChoiceNames = conditionChoices
    .map((choice) => (typeof choice.name === "string" ? choice.name.trim() : ""))
    .filter((choice) => choice.length > 0)
    .filter((choice) => {
      const normalized = canonicalName(choice);
      if (seenConditionNames.has(normalized)) return false;
      seenConditionNames.add(normalized);
      return true;
    })
    .slice(0, MAX_AVAILABLE_NAMES);
  return JSON.stringify({
    type: "object",
    additionalProperties: false,
    required: ["associations"],
    properties: {
      associations: {
        type: "array",
        maxItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["conditionName", "confidence"],
          properties: {
            conditionName: {
              type: "string",
              enum: conditionChoiceNames,
              description: "Exact name of the selected condition from conditionChoices."
            },
            confidence: {
              enum: Array.from(LAB_CONDITION_CONFIDENCE_LABELS),
              description: "Categorical association strength: high, medium, or low."
            }
          }
        }
      },
    }
  });
}

function classificationSystemPrompt(task: "allergy" | "encounter" | "observation"): string {
  const common = [
    "Return only JSON for one local classification.",
    "Task: classification only, not medical advice.",
    "Use only input code, display, text, category, class, and source label facts.",
    "Do not create diagnoses, recommendations, treatments, status changes, risk, or next steps.",
    "If unsure, choose unknown and set fallback true."
  ];

  if (task === "allergy") {
    return [
      ...common,
      "Classify AllergyIntolerance as a negative assertion or a specific allergy.",
      "Negative assertion examples: no known allergies, no known allergy, NKA, no known drug allergies, NKDA, no known food allergies.",
      "Domain rules: generic means all allergy domains; drug means medication/drug allergy; food means food allergy; environmental means pollen/dust/mold/animal/seasonal; latex means latex.",
      "Specific allergy examples: Penicillin -> drug; Peanut -> food; Pollen -> environmental; Latex -> latex."
    ].join("\n");
  }

  if (task === "encounter") {
    return [
      ...common,
      "Classify Encounter visit class as inpatient, outpatient, emergency, urgent_care, telehealth, procedure, home_health, other, or unknown.",
      "Prefer explicit Encounter.class/category/code text.",
      "Examples: ambulatory or office visit -> outpatient; IMP or hospital stay -> inpatient; emergency or ED -> emergency; virtual/video/telephone -> telehealth."
    ].join("\n");
  }

  return [
    ...common,
    "Classify Observation category as labs, vitals, other, or unknown.",
    "Align with FHIR R4 Observation.category where available: laboratory -> labs; vital-signs -> vitals; all other FHIR observation categories -> other.",
    "Use labs for lab-generated measurements, vitals for body function measurements, and other for imaging, procedure, exam, therapy, activity, survey, social-history, or unclear concepts."
  ].join("\n");
}

function classificationUserPrompt(record: GroupableRecord): string {
  return JSON.stringify({
    outputShape: "JSON object matching the schema.",
    record: promptRecord(record)
  });
}

type LabConditionPromptUserPatch = {
  outputShape?: string;
  measurement?: {
    groupId?: string;
    name?: string;
  };
  lab?: {
    labGroupId?: string;
    name?: string;
  };
  conditionChoices?: {
    conditionGroupId: string;
    name: string;
  }[];
  referenceContext?: string[];
  noDirectAssociationId?: string;
  [key: string]: unknown;
};

function labConditionTargetSystemPrompt(): string {
  const override = sessionFlagValue(LAB_CONDITION_SYSTEM_PROMPT_OVERRIDE_KEY);
  if (override) return override;
  return PROMPTS.tasks.lab_condition_association.system_prompt;
}

function labConditionTargetUserPrompt(params: {
  labGroup: PatientFriendlyGroup;
  explicitRelatedContext?: string[];
  conditionChoices?: ConditionAssociationChoice[];
}): string {
  const patchedRaw = sessionFlagValue(LAB_CONDITION_USER_PAYLOAD_OVERRIDE_KEY);
  const patch: LabConditionPromptUserPatch =
    (() => {
      if (!patchedRaw) return {};
      try {
        const parsed = JSON.parse(patchedRaw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as LabConditionPromptUserPatch;
      } catch {
        // ignore invalid patch payloads to keep behavior stable while debugging
      }
      return {};
    })();
  const message: {
    outputShape: string;
    measurement: {
      groupId: string;
      name: string;
    };
    conditionChoices?: { conditionGroupId: string; name: string }[];
    referenceContext: string[];
  } = {
    outputShape:
      PROMPTS.tasks.lab_condition_association.output_shape,
    measurement: {
      groupId: params.labGroup.groupId,
      name: params.labGroup.patientFriendlyName
    },
    referenceContext: (params.explicitRelatedContext ?? []).slice(0, 8)
  };

  if (params.conditionChoices && params.conditionChoices.length > 0) {
    message.conditionChoices = params.conditionChoices.map((choice) => ({
      conditionGroupId: choice.conditionGroupId,
      name: choice.name
    }));
  }

  const legacyPatchedMeasurement =
    patch.lab && typeof patch.lab === "object"
      ? {
          groupId: patch.lab.labGroupId,
          name: patch.lab.name
        }
      : {};
  const patchedMeasurement =
    (patch.measurement && typeof patch.measurement === "object") || Object.keys(legacyPatchedMeasurement).length > 0
      ? {
          ...message.measurement,
          ...legacyPatchedMeasurement,
          ...patch.measurement
        }
      : message.measurement;
  const patchedReferenceContext = Array.isArray(patch.referenceContext)
    ? patch.referenceContext.slice(0, 8).map((entry) => String(entry))
    : message.referenceContext;

  const patchedConditionChoices =
    Array.isArray(patch.conditionChoices) && patch.conditionChoices.length > 0
      ? patch.conditionChoices
      : message.conditionChoices;

  return JSON.stringify({
    ...message,
    ...patch,
    measurement: patchedMeasurement,
    referenceContext: patchedReferenceContext,
    conditionChoices: patchedConditionChoices
  });
}

function boundedConfidence(value: unknown, fallback = 0.5): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function labConditionConfidenceLabel(value: unknown): LabConditionConfidenceLabel | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return (LAB_CONDITION_CONFIDENCE_LABELS as readonly string[]).includes(normalized)
    ? (normalized as LabConditionConfidenceLabel)
    : undefined;
}

function labConditionConfidenceScore(label: LabConditionConfidenceLabel): number {
  if (label === "high") return 0.95;
  if (label === "medium") return 0.7;
  return 0.4;
}

function parsedLabConditionConfidence(value: unknown): { label?: LabConditionConfidenceLabel; score: number } {
  const label = labConditionConfidenceLabel(value);
  if (label) return { label, score: labConditionConfidenceScore(label) };

  const score = boundedConfidence(value, 0);
  if (score >= 0.9) return { label: "high", score };
  if (score >= 0.5) return { label: "medium", score };
  if (score > 0) return { label: "low", score };
  return { score: 0 };
}

function parsedString<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const GENERIC_CONDITION_NAME_TOKENS = new Set([
  "condition",
  "conditions",
  "disease",
  "diseases",
  "disorder",
  "disorders",
  "syndrome",
  "syndromes",
  "management",
  "monitoring",
  "marker",
  "markers",
  "test",
  "tests",
  "lab",
  "labs",
  "level",
  "levels",
  "panel",
  "function",
  "status"
]);

const CONDITION_NAME_SYNONYM_SETS = [
  ["diabetes", "diabetic"],
  ["hypertension", "high blood pressure", "blood pressure"],
  ["thyroid disease", "thyroid"],
  ["kidney disease", "renal disease", "kidney", "renal"],
  ["lipid disorder", "hyperlipidemia", "dyslipidemia", "cholesterol", "lipid", "triglyceride"],
  ["vitamin d deficiency", "vitamin d"],
  ["anticoagulation management", "anticoagulation", "inr"]
];

function conditionMatchTokens(value: string): string[] {
  return canonicalName(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !GENERIC_CONDITION_NAME_TOKENS.has(token));
}

function conditionNameSynonymMatch(target: string, choice: string): boolean {
  return CONDITION_NAME_SYNONYM_SETS.some((set) => {
    const targetMatched = set.some((term) => target === term || target.includes(term) || term.includes(target));
    if (!targetMatched) return false;
    return set.some((term) => choice === term || choice.includes(term) || term.includes(choice));
  });
}

function targetConditionMatchesChoice(targetConditionName: string, choiceName: string): boolean {
  const target = canonicalName(targetConditionName);
  const choice = canonicalName(choiceName);
  if (!target || !choice) return false;
  if (target === choice || choice.includes(target) || target.includes(choice)) return true;
  if (conditionNameSynonymMatch(target, choice)) return true;

  const targetTokens = conditionMatchTokens(target);
  const choiceTokens = new Set(conditionMatchTokens(choice));
  if (targetTokens.length === 0 || choiceTokens.size === 0) return false;
  const overlapCount = targetTokens.filter((token) => choiceTokens.has(token)).length;
  if (overlapCount === 0) return false;
  if (targetTokens.length === 1) return true;
  if (overlapCount === targetTokens.length) return true;
  return overlapCount >= 1 && targetTokens.some((token) => token.length >= 7);
}

function matchedConditionChoiceForTarget(
  targetConditionName: string,
  choices: ConditionAssociationChoice[]
): { choice?: ConditionAssociationChoice; rejectedReason?: string; matchCount: number } {
  const target = targetConditionName.trim();
  if (!target || canonicalName(target) === canonicalName(NO_DIRECT_CONDITION_ASSOCIATION_ID)) {
    return { rejectedReason: "no_direct_target", matchCount: 0 };
  }

  const matches = choices.filter((choice) => targetConditionMatchesChoice(target, choice.name));
  if (matches.length === 1) return { choice: matches[0], matchCount: 1 };
  if (matches.length > 1) return { rejectedReason: "ambiguous_target_match", matchCount: matches.length };
  return { rejectedReason: "target_not_in_patient_conditions", matchCount: 0 };
}

type LabConditionAssociationParsedResponse = {
  associations?: unknown;
  targetConditionName?: unknown;
  confidence?: unknown;
  fallback?: unknown;
};

function rawLabConditionAssociations(parsed: LabConditionAssociationParsedResponse): unknown[] {
  if (Array.isArray(parsed.associations)) return parsed.associations;
  if (typeof parsed.targetConditionName === "string") {
    return [
      {
        conditionName: parsed.targetConditionName,
        confidence: parsed.confidence,
        fallback: parsed.fallback
      }
    ];
  }
  return [];
}

function summarizeLabConditionAssociationResponse(
  parsed: LabConditionAssociationParsedResponse,
  conditionChoices: ConditionAssociationChoice[]
): {
  rawAssociations: unknown[];
  accepted: LabConditionAssociation[];
  rejectedReasons: Record<string, number>;
  confidenceValues: number[];
  confidenceLabels: string[];
  modelAssociations: WebLlmLabAssociationEvalCaseResult["modelAssociations"];
} {
  const accepted: LabConditionAssociation[] = [];
  const rejectedReasons: Record<string, number> = {};
  const confidenceValues: number[] = [];
  const confidenceLabels: string[] = [];
  const modelAssociations: WebLlmLabAssociationEvalCaseResult["modelAssociations"] = [];
  const increment = (bucket: Record<string, number>, key: string) => {
    bucket[key] = (bucket[key] ?? 0) + 1;
  };

  const rawAssociations = rawLabConditionAssociations(parsed);
  for (const rawAssociation of rawAssociations.slice(0, 1)) {
    if (!rawAssociation || typeof rawAssociation !== "object" || Array.isArray(rawAssociation)) {
      increment(rejectedReasons, "invalid_association");
      continue;
    }

    const item = rawAssociation as {
      conditionName?: unknown;
      confidence?: unknown;
      fallback?: unknown;
    };
    const conditionName = typeof item.conditionName === "string" ? item.conditionName.trim() : "";
    const confidence = parsedLabConditionConfidence(item.confidence);
    const match = matchedConditionChoiceForTarget(conditionName, conditionChoices);

    confidenceValues.push(confidence.score);
    confidenceLabels.push(confidence.label ?? "none");
    modelAssociations.push({
      conditionName,
      confidence: confidence.score,
      confidenceLabel: confidence.label ?? null,
      matchedConditionGroupId: match.choice?.conditionGroupId ?? null,
      matchRejectedReason: match.choice ? null : (match.rejectedReason ?? "target_not_in_patient_conditions"),
      matchCount: match.matchCount
    });

    if (confidence.label !== "high" || !match.choice) {
      increment(
        rejectedReasons,
        !match.choice ? (match.rejectedReason ?? "target_not_in_patient_conditions") : "not_high_confidence"
      );
      continue;
    }

    accepted.push({
      conditionGroupId: match.choice.conditionGroupId,
      relationship: "monitoring_marker",
      confidence: confidence.score,
      fallback: false
    });
  }

  return {
    rawAssociations,
    accepted,
    rejectedReasons,
    confidenceValues,
    confidenceLabels,
    modelAssociations
  };
}

export async function classifyAllergyWithWebLlm(
  record: GroupableRecord,
  options: WebLlmGroupingOptions = {}
): Promise<AllergyClassification> {
  const { engine, modelId } = await getWebLlmEngine(options);
  const parsed = await createJsonCompletionWithRetry(
    engine,
    modelId,
    [
      { role: "system", content: classificationSystemPrompt("allergy") },
      { role: "user", content: classificationUserPrompt(record) }
    ],
    options,
    {
      operationLabel: "allergy classification",
      schemaText: ALLERGY_CLASSIFICATION_SCHEMA_TEXT,
      maxTokens: 120,
      timeoutMs: Math.min(options.timeoutMs ?? DEFAULT_WEBLLM_TIMEOUT_MS, 45_000),
      timeoutMessage: "Local model did not finish allergy classification within 45 seconds",
      emptyMessage: "WebLLM returned an empty allergy classification response",
      retryProgressMessage: "Structured local allergy classification unavailable; retrying JSON output"
    }
  ) as {
    assertionType?: unknown;
    allergyDomain?: unknown;
    confidence?: unknown;
    fallback?: unknown;
  };

  return {
    assertionType: parsedString<AllergyAssertionType>(
      parsed.assertionType,
      ["specific_allergy", "negative_assertion", "unknown"],
      "unknown"
    ),
    allergyDomain: parsedString<AllergyDomain>(
      parsed.allergyDomain,
      ["generic", "drug", "food", "environmental", "latex", "other", "unknown"],
      "unknown"
    ),
    confidence: boundedConfidence(parsed.confidence),
    fallback: Boolean(parsed.fallback),
    source: "local_model"
  };
}

export async function classifyEncounterVisitWithWebLlm(
  record: GroupableRecord,
  options: WebLlmGroupingOptions = {}
): Promise<EncounterVisitClassification> {
  const { engine, modelId } = await getWebLlmEngine(options);
  const parsed = await createJsonCompletionWithRetry(
    engine,
    modelId,
    [
      { role: "system", content: classificationSystemPrompt("encounter") },
      { role: "user", content: classificationUserPrompt(record) }
    ],
    options,
    {
      operationLabel: "encounter visit classification",
      schemaText: ENCOUNTER_VISIT_CLASSIFICATION_SCHEMA_TEXT,
      maxTokens: 90,
      timeoutMs: Math.min(options.timeoutMs ?? DEFAULT_WEBLLM_TIMEOUT_MS, 45_000),
      timeoutMessage: "Local model did not finish visit classification within 45 seconds",
      emptyMessage: "WebLLM returned an empty visit classification response",
      retryProgressMessage: "Structured local visit classification unavailable; retrying JSON output"
    }
  ) as {
    visitClass?: unknown;
    confidence?: unknown;
    fallback?: unknown;
  };

  return {
    visitClass: parsedString<EncounterVisitClass>(
      parsed.visitClass,
      ["inpatient", "outpatient", "emergency", "urgent_care", "telehealth", "procedure", "home_health", "other", "unknown"],
      "unknown"
    ),
    confidence: boundedConfidence(parsed.confidence),
    fallback: Boolean(parsed.fallback),
    source: "local_model"
  };
}

export async function classifyObservationCategoryWithWebLlm(
  record: GroupableRecord,
  options: WebLlmGroupingOptions = {}
): Promise<ObservationCategoryClassification> {
  const { engine, modelId } = await getWebLlmEngine(options);
  const parsed = await createJsonCompletionWithRetry(
    engine,
    modelId,
    [
      { role: "system", content: classificationSystemPrompt("observation") },
      { role: "user", content: classificationUserPrompt(record) }
    ],
    options,
    {
      operationLabel: "observation category classification",
      schemaText: OBSERVATION_CATEGORY_CLASSIFICATION_SCHEMA_TEXT,
      maxTokens: 90,
      timeoutMs: Math.min(options.timeoutMs ?? DEFAULT_WEBLLM_TIMEOUT_MS, 45_000),
      timeoutMessage: "Local model did not finish observation category classification within 45 seconds",
      emptyMessage: "WebLLM returned an empty observation category classification response",
      retryProgressMessage: "Structured local observation category classification unavailable; retrying JSON output"
    }
  ) as {
    observationCategory?: unknown;
    confidence?: unknown;
    fallback?: unknown;
  };

  return {
    observationCategory: parsedString<PatientObservationBucket | "unknown">(
      parsed.observationCategory,
      ["labs", "vitals", "other", "unknown"],
      "unknown"
    ),
    confidence: boundedConfidence(parsed.confidence),
    fallback: Boolean(parsed.fallback),
    source: "local_model"
  };
}

export async function associateLabGroupWithConditionsWithWebLlm(
  labGroup: PatientFriendlyGroup,
  _labRecords: GroupableRecord[],
  conditionChoices: ConditionAssociationChoice[],
  options: WebLlmGroupingOptions = {},
  context: { explicitRelatedContext?: string[] } = {}
): Promise<LabConditionAssociation[]> {
  if (conditionChoices.length === 0) return [];
  const promptConditionChoices = conditionChoices.slice(0, MAX_AVAILABLE_NAMES);
  const explicitRelatedContext = context.explicitRelatedContext ?? [];
  const { engine, modelId } = await getWebLlmEngine(options);
  const parsed = await createJsonCompletionWithRetry(
    engine,
    modelId,
    [
      { role: "system", content: labConditionTargetSystemPrompt() },
      {
        role: "user",
        content: labConditionTargetUserPrompt({
          labGroup,
          explicitRelatedContext,
          conditionChoices: promptConditionChoices
        })
      }
    ],
    options,
    {
      operationLabel: "lab condition association",
      schemaText: labConditionTargetSchemaText(promptConditionChoices),
      maxTokens: 180,
      timeoutMs: Math.min(options.timeoutMs ?? DEFAULT_WEBLLM_TIMEOUT_MS, 45_000),
      timeoutMessage: "Local model did not finish lab-condition association within 45 seconds",
      emptyMessage: "WebLLM returned an empty lab-condition association response",
      retryProgressMessage: "Structured local lab-condition association unavailable; retrying JSON output"
    }
  ) as {
    associations?: unknown;
    targetConditionName?: unknown;
    confidence?: unknown;
    fallback?: unknown;
  };

  const summary = summarizeLabConditionAssociationResponse(parsed, promptConditionChoices);

  webLlmLog("info", "lab-condition-association-result", {
    labGroupId: labGroup.groupId,
    labName: labGroup.patientFriendlyName,
    returnedAssociationCount: summary.rawAssociations.length,
    modelAssociations: summary.modelAssociations,
    referenceContext: explicitRelatedContext,
    rawAssociationCount: summary.rawAssociations.length,
    acceptedAssociationCount: summary.accepted.length,
    rejectedReasons: summary.rejectedReasons,
    confidenceValues: summary.confidenceValues,
    confidenceLabels: summary.confidenceLabels,
    conditionChoices: promptConditionChoices,
    acceptedConditionGroupIds: summary.accepted.map((association) => association.conditionGroupId)
  });

  return summary.accepted;
}

const JORDAN_LAB_EVAL_CONDITION_CHOICES: ConditionAssociationChoice[] = [
  {
    conditionGroupId: "Condition:condition-diabetes-type-2",
    name: "Diabetes Type 2"
  },
  {
    conditionGroupId: "Condition:condition-high-blood-pressure",
    name: "High Blood Pressure"
  }
];

function jordanLabEvalCase(params: {
  id: string;
  labName: string;
  referenceContext?: string[];
  expectedAcceptedConditionGroupIds?: string[];
}): WebLlmLabAssociationEvalCase {
  return {
    id: params.id,
    labName: params.labName,
    labGroupId: `eval:${params.id}`,
    conditionChoices: JORDAN_LAB_EVAL_CONDITION_CHOICES,
    referenceContext: params.referenceContext ?? [],
    expectedAcceptedConditionGroupIds: params.expectedAcceptedConditionGroupIds ?? []
  };
}

export function webLlmLabAssociationEvalCases(): WebLlmLabAssociationEvalCase[] {
  return [
    jordanLabEvalCase({
      id: "jordan-a1c-reference-context",
      labName: "Hemoglobin A1c/Hemoglobin.Total",
      referenceContext: [
        "Referenced condition candidate: Diabetes Type 2",
        "Observed during visit: Medication Review",
        "Report result: Diabetes Monitoring Report"
      ],
      expectedAcceptedConditionGroupIds: ["Condition:condition-diabetes-type-2"]
    }),
    jordanLabEvalCase({
      id: "jordan-blood-glucose-lab",
      labName: "Blood glucose lab",
      expectedAcceptedConditionGroupIds: ["Condition:condition-diabetes-type-2"]
    }),
    jordanLabEvalCase({
      id: "jordan-glucose",
      labName: "Glucose",
      expectedAcceptedConditionGroupIds: ["Condition:condition-diabetes-type-2"]
    }),
    jordanLabEvalCase({
      id: "jordan-glucose-level",
      labName: "Glucose Level",
      expectedAcceptedConditionGroupIds: ["Condition:condition-diabetes-type-2"]
    }),
    jordanLabEvalCase({
      id: "jordan-systolic-blood-pressure",
      labName: "Systolic Blood Pressure",
      expectedAcceptedConditionGroupIds: ["Condition:condition-high-blood-pressure"]
    }),
    jordanLabEvalCase({
      id: "jordan-vitamin-d",
      labName: "25-Hydroxyvitamin D3+25-Hydroxyvitamin D2"
    }),
    jordanLabEvalCase({
      id: "jordan-hdl",
      labName: "Cholesterol in HDL"
    }),
    jordanLabEvalCase({
      id: "jordan-ldl",
      labName: "Cholesterol in LDL"
    }),
    jordanLabEvalCase({
      id: "jordan-triglyceride",
      labName: "Triglyceride"
    }),
    jordanLabEvalCase({
      id: "jordan-creatinine",
      labName: "Creatinine"
    }),
    jordanLabEvalCase({
      id: "jordan-gfr",
      labName: "Glomerular Filtration Rate"
    }),
    jordanLabEvalCase({
      id: "jordan-tobacco",
      labName: "Current tobacco use"
    }),
    jordanLabEvalCase({
      id: "jordan-blood-flow-rate",
      labName: "Blood Flow Rate.Mean"
    }),
    jordanLabEvalCase({
      id: "jordan-thyrotropin",
      labName: "Thyrotropin"
    })
  ];
}

function evalLabGroupFromCase(testCase: WebLlmLabAssociationEvalCase): PatientFriendlyGroup {
  return {
    groupId: testCase.labGroupId ?? `eval:${testCase.id}`,
    patientFriendlyName: testCase.labName,
    resourceIds: [],
    resourceTypes: ["Observation"],
    observationBucket: "labs",
    confidence: 1,
    reason: "lab association eval",
    fallback: false
  };
}

function sortedValues(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function expectedAssociationPassed(actual: LabConditionAssociation[], expected?: string[]): boolean | undefined {
  if (!expected) return undefined;
  const actualIds = sortedValues(actual.map((association) => association.conditionGroupId));
  const expectedIds = sortedValues(expected);
  return actualIds.length === expectedIds.length && actualIds.every((value, index) => value === expectedIds[index]);
}

function labAssociationEvalDefaultUserPayload(
  testCase: WebLlmLabAssociationEvalCase,
  labGroup: PatientFriendlyGroup,
  conditionChoices: ConditionAssociationChoice[]
): unknown {
  return {
    outputShape:
      PROMPTS.tasks.lab_condition_association.output_shape,
    measurement: {
      groupId: labGroup.groupId,
      name: labGroup.patientFriendlyName
    },
    referenceContext: (testCase.referenceContext ?? []).slice(0, 8),
    conditionChoices: conditionChoices.map((choice) => ({
      conditionGroupId: choice.conditionGroupId,
      name: choice.name
    }))
  };
}

function labAssociationEvalTemplateVariables(
  testCase: WebLlmLabAssociationEvalCase,
  labGroup: PatientFriendlyGroup,
  conditionChoices: ConditionAssociationChoice[]
): Record<string, unknown> {
  return {
    caseId: testCase.id,
    labName: testCase.labName,
    labGroupId: labGroup.groupId,
    measurement: {
      groupId: labGroup.groupId,
      name: labGroup.patientFriendlyName
    },
    referenceContext: (testCase.referenceContext ?? []).slice(0, 8),
    conditionChoices: conditionChoices.map((choice) => ({
      conditionGroupId: choice.conditionGroupId,
      name: choice.name
    }))
  };
}

function expandLabAssociationEvalTemplate(template: unknown, variables: Record<string, unknown>): unknown {
  if (typeof template === "string") {
    return template.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (match: string, path: string) => {
      const value = path.split(".").reduce((current: unknown, key: string): unknown => {
        if (current && typeof current === "object" && key in current) {
          return (current as Record<string, unknown>)[key];
        }
        return undefined;
      }, variables);
      if (value === undefined) return match;
      return typeof value === "string" ? value : JSON.stringify(value);
    });
  }
  if (Array.isArray(template)) {
    return template.map((item) => expandLabAssociationEvalTemplate(item, variables));
  }
  if (template && typeof template === "object") {
    return Object.fromEntries(
      Object.entries(template).map(([key, value]) => [key, expandLabAssociationEvalTemplate(value, variables)])
    );
  }
  return template;
}

function labAssociationEvalUserContent(
  testCase: WebLlmLabAssociationEvalCase,
  labGroup: PatientFriendlyGroup,
  conditionChoices: ConditionAssociationChoice[],
  request: WebLlmLabAssociationEvalSuiteRequest
): string {
  if (testCase.userPayload !== undefined) return JSON.stringify(testCase.userPayload);
  if (request.userPromptTemplate !== undefined) {
    return JSON.stringify(
      expandLabAssociationEvalTemplate(
        request.userPromptTemplate,
        labAssociationEvalTemplateVariables(testCase, labGroup, conditionChoices)
      )
    );
  }
  return JSON.stringify(labAssociationEvalDefaultUserPayload(testCase, labGroup, conditionChoices));
}

function labAssociationEvalMessages(
  testCase: WebLlmLabAssociationEvalCase,
  labGroup: PatientFriendlyGroup,
  conditionChoices: ConditionAssociationChoice[],
  request: WebLlmLabAssociationEvalSuiteRequest
): ChatMessage[] {
  if (testCase.messages && testCase.messages.length > 0) return testCase.messages;
  if (request.messages && request.messages.length > 0) {
    const variables = labAssociationEvalTemplateVariables(testCase, labGroup, conditionChoices);
    return request.messages.map((message) => ({
      role: message.role,
      content: String(expandLabAssociationEvalTemplate(message.content, variables))
    }));
  }
  return [
    { role: "system", content: request.systemPrompt ?? labConditionTargetSystemPrompt() },
    {
      role: "user",
      content: labAssociationEvalUserContent(testCase, labGroup, conditionChoices, request)
    }
  ];
}

export async function runLabAssociationEvalSuite(
  request: WebLlmLabAssociationEvalSuiteRequest = {},
  options: WebLlmGroupingOptions = {}
): Promise<WebLlmLabAssociationEvalSuiteResult> {
  const suiteStartedAt = performance.now();
  const cases = request.cases && request.cases.length > 0 ? request.cases : webLlmLabAssociationEvalCases();
  const results: WebLlmLabAssociationEvalCaseResult[] = [];
  const modelOptions: WebLlmGroupingOptions = {
    ...options,
    modelPreference: request.modelPreference ?? options.modelPreference,
    timeoutMs: request.timeoutMs ?? options.timeoutMs
  };

  for (const testCase of cases) {
    const caseStartedAt = performance.now();
    const conditionChoices = (testCase.conditionChoices ?? []).slice(0, MAX_AVAILABLE_NAMES);
    const labGroup = evalLabGroupFromCase(testCase);
    const messages = labAssociationEvalMessages(testCase, labGroup, conditionChoices, request);

    try {
      const runResult = await runStructuredWebLlmPlayground(
        {
          operationLabel: request.operationLabel ?? "lab condition association eval",
          messages,
          schemaText: testCase.schemaText ?? request.schemaText ?? labConditionTargetSchemaText(conditionChoices),
          maxTokens: request.maxTokens ?? 180,
          timeoutMs: request.timeoutMs
        },
        modelOptions
      );
      const summary = summarizeLabConditionAssociationResponse(
        runResult.parsed as LabConditionAssociationParsedResponse,
        conditionChoices
      );
      const passed = expectedAssociationPassed(summary.accepted, testCase.expectedAcceptedConditionGroupIds);
      results.push({
        caseId: testCase.id,
        labName: testCase.labName,
        modelId: runResult.modelId,
        elapsedMs: Math.round(performance.now() - caseStartedAt),
        rawContent: runResult.rawContent,
        parsed: runResult.parsed,
        responseShape: runResult.responseShape,
        returnedAssociationCount: summary.rawAssociations.length,
        modelAssociations: summary.modelAssociations,
        acceptedAssociations: summary.accepted,
        rejectedReasons: summary.rejectedReasons,
        confidenceValues: summary.confidenceValues,
        confidenceLabels: summary.confidenceLabels,
        conditionChoices,
        expectedAcceptedConditionGroupIds: testCase.expectedAcceptedConditionGroupIds,
        passed
      });
    } catch (error) {
      results.push({
        caseId: testCase.id,
        labName: testCase.labName,
        elapsedMs: Math.round(performance.now() - caseStartedAt),
        returnedAssociationCount: 0,
        modelAssociations: [],
        acceptedAssociations: [],
        rejectedReasons: {},
        confidenceValues: [],
        confidenceLabels: [],
        conditionChoices,
        expectedAcceptedConditionGroupIds: testCase.expectedAcceptedConditionGroupIds,
        passed: false,
        error: errorMessage(error)
      });
    }
  }

  const evaluatedResults = results.filter((result) => typeof result.passed === "boolean");
  return {
    elapsedMs: Math.round(performance.now() - suiteStartedAt),
    caseCount: results.length,
    passedCount: evaluatedResults.filter((result) => result.passed).length,
    failedCount: evaluatedResults.filter((result) => result.passed === false && !result.error).length,
    errorCount: results.filter((result) => result.error).length,
    results
  };
}

function playgroundCase(params: WebLlmPlaygroundCase): WebLlmPlaygroundCase {
  return params;
}

export function webLlmPlaygroundCases(): WebLlmPlaygroundCase[] {
  const labConditionChoices: ConditionAssociationChoice[] = [
    {
      conditionGroupId: "Condition:condition-type-2-diabetes",
      name: "Type 2 Diabetes"
    },
    {
      conditionGroupId: "Condition:condition-high-blood-pressure",
      name: "High Blood Pressure"
    }
  ];
  const labConditionSchema = labConditionTargetSchemaText(labConditionChoices);

  const observationNamingRecords: GroupableRecord[] = [
    {
      id: "obs-a1c-text",
      resourceType: "Observation",
      sourceLabel: "HbA1c lab value",
      codeTexts: ["HbA1c lab value"],
      source: "provider"
    },
    {
      id: "obs-glucose-text",
      resourceType: "Observation",
      sourceLabel: "Blood glucose lab",
      codeTexts: ["Blood glucose lab"],
      source: "provider"
    },
    {
      id: "obs-vitamin-d-text",
      resourceType: "Observation",
      sourceLabel: "Vitamin D level",
      codeTexts: ["Vitamin D level"],
      source: "provider"
    }
  ];
  const observationNames = ["Hemoglobin A1c", "Glucose", "Vitamin D", "Systolic Blood Pressure", "Weight"];

  const allergyRecord: GroupableRecord = {
    id: "allergy-nkda",
    resourceType: "AllergyIntolerance",
    sourceLabel: "No known drug allergies",
    codeTexts: ["No known drug allergies"],
    source: "provider"
  };

  const encounterRecord: GroupableRecord = {
    id: "enc-office",
    resourceType: "Encounter",
    sourceLabel: "Office visit",
    codeTexts: ["Ambulatory office visit"],
    categoryCode: "AMB",
    source: "provider"
  };

  const observationCategoryRecord: GroupableRecord = {
    id: "obs-foot-exam",
    resourceType: "Observation",
    sourceLabel: "Diabetic foot exam",
    codeTexts: ["Diabetic foot exam"],
    source: "provider"
  };

  return [
    playgroundCase({
      id: "lab-condition-glucose",
      title: "Lab-Condition: Glucose",
      description: "Positive case where Glucose should associate with Type 2 Diabetes but not broad unrelated conditions.",
      operationLabel: "lab condition association",
      messages: [
        { role: "system", content: labConditionTargetSystemPrompt() },
        {
          role: "user",
          content: labConditionTargetUserPrompt({
            labGroup: {
              groupId: "observation-glucose",
              patientFriendlyName: "Glucose",
              resourceIds: ["obs-glucose"],
              resourceTypes: ["Observation"],
              observationBucket: "labs",
              confidence: 0.9,
              reason: "playground",
              fallback: false
            },
            explicitRelatedContext: ["Referenced condition candidate: Type 2 Diabetes"],
            conditionChoices: labConditionChoices
          })
        }
      ],
      schemaText: labConditionSchema,
      maxTokens: 240
    }),
    playgroundCase({
      id: "lab-condition-cholesterol",
      title: "Lab-Condition: Cholesterol Noise Check",
      description: "Negative/noise case where Cholesterol should avoid High Blood Pressure unless the model sees a direct condition.",
      operationLabel: "lab condition association",
      messages: [
        { role: "system", content: labConditionTargetSystemPrompt() },
        {
          role: "user",
          content: labConditionTargetUserPrompt({
            labGroup: {
              groupId: "observation-cholesterol",
              patientFriendlyName: "Cholesterol",
              resourceIds: ["obs-cholesterol"],
              resourceTypes: ["Observation"],
              observationBucket: "labs",
              confidence: 0.9,
              reason: "playground",
              fallback: false
            },
            explicitRelatedContext: [],
            conditionChoices: labConditionChoices
          })
        }
      ],
      schemaText: labConditionSchema,
      maxTokens: 240
    }),
    playgroundCase({
      id: "observation-naming",
      title: "Observation Naming Batch",
      description: "Patient-friendly names and observation buckets for text-only lab concepts.",
      operationLabel: "batch record naming",
      messages: [
        { role: "system", content: namingSystemPrompt() },
        { role: "user", content: namingBatchUserPrompt(observationNamingRecords, observationNames) }
      ],
      schemaText: namingBatchResponseSchemaText(observationNames),
      maxTokens: 540
    }),
    playgroundCase({
      id: "observation-category",
      title: "Observation Category",
      description: "Classify a single observation as labs, vitals, other, or unknown.",
      operationLabel: "observation category classification",
      messages: [
        { role: "system", content: classificationSystemPrompt("observation") },
        { role: "user", content: classificationUserPrompt(observationCategoryRecord) }
      ],
      schemaText: OBSERVATION_CATEGORY_CLASSIFICATION_SCHEMA_TEXT,
      maxTokens: 90
    }),
    playgroundCase({
      id: "allergy-classification",
      title: "Allergy Classification",
      description: "Classify a no-known-drug-allergy assertion.",
      operationLabel: "allergy classification",
      messages: [
        { role: "system", content: classificationSystemPrompt("allergy") },
        { role: "user", content: classificationUserPrompt(allergyRecord) }
      ],
      schemaText: ALLERGY_CLASSIFICATION_SCHEMA_TEXT,
      maxTokens: 120
    }),
    playgroundCase({
      id: "encounter-visit",
      title: "Encounter Visit Class",
      description: "Classify visit type for a compact encounter concept.",
      operationLabel: "encounter visit classification",
      messages: [
        { role: "system", content: classificationSystemPrompt("encounter") },
        { role: "user", content: classificationUserPrompt(encounterRecord) }
      ],
      schemaText: ENCOUNTER_VISIT_CLASSIFICATION_SCHEMA_TEXT,
      maxTokens: 90
    })
  ];
}

function namingSystemPrompt(): string {
  // prompts.json (single source of truth) already includes per-resource-type
  // rules and the diagnosis-prohibition rules inline. No batchMode variation:
  // the user-payload outputShape tells the model whether to return one record
  // or many, the system prompt stays constant.
  return PROMPTS.tasks.app_patient_friendly_name.system_prompt;
}

function namingUserPrompt(record: GroupableRecord, availableNames: string[]): string {
  const choices = relevantAvailableNameChoices([record], availableNamesForRecords([record], availableNames));
  return JSON.stringify({
    outputShape: PROMPTS.tasks.app_patient_friendly_name.output_shape,
    availableNames: choices,
    record: promptRecord(record)
  });
}

function namingBatchUserPrompt(records: GroupableRecord[], availableNames: string[]): string {
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

function parseObservationBucket(value: unknown): PatientObservationBucket | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (normalized === "lab" || normalized === "labs" || normalized === "laboratory") return "labs";
  if (normalized === "vital" || normalized === "vitals" || normalized === "vital-sign" || normalized === "vital-signs") {
    return "vitals";
  }
  if (normalized === "other") return "other";
  return undefined;
}

function mergeObservationBucket(
  existing: PatientObservationBucket | undefined,
  next: PatientObservationBucket | undefined
): PatientObservationBucket | undefined {
  if (!existing) return next;
  if (!next) return existing;
  return existing === next ? existing : undefined;
}

function parseNamingResponse(value: unknown): {
  patientFriendlyName: string;
  observationBucket?: PatientObservationBucket;
  confidence: number;
  fallback: boolean;
} {
  const parsed = value as {
    patientFriendlyName?: unknown;
    observationBucket?: unknown;
    confidence?: unknown;
    fallback?: unknown;
  } | undefined;
  const patientFriendlyName =
    typeof parsed?.patientFriendlyName === "string" && parsed.patientFriendlyName.trim()
      ? parsed.patientFriendlyName.trim().slice(0, 80)
      : undefined;
  if (!patientFriendlyName) throw new Error("WebLLM returned a naming response without patientFriendlyName");
  return {
    patientFriendlyName,
    observationBucket: parseObservationBucket(parsed?.observationBucket),
    confidence:
      typeof parsed?.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    fallback: Boolean(parsed?.fallback)
  };
}

function namingBatchItems(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  const parsed = value as { items?: unknown[]; results?: unknown[]; records?: unknown[] } | undefined;
  if (Array.isArray(parsed?.items)) return parsed.items;
  if (Array.isArray(parsed?.results)) return parsed.results;
  if (Array.isArray(parsed?.records)) return parsed.records;
  return undefined;
}

function namingCandidateId(value: unknown): string | undefined {
  const candidate = value as { id?: unknown; recordId?: unknown; resourceId?: unknown } | undefined;
  if (typeof candidate?.id === "string") return candidate.id;
  if (typeof candidate?.recordId === "string") return candidate.recordId;
  if (typeof candidate?.resourceId === "string") return candidate.resourceId;
  return undefined;
}

function parseNamingBatchResponse(value: unknown, records: GroupableRecord[]): NamingResult[] {
  const items = namingBatchItems(value);
  if (records.length === 1 && !items) {
    return [validatedNamingResult(records[0], { id: records[0].id, ...parseNamingResponse(value) })];
  }

  if (!items) throw new Error("WebLLM returned a naming batch without items, results, records, or a raw item array");

  const expectedIds = new Set(records.map((record) => record.id));
  const byId = new Map<string, NamingResult>();
  for (const item of items) {
    const candidateId = namingCandidateId(item);
    if (!candidateId || !expectedIds.has(candidateId) || byId.has(candidateId)) continue;
    const record = records.find((item) => item.id === candidateId);
    if (!record) continue;
    byId.set(candidateId, validatedNamingResult(record, { id: candidateId, ...parseNamingResponse(item) }));
  }

  const missing = records.filter((record) => !byId.has(record.id)).map((record) => record.id);
  if (missing.length > 0) throw new Error(`WebLLM naming batch missed input ids: ${missing.join(", ")}`);

  return records.map((record) => {
    const result = byId.get(record.id);
    if (!result) throw new Error(`WebLLM naming batch missed input id: ${record.id}`);
    return result;
  });
}

function availableNamesForRecords(records: GroupableRecord[], availableNames: string[]): string[] {
  if (records.length > 0 && records.every((record) => record.resourceType === "MedicationRequest")) {
    return [];
  }
  return availableNames;
}

function meaningfulTokens(value: string): string[] {
  const stopWords = new Set(["and", "or", "the", "with", "without", "tablet", "capsule", "solution", "suspension", "oral"]);
  return canonicalName(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !stopWords.has(token));
}

function medicationNamingMatchesSource(record: GroupableRecord, naming: NamingResult): boolean {
  if (record.resourceType !== "MedicationRequest") return true;
  const nameTokens = new Set(meaningfulTokens(naming.patientFriendlyName));
  const ingredientTokens = (record.ingredients ?? []).flatMap(meaningfulTokens);
  if (ingredientTokens.length > 0) return ingredientTokens.some((token) => nameTokens.has(token));

  const sourceTokens = [
    ...meaningfulTokens(record.sourceLabel),
    ...(record.codeTexts ?? []).flatMap(meaningfulTokens),
    ...(record.codeCodings ?? []).flatMap((coding) => meaningfulTokens(coding.display ?? ""))
  ];
  if (sourceTokens.length === 0) return true;
  return sourceTokens.some((token) => nameTokens.has(token));
}

function validatedNamingResult(record: GroupableRecord, naming: NamingResult): NamingResult {
  if (medicationNamingMatchesSource(record, naming)) return naming;
  return fallbackNamingForRecord(record);
}

function incrementalNamingBatchSize(options: WebLlmGroupingOptions): number {
  if (options.namingMode === "single") return 1;
  const requested = options.namingBatchSize ?? DEFAULT_INCREMENTAL_NAMING_BATCH_SIZE;
  if (!Number.isFinite(requested)) return DEFAULT_INCREMENTAL_NAMING_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_INCREMENTAL_NAMING_BATCH_SIZE, Math.floor(requested)));
}

function canonicalName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value: string): string {
  return canonicalName(value).replace(/\s+/g, "-").slice(0, 60) || "group";
}

function fallbackNamingForRecord(record: GroupableRecord): NamingResult {
  return {
    id: record.id,
    patientFriendlyName: truncateText(record.sourceLabel, 80) || record.resourceType,
    observationBucket: record.resourceType === "Observation" ? observationBucketFromRecord(record) : undefined,
    confidence: 0.45,
    fallback: true
  };
}

async function nameRecordWithWebLlm(
  record: GroupableRecord,
  availableNames: string[],
  options: WebLlmGroupingOptions
): Promise<{
  patientFriendlyName: string;
  observationBucket?: PatientObservationBucket;
  confidence: number;
  fallback: boolean;
}> {
  const { engine, modelId } = await getWebLlmEngine(options);
  const namingAvailableNames = relevantAvailableNameChoices([record], availableNamesForRecords([record], availableNames));
  const messages: ChatMessage[] = [
    { role: "system", content: namingSystemPrompt() },
    { role: "user", content: namingUserPrompt(record, namingAvailableNames) }
  ];
  const schemaText = namingResponseSchemaText(namingAvailableNames);
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_WEBLLM_TIMEOUT_MS, 45_000);
  const parsed = await createJsonCompletionWithRetry(engine, modelId, messages, options, {
    operationLabel: "single record naming",
    schemaText,
    maxTokens: 180,
    timeoutMs,
    timeoutMessage: "Local grouping model did not finish naming within 45 seconds",
    emptyMessage: "WebLLM returned an empty naming response",
    retryProgressMessage: "Structured local naming unavailable; retrying JSON output"
  });
  const naming = validatedNamingResult(record, { id: record.id, ...parseNamingResponse(parsed) });
  return {
    patientFriendlyName: naming.patientFriendlyName,
    observationBucket: naming.observationBucket,
    confidence: naming.confidence,
    fallback: naming.fallback
  };
}

async function nameBatchWithWebLlm(
  records: GroupableRecord[],
  availableNames: string[],
  options: WebLlmGroupingOptions
): Promise<NamingResult[]> {
  if (records.length === 0) return [];
  const allNamingAvailableNames = availableNamesForRecords(records, availableNames);
  const relevantNamingAvailableNames = relevantAvailableNameChoices(records, allNamingAvailableNames);
  webLlmLog("info", "naming-batch-start", {
    recordCount: records.length,
    resourceTypes: [...new Set(records.map((record) => record.resourceType))],
    recordIds: records.map((record) => record.id),
    availableNameCount: allNamingAvailableNames.length,
    relevantAvailableNameCount: relevantNamingAvailableNames.length,
    relevantAvailableNames: relevantNamingAvailableNames,
    requestedBatchSize: incrementalNamingBatchSize(options)
  });
  if (records.length === 1) {
    const record = records[0];
    const naming = await nameRecordWithWebLlm(record, availableNames, options);
    const result = [{ id: record.id, ...naming }];
    webLlmLog("info", "naming-batch-success", {
      recordCount: records.length,
      recordIds: records.map((item) => item.id),
      patientFriendlyNames: result.map((item) => item.patientFriendlyName),
      fallbacks: result.filter((item) => item.fallback).length
    });
    return result;
  }

  const { engine, modelId } = await getWebLlmEngine(options);
  const namingAvailableNames = relevantAvailableNameChoices(records, availableNamesForRecords(records, availableNames));
  const resourceType = [...new Set(records.map((record) => record.resourceType))].join(", ");
  const messages: ChatMessage[] = [
    { role: "system", content: namingSystemPrompt() },
    { role: "user", content: namingBatchUserPrompt(records, namingAvailableNames) }
  ];
  const schemaText = namingBatchResponseSchemaText(namingAvailableNames);
  const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_WEBLLM_TIMEOUT_MS, 60_000);
  const maxTokens = Math.min(900, 120 + records.length * 140);
  const parsed = await createJsonCompletionWithRetry(engine, modelId, messages, options, {
    operationLabel: "batch record naming",
    schemaText,
    maxTokens,
    timeoutMs,
    timeoutMessage: "Local grouping model did not finish naming the local batch within 60 seconds",
    emptyMessage: "WebLLM returned an empty naming batch response",
    retryProgressMessage: "Structured local batch naming unavailable; retrying JSON output"
  });
  const result = parseNamingBatchResponse(parsed, records);
  webLlmLog("info", "naming-batch-success", {
    recordCount: records.length,
    recordIds: records.map((item) => item.id),
    patientFriendlyNames: result.map((item) => item.patientFriendlyName),
    fallbacks: result.filter((item) => item.fallback).length
  });
  return result;
}

async function nameRecordsWithWebLlm(
  records: GroupableRecord[],
  availableNames: string[],
  options: WebLlmGroupingOptions
): Promise<NamingResult[]> {
  try {
    return await nameBatchWithWebLlm(records, availableNames, options);
  } catch (error) {
    if (records.length <= 1) {
      webLlmLog("warn", "naming-single-fallback", {
        recordCount: records.length,
        recordIds: records.map((record) => record.id),
        resourceTypes: [...new Set(records.map((record) => record.resourceType))],
        error: errorMessage(error)
      });
      options.onDiagnostic?.({
        phase: "single record naming",
        affectedRecordIds: records.map((record) => record.id),
        affectedCount: records.length,
        fallbackScope: "single-concept",
        message: `Local model could not name one concept; using source label fallback. ${errorMessage(error)}`
      });
      options.onProgress?.(`Local model could not name one concept; using source label fallback`);
      return [fallbackNamingForRecord(records[0])];
    }

    if (isContextWindowError(error)) {
      const midpoint = Math.ceil(records.length / 2);
      webLlmLog("warn", "naming-context-split", {
        recordCount: records.length,
        leftCount: midpoint,
        rightCount: records.length - midpoint,
        error: errorMessage(error)
      });
      options.onProgress?.(`Prompt too large; splitting ${records.length} local concepts into smaller naming batches`);
      const left = await nameRecordsWithWebLlm(records.slice(0, midpoint), availableNames, options);
      const right = await nameRecordsWithWebLlm(
        records.slice(midpoint),
        [...availableNames, ...left.map((result) => result.patientFriendlyName)],
        options
      );
      return [...left, ...right];
    }

    options.onProgress?.(`Local batch naming fallback; naming ${records.length} concepts one at a time`);
    webLlmLog("warn", "naming-batch-fallback-to-single", {
      recordCount: records.length,
      recordIds: records.map((record) => record.id),
      resourceTypes: [...new Set(records.map((record) => record.resourceType))],
      error: errorMessage(error)
    });
    options.onDiagnostic?.({
      phase: "batch record naming",
      affectedRecordIds: records.map((record) => record.id),
      affectedCount: records.length,
      fallbackScope: "batch",
      recovered: true,
      message: `Local batch naming failed; retrying concepts one at a time. ${errorMessage(error)}`
    });
    const results: NamingResult[] = [];
    let nextAvailableNames = availableNames;
    for (const record of records) {
      let naming: NamingResult;
      try {
        const result = await nameRecordWithWebLlm(record, nextAvailableNames, options);
        naming = { id: record.id, ...result };
      } catch (singleError) {
        webLlmLog("warn", "naming-single-fallback", {
          recordCount: 1,
          recordIds: [record.id],
          resourceTypes: [record.resourceType],
          error: errorMessage(singleError)
        });
        options.onDiagnostic?.({
          phase: "single record naming",
          affectedRecordIds: [record.id],
          affectedCount: 1,
          fallbackScope: "single-concept",
          message: `Local model could not name ${record.resourceType}; using source label fallback. ${errorMessage(singleError)}`
        });
        options.onProgress?.(`Local model could not name ${record.resourceType}; using source label fallback`);
        naming = fallbackNamingForRecord(record);
      }
      results.push(naming);
      nextAvailableNames = [...nextAvailableNames, naming.patientFriendlyName];
    }
    return results;
  }
}

export async function groupWithWebLlmIncremental(
  records: GroupableRecord[],
  options: WebLlmGroupingOptions = {}
): Promise<unknown> {
  if (records.length === 0) return { groups: [], unassigned: [] };

  let finalResult: unknown = { groups: [], unassigned: [] };
  for await (const update of groupWithWebLlmIncrementalStream(records, options)) {
    finalResult = update.result;
  }

  return finalResult;
}

export async function* groupWithWebLlmIncrementalStream(
  records: GroupableRecord[],
  options: WebLlmGroupingOptions = {}
): AsyncGenerator<WebLlmIncrementalGroupingUpdate, void, void> {
  if (records.length === 0) return;

  const streamStartedAt = performance.now();
  const groupsByName = new Map<
    string,
    {
      groupId: string;
      patientFriendlyName: string;
      resourceIds: string[];
      resourceTypes: string[];
      confidence: number;
      reason: string;
      fallback: boolean;
      observationBucket?: PatientObservationBucket;
    }
  >();
  const availableNames: string[] = [...(options.initialAvailableNames ?? [])];
  const batchSize = incrementalNamingBatchSize(options);
  const batchCount = Math.ceil(records.length / batchSize);
  webLlmLog("info", "grouping-stream-start", {
    totalRecords: records.length,
    resourceTypes: [...new Set(records.map((record) => record.resourceType))],
    batchSize,
    batchCount,
    namingMode: options.namingMode ?? "batch",
    modelPreference: webLlmModelPreference(options),
    initialAvailableNameCount: availableNames.length,
    recordIds: records.map((record) => record.id)
  });

  for (let index = 0; index < records.length; index += batchSize) {
    const batch = records.slice(index, index + batchSize);
    const end = index + batch.length;
    const batchIndex = Math.floor(index / batchSize) + 1;
    webLlmLog("info", "grouping-stream-batch-start", {
      batchIndex,
      batchCount,
      batchSize: batch.length,
      completedBeforeBatch: index,
      totalRecords: records.length,
      resourceType: batch[0]?.resourceType ?? "records",
      recordIds: batch.map((record) => record.id),
      availableNameCount: availableNames.length
    });
    options.onProgress?.(`Naming local concepts ${index + 1}-${end}/${records.length} (${batch[0]?.resourceType ?? "records"})`);
    const namings = await nameRecordsWithWebLlm(batch, availableNames, options);

    for (const naming of namings) {
      const record = batch.find((candidate) => candidate.id === naming.id);
      if (!record) continue;
      const canonical = canonicalName(naming.patientFriendlyName);
      const observationBucket = record.resourceType === "Observation" ? naming.observationBucket : undefined;
      const observationBucketKey =
        record.resourceType === "Observation" ? observationBucket ?? normalizedCategoryCode(record) ?? "other" : undefined;
      const canonicalKey = record.resourceType === "Observation" ? `${observationBucketKey}:${canonical}` : canonical;
      const groupId = `${record.resourceType.toLowerCase()}-${
        record.resourceType === "Observation" && observationBucket ? `${observationBucket}-` : ""
      }${slug(naming.patientFriendlyName)}`;
      const existing = groupsByName.get(canonicalKey);

      if (existing) {
        existing.resourceIds.push(record.id);
        if (!existing.resourceTypes.includes(record.resourceType)) existing.resourceTypes.push(record.resourceType);
        existing.confidence = Math.min(existing.confidence, naming.confidence);
        existing.fallback = existing.fallback || naming.fallback || naming.confidence < 0.55;
        existing.observationBucket = mergeObservationBucket(existing.observationBucket, observationBucket);
        continue;
      }

      groupsByName.set(canonicalKey, {
        groupId,
        patientFriendlyName: naming.patientFriendlyName,
        resourceIds: [record.id],
        resourceTypes: [record.resourceType],
        observationBucket,
        confidence: naming.confidence,
        reason: "Generated by local model from a small source-concept batch.",
        fallback: naming.fallback || naming.confidence < 0.55
      });
      availableNames.push(naming.patientFriendlyName);
    }

    yield {
      result: { groups: [...groupsByName.values()], unassigned: [] },
      completedRecords: records.slice(0, end),
      pendingRecords: records.slice(end),
      completedCount: end,
      totalCount: records.length,
      batchIndex,
      batchCount
    };
    webLlmLog("info", "grouping-stream-batch-complete", {
      batchIndex,
      batchCount,
      completedCount: end,
      totalRecords: records.length,
      groupCount: groupsByName.size,
      elapsedMs: Math.round(performance.now() - streamStartedAt)
    });
  }
  webLlmLog("info", "grouping-stream-complete", {
    totalRecords: records.length,
    groupCount: groupsByName.size,
    elapsedMs: Math.round(performance.now() - streamStartedAt)
  });
}

function batchSortKey(record: GroupableRecord): string {
  return [
    normalizedCategoryCode(record) ?? "",
    record.sourceLabel.toLowerCase(),
    record.codingKeys?.join("|") ?? "",
    record.id
  ].join("|");
}

function chunkRecords(records: GroupableRecord[], size = DEFAULT_BATCH_SIZE): GroupableRecord[][] {
  if (records.length <= size) return [records];

  const batches: GroupableRecord[][] = [];
  if (records[0]?.resourceType === "Observation") {
    const byCategory = new Map<string, GroupableRecord[]>();
    for (const record of [...records].sort((left, right) => batchSortKey(left).localeCompare(batchSortKey(right)))) {
      const key = normalizedCategoryCode(record) ?? "uncategorized";
      byCategory.set(key, [...(byCategory.get(key) ?? []), record]);
    }

    for (const categoryRecords of byCategory.values()) {
      for (let index = 0; index < categoryRecords.length; index += size) {
        batches.push(categoryRecords.slice(index, index + size));
      }
    }
    return batches;
  }

  const sorted = [...records].sort((left, right) => batchSortKey(left).localeCompare(batchSortKey(right)));
  for (let index = 0; index < sorted.length; index += size) batches.push(sorted.slice(index, index + size));
  return batches;
}

function parsedGroupingResult(value: unknown): { groups: unknown[]; unassigned: unknown[] } {
  const result = value as { groups?: unknown[]; unassigned?: unknown[] } | undefined;
  return {
    groups: Array.isArray(result?.groups) ? result.groups : [],
    unassigned: Array.isArray(result?.unassigned) ? result.unassigned : []
  };
}

async function groupBatchWithRetry(records: GroupableRecord[], options: WebLlmGroupingOptions): Promise<unknown> {
  const estimatedPromptTokens = estimatePromptTokens(records);
  if (records.length > 1 && estimatedPromptTokens > PROMPT_TOKEN_BUDGET) {
    const midpoint = Math.ceil(records.length / 2);
    options.onProgress?.(
      `Prompt budget ${estimatedPromptTokens} tokens; splitting ${records.length} records into smaller local batches`
    );
    const left = await groupBatchWithRetry(records.slice(0, midpoint), options);
    const right = await groupBatchWithRetry(records.slice(midpoint), options);
    const leftParsed = parsedGroupingResult(left);
    const rightParsed = parsedGroupingResult(right);
    return {
      groups: [...leftParsed.groups, ...rightParsed.groups],
      unassigned: [...leftParsed.unassigned, ...rightParsed.unassigned]
    };
  }

  try {
    return await groupWithWebLlm(records, options);
  } catch (error) {
    if (!isContextWindowError(error) || records.length <= 1) throw error;
    const midpoint = Math.ceil(records.length / 2);
    options.onProgress?.(`Prompt too large; splitting ${records.length} records into smaller local batches`);
    const left = await groupBatchWithRetry(records.slice(0, midpoint), options);
    const right = await groupBatchWithRetry(records.slice(midpoint), options);
    const leftParsed = parsedGroupingResult(left);
    const rightParsed = parsedGroupingResult(right);
    return {
      groups: [...leftParsed.groups, ...rightParsed.groups],
      unassigned: [...leftParsed.unassigned, ...rightParsed.unassigned]
    };
  }
}

export async function groupWithWebLlmBatched(
  records: GroupableRecord[],
  options: WebLlmGroupingOptions = {}
): Promise<unknown> {
  if (records.length === 0) return { groups: [], unassigned: [] };
  const batches = chunkRecords(records);
  if (batches.length === 1) return groupBatchWithRetry(batches[0], options);

  const groups: unknown[] = [];
  const unassigned: unknown[] = [];
  for (const [index, batch] of batches.entries()) {
    options.onProgress?.(`Grouping local batch ${index + 1}/${batches.length} (${batch.length} records)`);
    const result = parsedGroupingResult(await groupBatchWithRetry(batch, options));
    groups.push(...result.groups);
    unassigned.push(...result.unassigned);
  }

  return { groups, unassigned };
}
