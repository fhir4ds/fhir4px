import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from "@mui/material";
import {
  Timeline,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineItem,
  TimelineOppositeContent,
  TimelineSeparator
} from "@mui/lab";
import { LineChart } from "@mui/x-charts/LineChart";
import {
  Activity,
  CalendarDays,
  ChevronDown,
  Database,
  EyeOff,
  FileText,
  HeartPulse,
  Info,
  Layers,
  List,
  ListCollapse,
  Pill,
  Plus,
  RefreshCcw,
  ShieldAlert,
  Stethoscope,
  Syringe,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  dedupeGroupedRecords,
  recordQualityScore,
  type DedupedRecordCluster
} from "../lib/fhir/dedupe";
import {
  buildGroupableRecords,
  compactRecordsForModel,
  deterministicPatientGrouping,
  expandCompactGrouping,
  sourceRecordGrouping,
  splitFallbackGroupsToSourceRecords,
  validateGroupingResult
} from "../lib/fhir/patient-groups";
import type {
  GroupableRecord,
  PatientFriendlyGroup,
  PatientGroupingResult,
  PatientObservationBucket
} from "../lib/fhir/patient-groups";
import {
  emptyGroupingCache,
  GROUPING_CACHE_ID,
  groupingCacheByCompactId,
  upsertGroupingCacheEntries,
  type GroupingCacheEntry,
  type GroupingCacheRecord
} from "../lib/fhir/grouping-cache";
import {
  CLASSIFICATION_TRANSFORM_VERSIONS,
  emptyClassificationCache,
  preferredClassificationEntry,
  upsertClassificationCacheEntries,
  type ClassificationCacheEntry,
  type ClassificationCacheRecord,
  type ClassificationTransform
} from "../lib/fhir/classification-cache";
import { classifyBatch } from "../lib/embeddings";
import {
  emptyRelationshipCache,
  RELATIONSHIP_CACHE_ID,
  RELATIONSHIP_CACHE_VERSION,
  RELATIONSHIP_TRANSFORM_VERSIONS,
  relationshipCacheEntry,
  relationshipEntriesForSourceGroup,
  upsertRelationshipCacheEntries,
  type RelationshipCacheEntry,
  type RelationshipCacheRecord
} from "../lib/fhir/relationship-cache";
import {
  allergyNegativeAssertionSuperseded,
  deterministicAllergyClassification,
  deterministicEncounterVisitClassification,
  deterministicObservationCategoryClassification,
  visitClassLabel,
  type AllergyClassification,
  type AllergyDomain,
  type EncounterVisitClass,
  type EncounterVisitClassification,
  type ObservationCategoryClassification
} from "../lib/fhir/local-classification";
import {
  loadPatientFriendlyLookupForRecords,
  lookupPatientFriendlyName,
  PATIENT_FRIENDLY_LOOKUP_MODEL,
  type PatientFriendlyLookup
} from "../lib/fhir/patient-friendly-lookup";
import {
  buildExplicitRecordRelationships,
  conditionRecordKeysLinkedFromObservation,
  otherRelationshipRecordKey,
  relationshipGroupKey,
  relationshipMapByRecordKey,
  type RecordRelationship
} from "../lib/fhir/relationships";
import { completedObservationRecordsForRelationship } from "../lib/fhir/relationship-eligibility";
import { buildReferralSummary } from "../lib/fhir/normalize";
import { findDeterministicConditionsForLab } from "../lib/fhir/condition-lab-lookup";
import { findDeterministicConditionsForMedication } from "../lib/fhir/condition-medication-lookup";
import {
  createPatientAuthoredRecord,
  createPatientPatch,
  type PatientAuthoredCoding,
  type PatientAuthoredRecord,
  type PatientAuthoredResourceType,
  type PatientPatch
} from "../lib/fhir/patches";
import {
  loadPatientAuthoredCodingOptions,
  searchPatientAuthoredCodingOptions,
  type PatientAuthoredCodingOption,
  type PatientAuthoredOptionSystem
} from "../lib/fhir/patient-authored-options";
import type { ReferralSummary } from "../lib/fhir/types";
import {
  groupWithNamingIncrementalStream,
  browserCanAttemptNaming,
  getNamingWarmupStatus,
  subscribeNamingWarmupStatus,
  preloadNamingModel,
  incrementalNamingBatchSize,
  type NamingDiagnostic,
  type NamingIncrementalUpdate,
  type NamingWarmupStatus
} from "../lib/llm/naming";
import {
  associateLabGroupWithConditions,
  type ConditionAssociationChoice,
  type LabGroupContext
} from "../lib/llm/association";
import { SMART_AUTH_POPUP_EVENT, isSmartAuthPopupMessage } from "../lib/smart/popup";
import {
  type FhirDataset,
  type FhirResource
} from "../lib/smart/data";
import {
  ensureConnectedSources,
  fetchAndStoreSourceDataset,
  getSourceDataset,
  sourceLabel,
  type ConnectedSource
} from "../lib/smart/sources";
import { getOrCreateSessionVaultKey } from "../lib/vault/keys";
import { localVault } from "../lib/vault/store";

type ExplorerTab =
  | "MedicationRequest"
  | "AllergyIntolerance"
  | "Condition"
  | "Observation"
  | "Immunization"
  | "Encounter"
  | "Procedure"
  | "DiagnosticReport";
type ExplorerGroupingSource = PatientGroupingResult["source"];
type ObservationBucket = PatientObservationBucket;
type LocalGroupingMode = "one-b-batch" | "one-b-single" | "three-b-batch" | "custom-single";
type ExplorerViewMode = "grouped" | "date";
type ExplorerDensity = "comfortable" | "compact";
type GroupSortMode = "group-name" | "newest" | "oldest" | "most-records";
type DateSortMode = "newest" | "oldest";
type ResourceStatusFilter = "active" | "all";
type VisitClassFilter = EncounterVisitClass | "all";
type StatusFilteredResourceType = "MedicationRequest" | "Condition" | "AllergyIntolerance";
type GroupStatusKind = "active" | "on-hold" | "remission" | "resolved" | "inactive" | "stopped" | "completed" | "unknown";

interface GroupStatusRollup {
  kind: GroupStatusKind;
  label: string;
  activeForFilter: boolean;
  color: "default" | "success" | "warning";
}

const RESOURCE_LABELS: Record<ExplorerTab, string> = {
  MedicationRequest: "Medications",
  AllergyIntolerance: "Allergies",
  Condition: "Conditions",
  Observation: "Labs & Vitals",
  Immunization: "Vaccines",
  Encounter: "Visits",
  Procedure: "Procedures",
  DiagnosticReport: "Reports"
};

const EXPLORER_TABS = Object.keys(RESOURCE_LABELS) as ExplorerTab[];

function resourceTypeIcon(type: ExplorerTab, size = 20) {
  switch (type) {
    case "MedicationRequest":
      return <Pill size={size} />;
    case "AllergyIntolerance":
      return <ShieldAlert size={size} />;
    case "Condition":
      return <HeartPulse size={size} />;
    case "Observation":
      return <Activity size={size} />;
    case "Immunization":
      return <Syringe size={size} />;
    case "Encounter":
      return <CalendarDays size={size} />;
    case "Procedure":
      return <Stethoscope size={size} />;
    case "DiagnosticReport":
      return <FileText size={size} />;
  }
}

const PATIENT_RESOURCE_OPTIONS: Array<{ value: PatientAuthoredResourceType; label: string }> = [
  { value: "MedicationRequest", label: "Medication" },
  { value: "Immunization", label: "Vaccine" },
  { value: "AllergyIntolerance", label: "Allergy" }
];

const RXNORM_SYSTEM = "http://www.nlm.nih.gov/research/umls/rxnorm";
const CVX_SYSTEM = "http://hl7.org/fhir/sid/cvx";
const ALLERGY_CLINICAL_STATUS_SYSTEM = "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical";

const MEDICATION_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "stopped", label: "Stopped" },
  { value: "on-hold", label: "On hold" },
  { value: "unknown", label: "Unknown" }
] as const;

const IMMUNIZATION_STATUS_OPTIONS = [
  { value: "completed", label: "Completed" },
  { value: "not-done", label: "Not done" }
] as const;

const ALLERGY_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "resolved", label: "Resolved" }
] as const;

const ALLERGY_CRITICALITY_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "low", label: "Low" },
  { value: "high", label: "High" },
  { value: "unable-to-assess", label: "Unable to assess" }
] as const;

const OBSERVATION_BUCKET_LABELS: Record<ObservationBucket, string> = {
  labs: "Labs",
  vitals: "Vitals",
  other: "Other"
};

const MAX_COLLAPSED_GROUP_RECORDS = 3;

const LOCAL_GROUPING_MODE_OPTIONS: Array<{ value: LocalGroupingMode; label: string }> = [
  { value: "one-b-batch", label: "1B batch" },
  { value: "one-b-single", label: "1B single" },
  { value: "three-b-batch", label: "3B batch" },
  { value: "custom-single", label: "Custom single" }
];

const GROUP_SORT_OPTIONS: Array<{ value: GroupSortMode; label: string }> = [
  { value: "group-name", label: "Group name" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "most-records", label: "Most records" }
];

const DATE_SORT_OPTIONS: Array<{ value: DateSortMode; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" }
];

const STATUS_FILTER_RESOURCE_TYPES = new Set<ExplorerTab>([
  "MedicationRequest",
  "Condition",
  "AllergyIntolerance"
]);

const VISIT_CLASS_FILTER_OPTIONS: Array<{ value: VisitClassFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "outpatient", label: "Outpatient" },
  { value: "inpatient", label: "Inpatient" },
  { value: "emergency", label: "Emergency" },
  { value: "urgent_care", label: "Urgent care" },
  { value: "telehealth", label: "Telehealth" },
  { value: "procedure", label: "Procedure" },
  { value: "home_health", label: "Home health" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Unknown" }
];

const TRANSFORMERS_LLM_MODEL_ID = "transformers-llm";

function localGroupingModelId(): string {
  return TRANSFORMERS_LLM_MODEL_ID;
}

function emptyReferralSummary(): ReferralSummary {
  return {
    patient: null,
    medications: [],
    allergies: [],
    conditions: [],
    observations: [],
    immunizations: [],
    encounters: [],
    procedures: [],
    diagnosticReports: [],
    generatedAt: new Date().toISOString()
  };
}

function patientAuthoredOptionSystemForType(
  type: PatientAuthoredResourceType
): PatientAuthoredOptionSystem | null {
  if (type === "MedicationRequest") return "rxnorm";
  if (type === "Immunization") return "cvx";
  return null;
}

function patientAuthoredCodingSystem(system: PatientAuthoredOptionSystem): string {
  return system === "rxnorm" ? RXNORM_SYSTEM : CVX_SYSTEM;
}

function codingOptionToCoding(
  option: PatientAuthoredCodingOption,
  system: PatientAuthoredOptionSystem
): PatientAuthoredCoding {
  return {
    system: patientAuthoredCodingSystem(system),
    code: option.code,
    display: option.technicalName
  };
}

function addRecordStatusOptions(type: PatientAuthoredResourceType): ReadonlyArray<{ value: string; label: string }> {
  if (type === "Immunization") return IMMUNIZATION_STATUS_OPTIONS;
  if (type === "AllergyIntolerance") return ALLERGY_STATUS_OPTIONS;
  return MEDICATION_STATUS_OPTIONS;
}

function statusOptionLabel(options: ReadonlyArray<{ value: string; label: string }>, value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function defaultStatusForPatientAuthoredType(type: PatientAuthoredResourceType): string {
  if (type === "Immunization") return "completed";
  return "active";
}

function combineGroupingResults(results: PatientGroupingResult[]): PatientGroupingResult {
  const sources = new Set(results.map((result) => result.source));
  const source = sources.size === 1 ? ([...sources][0] ?? "deterministic") : "mixed";
  const groupsByKey = new Map<string, PatientFriendlyGroup>();

  for (const group of results.flatMap((result) => result.groups)) {
    const key = [
      group.resourceTypes.slice().sort().join("|"),
      group.observationBucket ?? "",
      normalizedGroupName(group.patientFriendlyName)
    ].join(":");
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.resourceIds = [...new Set([...existing.resourceIds, ...group.resourceIds])];
      existing.resourceTypes = [...new Set([...existing.resourceTypes, ...group.resourceTypes])];
      existing.confidence = Math.min(existing.confidence, group.confidence);
      existing.fallback = existing.fallback || group.fallback;
      existing.observationBucket = mergeObservationBucket(existing.observationBucket, group.observationBucket);
      continue;
    }
    groupsByKey.set(key, { ...group, resourceIds: [...new Set(group.resourceIds)] });
  }

  return {
    groups: [...groupsByKey.values()],
    unassigned: [...new Set(results.flatMap((result) => result.unassigned))],
    source
  };
}

function resourceTypesWithActiveFirst(active: ExplorerTab): ExplorerTab[] {
  return [active, ...(Object.keys(RESOURCE_LABELS) as ExplorerTab[]).filter((type) => type !== active)];
}

function recordsByType(records: GroupableRecord[], type: ExplorerTab): GroupableRecord[] {
  return records.filter((record) => record.resourceType === type && !record.hidden);
}

function groupsByType(groups: PatientFriendlyGroup[], type: ExplorerTab): PatientFriendlyGroup[] {
  return groups.filter((group) => group.resourceTypes.includes(type));
}

function observationBucketFromCategory(category?: string, categoryCode?: string): ObservationBucket {
  const normalized = (categoryCode || category || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (normalized === "laboratory" || normalized === "lab") return "labs";
  if (normalized === "vital-signs" || normalized === "vital-sign") return "vitals";
  return "other";
}

function observationBucket(record: GroupableRecord, observation?: ReferralSummary["observations"][number]): ObservationBucket {
  return observationBucketFromCategory(
    observation?.category ?? record.category,
    observation?.categoryCode ?? record.categoryCode
  );
}

function observationBucketFromKnownCategory(record: GroupableRecord): ObservationBucket | undefined {
  if (record.resourceType !== "Observation" || (!record.category && !record.categoryCode)) return undefined;
  return observationBucketFromCategory(record.category, record.categoryCode);
}

function mergeObservationBucket(
  existing: ObservationBucket | undefined,
  next: ObservationBucket | undefined
): ObservationBucket | undefined {
  if (!existing) return next;
  if (!next) return existing;
  return existing === next ? existing : undefined;
}

function observationRecordInBucket(
  record: GroupableRecord,
  bucket: ObservationBucket,
  observation?: ReferralSummary["observations"][number],
  group?: PatientFriendlyGroup
): boolean {
  return record.resourceType !== "Observation" || (group?.observationBucket ?? observationBucket(record, observation)) === bucket;
}

function resourceKey(resourceType: string, id?: string): string | undefined {
  return id ? `${resourceType}/${id}` : undefined;
}

function recordKey(record: GroupableRecord): string {
  return `${record.resourceType}/${record.id}`;
}

function scopedResourceId(sourceId: string, id?: string): string | undefined {
  return id ? `${sourceId}:${id}` : undefined;
}

function sortRecordsForDisplay(records: GroupableRecord[], type: ExplorerTab): GroupableRecord[] {
  return [...records].sort((left, right) => {
    if (type === "Observation") {
      const dateOrder = (right.date || "").localeCompare(left.date || "");
      if (dateOrder !== 0) return dateOrder;
    }
    return left.sourceLabel.localeCompare(right.sourceLabel);
  });
}

function recordTimestamp(record: GroupableRecord): number | undefined {
  const raw = record.date || record.latestDate;
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.getTime();
}

function compareRecordsByDate(left: GroupableRecord, right: GroupableRecord, sort: DateSortMode): number {
  const leftTime = recordTimestamp(left);
  const rightTime = recordTimestamp(right);
  if (leftTime === undefined && rightTime === undefined) return left.sourceLabel.localeCompare(right.sourceLabel);
  if (leftTime === undefined) return 1;
  if (rightTime === undefined) return -1;
  const dateOrder = sort === "newest" ? rightTime - leftTime : leftTime - rightTime;
  return dateOrder || left.sourceLabel.localeCompare(right.sourceLabel);
}

function recordDateLabel(record: GroupableRecord): string {
  const raw = record.date || record.latestDate;
  if (!raw) return "No date";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toLocaleDateString();
}

function recordDateSectionLabel(record: GroupableRecord): string {
  const raw = record.date || record.latestDate;
  if (!raw) return "No date";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function displayObservationDate(date?: string): string | undefined {
  if (!date) return undefined;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString();
}

function numericObservationValue(observation: ReferralSummary["observations"][number]): number | undefined {
  return observation.normalizedValue.canonicalValue ?? observation.normalizedValue.numericValue;
}

function numericObservationUnit(observation: ReferralSummary["observations"][number]): string | undefined {
  return observation.normalizedValue.canonicalUnit ?? observation.normalizedValue.displayUnit;
}

function observationComparableUnit(observation: ReferralSummary["observations"][number]): string {
  return numericObservationUnit(observation) ?? "unitless";
}

function detailDate(record: GroupableRecord): string | undefined {
  if (!record.date) return undefined;
  const parsed = new Date(record.date);
  return Number.isNaN(parsed.getTime()) ? record.date : parsed.toLocaleString();
}

function statusChipColor(status?: string): "default" | "success" | "warning" {
  const normalized = (status || "").toLowerCase();
  if (["active", "completed", "final", "taking"].includes(normalized)) return "success";
  if (["inactive", "stopped", "entered-in-error", "not-taken", "unknown"].includes(normalized)) return "warning";
  return "default";
}

function supportsResourceStatusFilter(type: ExplorerTab): type is StatusFilteredResourceType {
  return STATUS_FILTER_RESOURCE_TYPES.has(type);
}

function normalizedStatusValue(status?: string): string {
  return (status || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function recordStatusRollup(record: GroupableRecord): GroupStatusRollup {
  const normalized = normalizedStatusValue(record.status);

  if (record.resourceType === "MedicationRequest") {
    if (normalized === "active") {
      return { kind: "active", label: "Active", activeForFilter: true, color: "success" };
    }
    if (normalized === "on-hold" || normalized === "hold" || normalized === "paused") {
      return { kind: "on-hold", label: "On hold", activeForFilter: true, color: "warning" };
    }
    if (["stopped", "ended", "cancelled", "canceled", "entered-in-error"].includes(normalized)) {
      return { kind: "stopped", label: "Stopped", activeForFilter: false, color: "warning" };
    }
    if (normalized === "completed") {
      return { kind: "completed", label: "Completed", activeForFilter: false, color: "default" };
    }
    return { kind: "unknown", label: "Unknown", activeForFilter: false, color: "warning" };
  }

  if (record.resourceType === "Condition") {
    if (["active", "recurrence", "relapse"].includes(normalized)) {
      return { kind: "active", label: "Active", activeForFilter: true, color: "success" };
    }
    if (normalized === "remission") {
      return { kind: "remission", label: "Remission", activeForFilter: false, color: "default" };
    }
    if (normalized === "resolved") {
      return { kind: "resolved", label: "Resolved", activeForFilter: false, color: "default" };
    }
    if (["inactive", "entered-in-error"].includes(normalized)) {
      return { kind: "inactive", label: "Inactive", activeForFilter: false, color: "warning" };
    }
    return { kind: "unknown", label: "Unknown", activeForFilter: false, color: "warning" };
  }

  if (record.resourceType === "AllergyIntolerance") {
    if (!normalized || ["low", "high", "unable-to-assess"].includes(normalized)) {
      return { kind: "active", label: "Active", activeForFilter: true, color: "success" };
    }
    if (normalized === "active") {
      return { kind: "active", label: "Active", activeForFilter: true, color: "success" };
    }
    if (normalized === "resolved") {
      return { kind: "resolved", label: "Resolved", activeForFilter: false, color: "default" };
    }
    if (["inactive", "entered-in-error"].includes(normalized)) {
      return { kind: "inactive", label: "Inactive", activeForFilter: false, color: "warning" };
    }
    return { kind: "unknown", label: "Unknown", activeForFilter: false, color: "warning" };
  }

  return { kind: "unknown", label: "Unknown", activeForFilter: false, color: "warning" };
}

function groupStatusRollup(records: GroupableRecord[]): GroupStatusRollup {
  if (records.length === 0) {
    return { kind: "unknown", label: "Unknown", activeForFilter: false, color: "warning" };
  }

  const rollups = records.map(recordStatusRollup);
  const active = rollups.find((rollup) => rollup.kind === "active");
  if (active) return active;

  const onHold = rollups.find((rollup) => rollup.kind === "on-hold");
  if (onHold) return onHold;

  for (const kind of ["remission", "resolved", "inactive", "stopped", "completed"] as const) {
    const match = rollups.find((rollup) => rollup.kind === kind);
    if (match) return match;
  }

  return { kind: "unknown", label: "Unknown", activeForFilter: false, color: "warning" };
}

interface PatientProfile {
  sourceId: string;
  sourceName: string;
  patient: FhirResource;
}

function patientDisplayName(patient: FhirResource | null | undefined): string {
  const names = Array.isArray(patient?.name) ? patient.name : [];
  const official = names.find((name) => (name as { use?: unknown }).use === "official");
  const selected = (official ?? names[0]) as
    | {
        text?: unknown;
        given?: unknown;
        family?: unknown;
      }
    | undefined;
  if (typeof selected?.text === "string" && selected.text.trim()) return selected.text.trim();
  const given = Array.isArray(selected?.given)
    ? selected.given.filter((value): value is string => typeof value === "string")
    : [];
  const family = typeof selected?.family === "string" ? selected.family : "";
  return [...given, family].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || "Patient";
}

function patientAge(birthDate?: unknown): number | undefined {
  if (typeof birthDate !== "string") return undefined;
  const parsed = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - parsed.getFullYear();
  const monthDelta = today.getMonth() - parsed.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < parsed.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : undefined;
}

function patientBirthDateLabel(patient: FhirResource): string | undefined {
  if (typeof patient.birthDate !== "string") return undefined;
  const age = patientAge(patient.birthDate);
  return age === undefined ? patient.birthDate : `${patient.birthDate} (${age})`;
}

function patientGenderLabel(patient: FhirResource): string | undefined {
  return typeof patient.gender === "string" && patient.gender.trim() ? patient.gender : undefined;
}

function patientAddressLabel(patient: FhirResource): string | undefined {
  const addresses = Array.isArray(patient.address) ? patient.address : [];
  const selected = addresses[0] as
    | {
        line?: unknown;
        city?: unknown;
        state?: unknown;
        postalCode?: unknown;
      }
    | undefined;
  if (!selected) return undefined;
  const lines = Array.isArray(selected.line)
    ? selected.line.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  const city = typeof selected.city === "string" ? selected.city : undefined;
  const state = typeof selected.state === "string" ? selected.state : undefined;
  const postalCode = typeof selected.postalCode === "string" ? selected.postalCode : undefined;
  const locality = [city, state, postalCode].filter(Boolean).join(", ").replace(", ,", ",");
  return [...lines, locality].filter(Boolean).join(" · ") || undefined;
}

function patientTelecomLabels(patient: FhirResource): string[] {
  const telecoms = Array.isArray(patient.telecom) ? patient.telecom : [];
  return telecoms
    .flatMap((entry) => {
      const telecom = entry as { system?: unknown; value?: unknown; use?: unknown };
      if (typeof telecom.value !== "string" || !telecom.value.trim()) return [];
      const system = typeof telecom.system === "string" ? telecom.system : "contact";
      const use = typeof telecom.use === "string" ? telecom.use : undefined;
      return [[system, use, telecom.value].filter(Boolean).join(": ")];
    })
    .slice(0, 3);
}

function sourceScopedSummary(source: ConnectedSource, dataset: FhirDataset): ReferralSummary {
  const summary = buildReferralSummary(dataset.resources);
  const portalSourceName = sourceLabel(source);
  return {
    patient: summary.patient,
    medications: summary.medications.map((medication) => ({
      ...medication,
      id: `${source.id}:${medication.id}`,
      portalSourceId: source.id,
      portalSourceName
    })),
    allergies: summary.allergies.map((allergy) => ({
      ...allergy,
      id: `${source.id}:${allergy.id}`,
      portalSourceId: source.id,
      portalSourceName
    })),
    conditions: summary.conditions.map((condition) => ({
      ...condition,
      id: `${source.id}:${condition.id}`,
      portalSourceId: source.id,
      portalSourceName
    })),
    observations: summary.observations.map((observation) => ({
      ...observation,
      id: `${source.id}:${observation.id}`,
      portalSourceId: source.id,
      portalSourceName
    })),
    immunizations: summary.immunizations.map((immunization) => ({
      ...immunization,
      id: `${source.id}:${immunization.id}`,
      portalSourceId: source.id,
      portalSourceName
    })),
    encounters: summary.encounters.map((encounter) => ({
      ...encounter,
      id: `${source.id}:${encounter.id}`,
      portalSourceId: source.id,
      portalSourceName
    })),
    procedures: summary.procedures.map((procedure) => ({
      ...procedure,
      id: `${source.id}:${procedure.id}`,
      portalSourceId: source.id,
      portalSourceName
    })),
    diagnosticReports: summary.diagnosticReports.map((report) => ({
      ...report,
      id: `${source.id}:${report.id}`,
      portalSourceId: source.id,
      portalSourceName
    })),
    generatedAt: summary.generatedAt
  };
}

function mergeSourceSummaries(sourceSummaries: ReferralSummary[]): ReferralSummary | null {
  if (sourceSummaries.length === 0) return null;
  return {
    patient: sourceSummaries[0].patient,
    medications: sourceSummaries.flatMap((summary) => summary.medications),
    allergies: sourceSummaries.flatMap((summary) => summary.allergies),
    conditions: sourceSummaries.flatMap((summary) => summary.conditions),
    observations: sourceSummaries.flatMap((summary) => summary.observations),
    immunizations: sourceSummaries.flatMap((summary) => summary.immunizations),
    encounters: sourceSummaries.flatMap((summary) => summary.encounters),
    procedures: sourceSummaries.flatMap((summary) => summary.procedures),
    diagnosticReports: sourceSummaries.flatMap((summary) => summary.diagnosticReports),
    generatedAt: new Date().toISOString()
  };
}

function mergeSourceDatasets(sources: ConnectedSource[], datasets: Record<string, FhirDataset>): FhirDataset | null {
  const available = sources.flatMap((source) => {
    const dataset = datasets[source.id];
    return dataset ? [{ source, dataset }] : [];
  });
  if (available.length === 0) return null;

  return {
    patient: available[0].dataset.patient,
    resources: available.flatMap(({ dataset }) => dataset.resources),
    fetchedAt: Math.max(...available.map(({ dataset }) => dataset.fetchedAt)),
    vendor: available[0].dataset.vendor,
    referenceResolution: {
      fetched: available.reduce((total, item) => total + (item.dataset.referenceResolution?.fetched ?? 0), 0),
      unresolved: available.flatMap((item) => item.dataset.referenceResolution?.unresolved ?? []),
      skipped: available.flatMap((item) => item.dataset.referenceResolution?.skipped ?? [])
    }
  };
}

function compactMemberIds(record: GroupableRecord): string[] {
  return record.memberResourceIds?.length ? record.memberResourceIds : [record.id];
}

function normalizedGroupName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugGroupName(value: string): string {
  return normalizedGroupName(value).replace(/\s+/g, "-").slice(0, 60) || "group";
}

function isLocalModelCacheEntry(entry: GroupingCacheEntry): boolean {
  return (
    entry.model === TRANSFORMERS_LLM_MODEL_ID
  );
}

function cacheEntryCompleteForRecord(
  record: GroupableRecord,
  entry: GroupingCacheEntry | undefined,
  options: { allowLookup: boolean; modelId?: string } = { allowLookup: true }
): entry is GroupingCacheEntry {
  if (!entry || entry.resourceType !== record.resourceType) return false;
  if (entry.model !== PATIENT_FRIENDLY_LOOKUP_MODEL) {
    return options.modelId ? entry.model === options.modelId : isLocalModelCacheEntry(entry);
  }
  if (!options.allowLookup) return false;
  if (record.resourceType !== "Observation") return true;
  return Boolean(entry.observationBucket || observationBucketFromKnownCategory(record));
}

function upsertLookupEntriesWithoutReplacingModelResults(
  cache: GroupingCacheRecord,
  lookupEntries: GroupingCacheEntry[]
): GroupingCacheRecord {
  const existingById = groupingCacheByCompactId(cache);
  const safeLookupEntries = lookupEntries.filter((entry) => {
    const existing = existingById.get(entry.compactRecordId);
    return !existing || existing.model === PATIENT_FRIENDLY_LOOKUP_MODEL;
  });
  return safeLookupEntries.length ? upsertGroupingCacheEntries(cache, safeLookupEntries) : cache;
}

function cachedCompactGrouping(
  compactRecords: GroupableRecord[],
  cacheById: Map<string, GroupingCacheEntry>
): PatientGroupingResult {
  const groupsByName = new Map<string, PatientFriendlyGroup>();
  const usedModels = new Set<string>();

  for (const record of compactRecords) {
    const entry = cacheById.get(record.id);
    if (!cacheEntryCompleteForRecord(record, entry)) continue;
    usedModels.add(entry.model);
    const canonical = normalizedGroupName(entry.patientFriendlyName);
    const entryObservationBucket = entry.observationBucket ?? observationBucketFromKnownCategory(record);
    const existing = groupsByName.get(canonical);
    if (existing) {
      existing.resourceIds.push(record.id);
      if (!existing.resourceTypes.includes(record.resourceType)) existing.resourceTypes.push(record.resourceType);
      existing.confidence = Math.min(existing.confidence, entry.confidence);
      existing.fallback = existing.fallback || entry.fallback;
      existing.observationBucket = mergeObservationBucket(existing.observationBucket, entryObservationBucket);
      continue;
    }

    groupsByName.set(canonical, {
      groupId: `${record.resourceType.toLowerCase()}-${slugGroupName(entry.patientFriendlyName)}`,
      patientFriendlyName: entry.patientFriendlyName,
      resourceIds: [record.id],
      resourceTypes: [record.resourceType],
      observationBucket: entryObservationBucket,
      confidence: entry.confidence,
      reason: "Restored from local grouping cache.",
      fallback: entry.fallback
    });
  }

  return {
    groups: [...groupsByName.values()],
    unassigned: [],
    source:
      groupsByName.size === 0
        ? "source"
        : usedModels.size === 1 && usedModels.has(PATIENT_FRIENDLY_LOOKUP_MODEL)
          ? "lookup"
          : usedModels.has(PATIENT_FRIENDLY_LOOKUP_MODEL)
            ? "mixed"
            : "transformers"
  };
}

function cachedNamesForType(
  compactRecords: GroupableRecord[],
  cacheById: Map<string, GroupingCacheEntry>,
  options: { includeLookup?: boolean } = {}
): string[] {
  return [
    ...new Set(
      compactRecords
        .map((record) => cacheById.get(record.id))
        .filter((entry): entry is GroupingCacheEntry => Boolean(entry))
        .filter((entry) => options.includeLookup || entry.model !== PATIENT_FRIENDLY_LOOKUP_MODEL)
        .map((entry) => entry.patientFriendlyName)
    )
  ];
}

function compactIds(compactRecords: GroupableRecord[]): Set<string> {
  return new Set(compactRecords.map((record) => record.id));
}

function originalRecordsForCompactRecords(
  originalRecords: GroupableRecord[],
  compactRecords: GroupableRecord[]
): GroupableRecord[] {
  const ids = new Set(compactRecords.flatMap(compactMemberIds));
  return originalRecords.filter((record) => ids.has(record.id));
}

function expandedCachedGrouping(
  cachedCompactRecords: GroupableRecord[],
  cachedCompactResult: PatientGroupingResult,
  originalRecords: GroupableRecord[]
): PatientGroupingResult | null {
  if (cachedCompactRecords.length === 0 || cachedCompactResult.groups.length === 0) return null;
  return splitFallbackGroupsToSourceRecords(
    expandCompactGrouping(cachedCompactRecords, cachedCompactResult),
    originalRecords
  );
}

function progressiveTypeGrouping(
  update: NamingIncrementalUpdate,
  originalRecords: GroupableRecord[],
  cachedCompactRecords: GroupableRecord[] = [],
  cachedCompactResult: PatientGroupingResult = { groups: [], unassigned: [], source: "source" }
): PatientGroupingResult {
  const completedFallback = deterministicPatientGrouping(update.completedRecords);
  const validatedCompact = validateGroupingResult(update.completedRecords, update.result, completedFallback);
  const completedResults = [
    expandedCachedGrouping(cachedCompactRecords, cachedCompactResult, originalRecords),
    splitFallbackGroupsToSourceRecords(expandCompactGrouping(update.completedRecords, validatedCompact), originalRecords)
  ].filter((result): result is PatientGroupingResult => Boolean(result));
  const expandedCompleted = combineGroupingResults(completedResults);
  const pendingIds = new Set(update.pendingRecords.flatMap(compactMemberIds));
  const pendingRecords = originalRecords.filter((record) => pendingIds.has(record.id));
  const pendingResult = pendingRecords.length ? sourceRecordGrouping(pendingRecords) : null;

  return pendingResult ? combineGroupingResults([expandedCompleted, pendingResult]) : expandedCompleted;
}

function finalCachedTypeGrouping(
  cachedCompactRecords: GroupableRecord[],
  cachedCompactResult: PatientGroupingResult,
  uncachedCompactRecords: GroupableRecord[],
  originalRecords: GroupableRecord[]
): PatientGroupingResult {
  const cachedResult = expandedCachedGrouping(cachedCompactRecords, cachedCompactResult, originalRecords);
  const pendingResult = uncachedCompactRecords.length
    ? splitFallbackGroupsToSourceRecords(
        expandCompactGrouping(uncachedCompactRecords, deterministicPatientGrouping(uncachedCompactRecords)),
        originalRecords
      )
    : null;
  const results = [cachedResult, pendingResult].filter((result): result is PatientGroupingResult => Boolean(result));
  return results.length ? combineGroupingResults(results) : sourceRecordGrouping(originalRecords);
}

function cacheEntriesFromCompactResult(
  compactRecords: GroupableRecord[],
  result: PatientGroupingResult,
  modelId = TRANSFORMERS_LLM_MODEL_ID,
  now = Date.now()
): GroupingCacheEntry[] {
  const compactIdSet = compactIds(compactRecords);
  const recordsById = new Map(compactRecords.map((record) => [record.id, record]));
  return result.groups.flatMap((group) =>
    group.resourceIds
      .filter((id) => compactIdSet.has(id))
      .map((id) => {
        const record = recordsById.get(id);
        return record
          ? [
              {
                compactRecordId: id,
                resourceType: record.resourceType,
                patientFriendlyName: group.patientFriendlyName,
                observationBucket: group.observationBucket ?? observationBucketFromKnownCategory(record),
                confidence: group.confidence,
                fallback: group.fallback,
                model: modelId,
                updatedAt: now
              } satisfies GroupingCacheEntry
            ]
          : [];
      })
      .flat()
  );
}

function cacheEntriesFromPatientFriendlyLookup(
  compactRecords: GroupableRecord[],
  lookup: PatientFriendlyLookup,
  now = Date.now()
): GroupingCacheEntry[] {
  return compactRecords.flatMap((record) => {
    const result = lookupPatientFriendlyName(record, lookup);
    if (!result || result.needsModelFallback) return [];
    return [
      {
        compactRecordId: record.id,
        resourceType: record.resourceType,
        patientFriendlyName: result.patientFriendlyName,
        observationBucket: observationBucketFromKnownCategory(record),
        confidence: result.confidence,
        fallback: result.fallback,
        model: PATIENT_FRIENDLY_LOOKUP_MODEL,
        lookupSystem: result.system,
        lookupCode: result.code,
        friendlySource: result.friendlySource,
        matchType: result.matchType,
        updatedAt: now
      } satisfies GroupingCacheEntry
    ];
  });
}

function classificationCacheEntry(
  record: GroupableRecord,
  transform: ClassificationTransform,
  model: string,
  result: ClassificationCacheEntry["result"],
  now = Date.now()
): ClassificationCacheEntry {
  return {
    compactRecordId: record.id,
    resourceType: record.resourceType,
    transform,
    transformVersion: CLASSIFICATION_TRANSFORM_VERSIONS[transform],
    model,
    result,
    updatedAt: now
  };
}

function waitForBrowserPaint(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    window.setTimeout(done, 100);
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => window.setTimeout(done, 0));
    } else {
      window.setTimeout(done, 0);
    }
  });
}

function localModelFallbackIsRecoverable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return localModelFallbackMessageIsRecoverable(message);
}

function localModelFallbackMessageIsRecoverable(message: string): boolean {
  return (
    message.includes("WebLLM response did not contain a JSON object") ||
    message.includes("WebLLM response contained a JSON-like object") ||
    message.includes("WebLLM returned an empty naming") ||
    message.includes("Cannot pass non-string")
  );
}

function groupingConsoleLog(level: "info" | "warn" | "error", event: string, details: Record<string, unknown> = {}): void {
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    ...details
  };
  const prefix = `[fhir4px:grouping] ${event}`;
  let serialized = "";
  try {
    serialized = JSON.stringify(payload);
  } catch {
    serialized = JSON.stringify({ event, timestamp: payload.timestamp, serializationError: true });
  }
  if (typeof window !== "undefined") {
    const target = window as typeof window & { __FHIR4PX_GROUPING_LOGS__?: string[] };
    target.__FHIR4PX_GROUPING_LOGS__ = [...(target.__FHIR4PX_GROUPING_LOGS__ ?? []), `${prefix} ${serialized}`].slice(-300);
  }
  if (level === "error") console.error(`${prefix} ${serialized}`);
  else if (level === "warn") console.warn(`${prefix} ${serialized}`);
  else console.info(`${prefix} ${serialized}`);
}

function formatNamingDiagnostic(diagnostic: NamingDiagnostic): string {
  const count = diagnostic.affectedCount ?? diagnostic.affectedRecordIds?.length;
  const affected = count !== undefined ? `${count} concept${count === 1 ? "" : "s"}` : "unknown concept count";
  const scope = diagnostic.fallbackScope ? `${diagnostic.fallbackScope} fallback` : "diagnostic";
  const model = diagnostic.modelId ? `, model ${diagnostic.modelId}` : "";
  return `${diagnostic.phase}: ${scope} for ${affected}${model}. ${diagnostic.message}`;
}

async function loadGroupingCache(key: CryptoKey): Promise<GroupingCacheRecord> {
  try {
    const stored = await localVault.getJson<GroupingCacheRecord>(key, {
      type: "grouping-cache",
      id: GROUPING_CACHE_ID
    });
    return stored?.version === 1 ? stored : emptyGroupingCache();
  } catch {
    return emptyGroupingCache();
  }
}

async function saveGroupingCache(key: CryptoKey, cache: GroupingCacheRecord): Promise<void> {
  await localVault.putJson(key, { type: "grouping-cache", id: GROUPING_CACHE_ID }, cache);
}

async function loadClassificationCache(key: CryptoKey): Promise<ClassificationCacheRecord> {
  try {
    const stored = await localVault.getJson<ClassificationCacheRecord>(key, {
      type: "classification-cache",
      id: "local-classification"
    });
    return stored?.version === 1 ? stored : emptyClassificationCache();
  } catch {
    return emptyClassificationCache();
  }
}

async function saveClassificationCache(key: CryptoKey, cache: ClassificationCacheRecord): Promise<void> {
  await localVault.putJson(key, { type: "classification-cache", id: "local-classification" }, cache);
}

async function loadRelationshipCache(key: CryptoKey): Promise<RelationshipCacheRecord> {
  try {
    const stored = await localVault.getJson<RelationshipCacheRecord>(key, {
      type: "relationship-cache",
      id: RELATIONSHIP_CACHE_ID
    });
    return stored?.version === RELATIONSHIP_CACHE_VERSION ? stored : emptyRelationshipCache();
  } catch {
    return emptyRelationshipCache();
  }
}

async function saveRelationshipCache(key: CryptoKey, cache: RelationshipCacheRecord): Promise<void> {
  await localVault.putJson(key, { type: "relationship-cache", id: RELATIONSHIP_CACHE_ID }, cache);
}

export function PatientExplorer() {
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupingDiagnostics, setGroupingDiagnostics] = useState<string[]>([]);
  const [sources, setSources] = useState<ConnectedSource[]>([]);
  const [sourceDatasets, setSourceDatasets] = useState<Record<string, FhirDataset>>({});
  const [activeSourceId, setActiveSourceId] = useState("all");
  const [patches, setPatches] = useState<PatientPatch[]>([]);
  const [patientAuthoredRecords, setPatientAuthoredRecords] = useState<PatientAuthoredRecord[]>([]);
  const [groupingCache, setGroupingCache] = useState<GroupingCacheRecord>(() => emptyGroupingCache());
  const [classificationCache, setClassificationCache] = useState<ClassificationCacheRecord>(() => emptyClassificationCache());
  const [relationshipCache, setRelationshipCache] = useState<RelationshipCacheRecord>(() => emptyRelationshipCache());
  const [groups, setGroups] = useState<PatientFriendlyGroup[]>([]);
  const [groupingSource, setGroupingSource] = useState<ExplorerGroupingSource>("source");
  const [groupingProgress, setGroupingProgress] = useState<{ completed: number; total: number } | null>(null);
  const [activeTab, setActiveTab] = useState<ExplorerTab>("MedicationRequest");
  const [localGroupingMode, setLocalGroupingMode] = useState<LocalGroupingMode>("three-b-batch" as LocalGroupingMode);
  const [activeObservationBucket, setActiveObservationBucket] = useState<ObservationBucket>("labs");
  const [resourceStatusFilter, setResourceStatusFilter] = useState<ResourceStatusFilter>("active");
  const [visitClassFilter, setVisitClassFilter] = useState<VisitClassFilter>("all");
  const [viewMode, setViewMode] = useState<ExplorerViewMode>("grouped");
  const [groupSort, setGroupSort] = useState<GroupSortMode>("group-name");
  const [dateSort, setDateSort] = useState<DateSortMode>("newest");
  const [density, setDensity] = useState<ExplorerDensity>("comfortable");
  const [dataMenuAnchorEl, setDataMenuAnchorEl] = useState<HTMLElement | null>(null);
  const [webLlmWarmupStatus, setNamingWarmupStatus] = useState<NamingWarmupStatus>(() => getNamingWarmupStatus());
  const [selectedRecordKey, setSelectedRecordKey] = useState<string | null>(null);
  const [selectedMatchingRecordKeys, setSelectedMatchingRecordKeys] = useState<string[]>([]);
  const [selectedMatchReason, setSelectedMatchReason] = useState<string | null>(null);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set());
  const [addRecordDialogOpen, setAddRecordDialogOpen] = useState(false);
  const [newRecordType, setNewRecordType] = useState<PatientAuthoredResourceType>("MedicationRequest");
  const [newRecordText, setNewRecordText] = useState("");
  const [newRecordStatus, setNewRecordStatus] = useState(defaultStatusForPatientAuthoredType("MedicationRequest"));
  const [newRecordDate, setNewRecordDate] = useState("");
  const [newRecordDosage, setNewRecordDosage] = useState("");
  const [newRecordReaction, setNewRecordReaction] = useState("");
  const [newRecordCriticality, setNewRecordCriticality] = useState("");
  const [newRecordNote, setNewRecordNote] = useState("");
  const [selectedCodingOption, setSelectedCodingOption] = useState<PatientAuthoredCodingOption | null>(null);
  const [codingOptionsBySystem, setCodingOptionsBySystem] = useState<
    Partial<Record<PatientAuthoredOptionSystem, PatientAuthoredCodingOption[]>>
  >({});
  const [codingOptionsLoading, setCodingOptionsLoading] = useState(false);
  const [codingOptionsError, setCodingOptionsError] = useState<string | null>(null);
  const didAutoLoad = useRef(false);
  const groupingRunId = useRef(0);
  const queuedLocalModelSwitch = useRef(false);
  const lastAutoGroupingKey = useRef<string | null>(null);

  const filteredSources = useMemo(
    () => (activeSourceId === "all" ? sources : sources.filter((source) => source.id === activeSourceId)),
    [activeSourceId, sources]
  );

  const dataset = useMemo(() => mergeSourceDatasets(filteredSources, sourceDatasets), [filteredSources, sourceDatasets]);

  const summary = useMemo(() => {
    const sourceSummaries = filteredSources.flatMap((source) => {
      const sourceDataset = sourceDatasets[source.id];
      return sourceDataset ? [sourceScopedSummary(source, sourceDataset)] : [];
    });
    return mergeSourceSummaries(sourceSummaries);
  }, [filteredSources, sourceDatasets]);

  const patientProfiles = useMemo<PatientProfile[]>(
    () =>
      filteredSources.flatMap((source) => {
        const patient = sourceDatasets[source.id]?.patient;
        return patient ? [{ sourceId: source.id, sourceName: sourceLabel(source), patient }] : [];
      }),
    [filteredSources, sourceDatasets]
  );

  const records = useMemo(
    () => buildGroupableRecords(summary ?? emptyReferralSummary(), { patches, patientAuthoredRecords }),
    [summary, patches, patientAuthoredRecords]
  );

  const autoGroupingSignature = useMemo(
    () =>
      records
        .map((record) =>
          [
            record.resourceType,
            record.id,
            record.sourceLabel,
            record.date,
            record.status,
            record.hidden ? "hidden" : "",
            record.inactiveOverlay ? "inactive" : "",
            record.portalSourceId,
            record.groupingText,
            record.categoryCode,
            record.codeTexts?.join("~"),
            record.codingKeys?.join("~"),
            record.ingredients?.join("~"),
            record.dosageForm,
            record.route,
            record.unit,
            record.valueKind
          ].join(":")
        )
        .join("|"),
    [records]
  );

  const sourceGroups = useMemo(() => sourceRecordGrouping(records).groups, [records]);

  const displayGroups = groupingSource === "source" ? sourceGroups : groups;
  const selectedLocalModelId = TRANSFORMERS_LLM_MODEL_ID;

  const observationById = useMemo(() => {
    const map = new Map<string, ReferralSummary["observations"][number]>();
    for (const observation of summary?.observations ?? []) map.set(observation.id, observation);
    return map;
  }, [summary]);

  const resourceByKey = useMemo(() => {
    const map = new Map<string, FhirResource>();
    for (const source of filteredSources) {
      for (const resource of sourceDatasets[source.id]?.resources ?? []) {
        const scopedId = scopedResourceId(source.id, resource.id);
        const key = resourceKey(resource.resourceType, scopedId);
        if (key) map.set(key, resource);
      }
    }
    for (const record of patientAuthoredRecords) {
      if (!record.resource) continue;
      const key = resourceKey(record.resource.resourceType, record.id);
      if (key) map.set(key, record.resource as unknown as FhirResource);
    }
    return map;
  }, [filteredSources, patientAuthoredRecords, sourceDatasets]);

  const recordByKey = useMemo(() => {
    const map = new Map<string, GroupableRecord>();
    for (const record of records) map.set(recordKey(record), record);
    return map;
  }, [records]);

  const explicitRelationships = useMemo(
    () =>
      buildExplicitRecordRelationships(
        filteredSources.map((source) => ({
          sourceId: source.id,
          resources: sourceDatasets[source.id]?.resources ?? []
        }))
      ),
    [filteredSources, sourceDatasets]
  );

  const explicitRelationshipsByRecordKey = useMemo(
    () => relationshipMapByRecordKey(explicitRelationships),
    [explicitRelationships]
  );

  const groupByRelationshipKey = useMemo(() => {
    const map = new Map<string, PatientFriendlyGroup>();
    for (const group of displayGroups) map.set(relationshipGroupKey(group), group);
    return map;
  }, [displayGroups]);

  const groupByRecordKey = useMemo(() => {
    const map = new Map<string, PatientFriendlyGroup>();
    for (const group of displayGroups) {
      for (const id of group.resourceIds) {
        for (const resourceType of group.resourceTypes) {
          const key = resourceKey(resourceType, id);
          if (key && recordByKey.has(key) && !map.has(key)) map.set(key, group);
        }
      }
    }
    return map;
  }, [displayGroups, recordByKey]);

  const suggestedGroupRelationships = useMemo(
    () =>
      relationshipCache.entries.filter(
        (entry) =>
          entry.transform === "ObservationGroup.associateConditionGroup" &&
          entry.transformVersion === RELATIONSHIP_TRANSFORM_VERSIONS["ObservationGroup.associateConditionGroup"] &&
          (entry.model === selectedLocalModelId || entry.model.startsWith("deterministic:")) &&
          entry.relationship !== "none" &&
          groupByRelationshipKey.has(entry.sourceGroupId) &&
          groupByRelationshipKey.has(entry.targetGroupId)
      ),
    [groupByRelationshipKey, relationshipCache, selectedLocalModelId]
  );

  const selectedRecord = useMemo(
    () => (selectedRecordKey ? recordByKey.get(selectedRecordKey) ?? null : null),
    [recordByKey, selectedRecordKey]
  );

  const selectedRawResource = selectedRecord ? resourceByKey.get(recordKey(selectedRecord)) : undefined;
  const selectedMatchingRecords = useMemo(
    () =>
      selectedMatchingRecordKeys
        .map((key) => recordByKey.get(key))
        .filter((record): record is GroupableRecord => Boolean(record)),
    [recordByKey, selectedMatchingRecordKeys]
  );

  const compactClassificationRecords = useMemo(
    () => ({
      AllergyIntolerance: compactRecordsForModel(recordsByType(records, "AllergyIntolerance")),
      Encounter: compactRecordsForModel(recordsByType(records, "Encounter")),
      Observation: compactRecordsForModel(recordsByType(records, "Observation"))
    }),
    [records]
  );

  const allergyClassificationByRecordId = useMemo(() => {
    const map = new Map<string, AllergyClassification>();
    for (const compactRecord of compactClassificationRecords.AllergyIntolerance) {
      const entry = preferredClassificationEntry(
        classificationCache,
        "AllergyIntolerance.classifyAllergy",
        compactRecord.id
      );
      const result = (entry?.result as AllergyClassification | undefined) ?? deterministicAllergyClassification(compactRecord);
      for (const id of compactMemberIds(compactRecord)) map.set(id, result);
    }
    return map;
  }, [classificationCache, compactClassificationRecords]);

  const encounterVisitClassificationByRecordId = useMemo(() => {
    const map = new Map<string, EncounterVisitClassification>();
    for (const compactRecord of compactClassificationRecords.Encounter) {
      const entry = preferredClassificationEntry(classificationCache, "Encounter.classifyVisit", compactRecord.id);
      const result = (entry?.result as EncounterVisitClassification | undefined) ?? deterministicEncounterVisitClassification(compactRecord);
      for (const id of compactMemberIds(compactRecord)) map.set(id, result);
    }
    return map;
  }, [classificationCache, compactClassificationRecords]);

  const observationCategoryClassificationByRecordId = useMemo(() => {
    const map = new Map<string, ObservationCategoryClassification>();
    for (const compactRecord of compactClassificationRecords.Observation) {
      const entry = preferredClassificationEntry(classificationCache, "Observation.classifyCategory", compactRecord.id);
      const result =
        (entry?.result as ObservationCategoryClassification | undefined) ??
        deterministicObservationCategoryClassification(compactRecord);
      for (const id of compactMemberIds(compactRecord)) map.set(id, result);
    }
    return map;
  }, [classificationCache, compactClassificationRecords]);

  function allergyClassificationForRecord(record: GroupableRecord): AllergyClassification {
    return allergyClassificationByRecordId.get(record.id) ?? deterministicAllergyClassification(record);
  }

  function encounterVisitClassForRecord(record: GroupableRecord): EncounterVisitClass {
    return encounterVisitClassificationByRecordId.get(record.id)?.visitClass ?? deterministicEncounterVisitClassification(record).visitClass;
  }

  const activeSpecificAllergyDomains = useMemo(() => {
    const domains = new Set<AllergyDomain>();
    for (const record of recordsByType(records, "AllergyIntolerance")) {
      if (!recordStatusRollup(record).activeForFilter) continue;
      const classification = allergyClassificationByRecordId.get(record.id) ?? deterministicAllergyClassification(record);
      if (classification.assertionType !== "specific_allergy") continue;
      domains.add(classification.allergyDomain);
    }
    return domains;
  }, [allergyClassificationByRecordId, records]);

  function allergyGroupSuperseded(groupRecords: GroupableRecord[]): boolean {
    if (groupRecords.length === 0) return false;
    const groupStatus = groupStatusRollup(groupRecords);
    if (!groupStatus.activeForFilter) return false;
    return groupRecords.some((record) =>
      allergyNegativeAssertionSuperseded(allergyClassificationForRecord(record), activeSpecificAllergyDomains)
    );
  }

  function groupActiveForStatusFilter(group: PatientFriendlyGroup): boolean {
    const groupRecords = recordsForGroup(group);
    if (activeTab === "AllergyIntolerance" && allergyGroupSuperseded(groupRecords)) return false;
    return groupStatusRollup(groupRecords).activeForFilter;
  }

  function displayObservationBucket(record: GroupableRecord, observation?: ReferralSummary["observations"][number]): ObservationBucket {
    const classification = observationCategoryClassificationByRecordId.get(record.id);
    if (classification?.observationCategory && classification.observationCategory !== "unknown") {
      return classification.observationCategory;
    }
    return observationBucket(record, observation);
  }

  function displayObservationRecordInBucket(
    record: GroupableRecord,
    bucket: ObservationBucket,
    observation?: ReferralSummary["observations"][number]
  ): boolean {
    return record.resourceType !== "Observation" || displayObservationBucket(record, observation) === bucket;
  }

  function displayEncounterRecordInVisitClass(record: GroupableRecord, visitClass: VisitClassFilter): boolean {
    return record.resourceType !== "Encounter" || visitClass === "all" || encounterVisitClassForRecord(record) === visitClass;
  }

  const observationBucketCounts = useMemo(() => {
    const counts: Record<ObservationBucket, number> = { labs: 0, vitals: 0, other: 0 };
    for (const record of recordsByType(records, "Observation")) {
      counts[displayObservationBucket(record, observationById.get(record.id))] += 1;
    }
    return counts;
  }, [records, observationById, observationCategoryClassificationByRecordId]);

  const visitClassCounts = useMemo(() => {
    const counts = Object.fromEntries(VISIT_CLASS_FILTER_OPTIONS.map((option) => [option.value, 0])) as Record<VisitClassFilter, number>;
    for (const record of recordsByType(records, "Encounter")) {
      counts.all += 1;
      counts[encounterVisitClassForRecord(record)] += 1;
    }
    return counts;
  }, [encounterVisitClassificationByRecordId, records]);

  const newRecordOptionSystem = patientAuthoredOptionSystemForType(newRecordType);

  const newRecordCodingOptions = useMemo(
    () => (newRecordOptionSystem ? codingOptionsBySystem[newRecordOptionSystem] ?? [] : []),
    [codingOptionsBySystem, newRecordOptionSystem]
  );

  const filteredNewRecordCodingOptions = useMemo(
    () => searchPatientAuthoredCodingOptions(newRecordCodingOptions, newRecordText, 25),
    [newRecordCodingOptions, newRecordText]
  );

  const newRecordRequiredText = selectedCodingOption?.technicalName ?? newRecordText.trim();
  const addRecordCanSave =
    Boolean(newRecordRequiredText) &&
    Boolean(newRecordStatus) &&
    (newRecordType !== "Immunization" || Boolean(newRecordDate));

  function handleLocalGroupingModeChange(nextMode: LocalGroupingMode) {
    if (nextMode === localGroupingMode) return;
    setLocalGroupingMode(nextMode);
    lastAutoGroupingKey.current = null;
    setGroups([]);
    setExpandedGroupKeys(new Set());
    setGroupingSource("source");
    setGroupingDiagnostics([]);
    if (modelBusy) {
      queuedLocalModelSwitch.current = true;
      groupingRunId.current += 1;
      setGroupingProgress(null);
      const nextLabel = LOCAL_GROUPING_MODE_OPTIONS.find((option) => option.value === nextMode)?.label ?? "selected model";
      setStatus(`Switching to ${nextLabel} after the current local model step`);
    }
  }

  function showSourceRecords(message = "Records loaded") {
    groupingRunId.current += 1;
    setGroups([]);
    setExpandedGroupKeys(new Set());
    setGroupingSource("source");
    setGroupingProgress(null);
    setGroupingDiagnostics([]);
    setModelBusy(false);
    setStatus(message);
  }

  async function runPostGroupingClassification(
    nextRecords: GroupableRecord[],
    key: CryptoKey,
    options: {
      canRunLocalModel: boolean;
      selectedModelId: string;
      isCurrentRun: () => boolean;
    }
  ) {
    interface ClassificationPlan {
      transform: ClassificationTransform;
      records: GroupableRecord[];
      embeddingTask: string;
      deterministic?: (record: GroupableRecord) => ClassificationCacheEntry["result"];
    }

    const plans: ClassificationPlan[] = [
      {
        transform: "Observation.classifyCategory",
        records: compactRecordsForModel(recordsByType(nextRecords, "Observation")),
        embeddingTask: "observation_category"
        // No deterministic — embeddings are the authority for observation category.
        // FHIR category extensions are frequently wrong (vitals miscategorized as labs).
      },
      {
        transform: "AllergyIntolerance.classifyAllergy",
        records: compactRecordsForModel(recordsByType(nextRecords, "AllergyIntolerance")),
        embeddingTask: "allergy_type",
        deterministic: deterministicAllergyClassification
      },
      {
        transform: "Encounter.classifyVisit",
        records: compactRecordsForModel(recordsByType(nextRecords, "Encounter")),
        embeddingTask: "visit_type",
        deterministic: deterministicEncounterVisitClassification
      }
    ];
    const total = plans.reduce((sum, plan) => sum + plan.records.length, 0);
    if (total === 0) return;

    let cache = await loadClassificationCache(key);
    const upsertAndPersist = async (entries: ClassificationCacheEntry[]) => {
      if (entries.length === 0) return;
      cache = upsertClassificationCacheEntries(cache, entries);
      if (!options.isCurrentRun()) return;
      setClassificationCache(cache);
      await saveClassificationCache(key, cache);
    };

    function mapEmbeddingResult(
      transform: ClassificationTransform,
      className: string,
      confidence: number
    ): ClassificationCacheEntry["result"] {
      if (transform === "Observation.classifyCategory") {
        const bucket = className === "lab" ? "labs" : className === "vital" ? "vitals" : "other";
        return {
          observationCategory: bucket as PatientObservationBucket,
          confidence,
          fallback: false,
          source: "embedding"
        } as ObservationCategoryClassification;
      }
      if (transform === "AllergyIntolerance.classifyAllergy") {
        const domain = className === "medication" ? "drug" : className;
        return {
          assertionType: "specific_allergy",
          allergyDomain: domain as AllergyDomain,
          confidence,
          fallback: false,
          source: "embedding"
        } as AllergyClassification;
      }
      // Encounter.classifyVisit
      return {
        visitClass: className as EncounterVisitClass,
        confidence,
        fallback: false,
        source: "embedding"
      } as EncounterVisitClassification;
    }

    groupingConsoleLog("info", "classification-start", {
      totalConcepts: total,
      selectedModelId: options.selectedModelId,
      classifier: "embedding",
      plans: plans.map((plan) => ({ transform: plan.transform, count: plan.records.length }))
    });

    for (const plan of plans) {
      if (!options.isCurrentRun()) return;
      const needsEmbedding: GroupableRecord[] = [];

      for (const record of plan.records) {
        const existing = preferredClassificationEntry(cache, plan.transform, record.id);
        const hasEmbedding = existing?.model === "embedding";
        const hasAuthoritativeDet =
          plan.deterministic &&
          !hasEmbedding &&
          plan.deterministic(record).source === "fhir_category";

        if (hasEmbedding || hasAuthoritativeDet) {
          // Already classified by embeddings or authoritative deterministic
          if (hasAuthoritativeDet && !existing) {
            const det = plan.deterministic!(record);
            await upsertAndPersist([
              classificationCacheEntry(record, plan.transform, det.source, det)
            ]);
          }
          continue;
        }
        needsEmbedding.push(record);
      }

      if (needsEmbedding.length === 0) continue;

      setStatus(`Classifying ${plan.transform}... (${needsEmbedding.length} concepts)`);
      const texts = needsEmbedding.map((record) => record.sourceLabel || record.resourceType);
      groupingConsoleLog("info", "classification-embedding-batch", {
        transform: plan.transform,
        embeddingTask: plan.embeddingTask,
        count: needsEmbedding.length,
        sampleTexts: texts.slice(0, 5)
      });

      try {
        const results = await classifyBatch(plan.embeddingTask, texts);
        if (!options.isCurrentRun()) return;

        const entries: ClassificationCacheEntry[] = needsEmbedding.map((record, index) => {
          const result = mapEmbeddingResult(plan.transform, results[index].className, results[index].confidence);
          return classificationCacheEntry(record, plan.transform, "embedding", result);
        });
        await upsertAndPersist(entries);

        groupingConsoleLog("info", "classification-embedding-complete", {
          transform: plan.transform,
          count: needsEmbedding.length,
          results: needsEmbedding.map((record, index) => ({
            text: texts[index],
            predicted: results[index].className,
            confidence: Math.round(results[index].confidence * 100) / 100
          }))
        });
      } catch (caught) {
        groupingConsoleLog("warn", "classification-embedding-fallback", {
          transform: plan.transform,
          error: caught instanceof Error ? caught.message : String(caught)
        });
        // Fall back to deterministic for each record
        if (plan.deterministic) {
          for (const record of needsEmbedding) {
            const det = plan.deterministic(record);
            await upsertAndPersist([
              classificationCacheEntry(record, plan.transform, det.source, det)
            ]);
          }
        }
      }
    }

    if (!options.isCurrentRun()) return;
    groupingConsoleLog("info", "classification-complete", {
      totalConcepts: total,
      cacheEntryCount: cache.entries.length
    });
    setStatus("Records grouped and classified locally");
  }

  async function runPostGroupingRelationships(
    nextGroups: PatientFriendlyGroup[],
    nextRecords: GroupableRecord[],
    key: CryptoKey,
    options: {
      canRunLocalModel: boolean;
      selectedModelId: string;
      isCurrentRun: () => boolean;
      deterministicOnly?: boolean;
    }
  ) {
    const recordsById = new Map(nextRecords.map((record) => [record.id, record]));
    const nextRecordByKey = new Map(nextRecords.map((record) => [recordKey(record), record]));
    const recordsForNextGroup = (group: PatientFriendlyGroup) =>
      group.resourceIds
        .map((id) => recordsById.get(id))
        .filter((record): record is GroupableRecord => Boolean(record && !record.hidden));
    const relationshipRecordsForLabGroup = (group: PatientFriendlyGroup) =>
      completedObservationRecordsForRelationship(recordsForNextGroup(group));
    const nextGroupByRecordKey = new Map<string, PatientFriendlyGroup>();
    for (const group of nextGroups) {
      for (const id of group.resourceIds) {
        for (const resourceType of group.resourceTypes) {
          const key = resourceKey(resourceType, id);
          if (key && nextRecordByKey.has(key) && !nextGroupByRecordKey.has(key)) nextGroupByRecordKey.set(key, group);
        }
      }
    }
    const explicitRelatedContextForRecords = (groupRecords: GroupableRecord[]) => {
      const context = new Set<string>();
      for (const record of groupRecords) {
        for (const relationship of explicitRelationshipsByRecordKey.get(recordKey(record)) ?? []) {
          const relatedKey = otherRelationshipRecordKey(relationship, recordKey(record));
          const relatedRecord = nextRecordByKey.get(relatedKey);
          if (!relatedRecord) continue;
          const relatedGroup = nextGroupByRecordKey.get(relatedKey);
          context.add(
            [relationship.label, relatedGroup?.patientFriendlyName ?? relatedRecord.sourceLabel]
              .filter(Boolean)
              .join(": ")
          );
        }
      }
      return [...context].slice(0, 8);
    };
    const conditionGroups = nextGroups.filter((group) => group.resourceTypes.includes("Condition"));
    const conditionChoices = conditionGroups.map((group) => ({
      conditionGroupId: relationshipGroupKey(group),
      name: group.patientFriendlyName
    }));
    if (conditionChoices.length === 0) return;
    const conditionChoiceById = new Map(conditionChoices.map((choice) => [choice.conditionGroupId, choice]));

    const referencedConditionGroupIdsForRecords = (groupRecords: GroupableRecord[]) => {
      const groupIds = new Set<string>();
      for (const record of groupRecords) {
        if (record.resourceType !== "Observation") continue;
        for (const conditionRecordKey of conditionRecordKeysLinkedFromObservation(recordKey(record), explicitRelationshipsByRecordKey)) {
          const conditionGroup = nextGroupByRecordKey.get(conditionRecordKey);
          if (conditionGroup?.resourceTypes.includes("Condition")) groupIds.add(relationshipGroupKey(conditionGroup));
        }
      }
      return groupIds;
    };

    const conditionChoicesForLabGroup = (group: PatientFriendlyGroup) => {
      const referenced = referencedConditionGroupIdsForRecords(relationshipRecordsForLabGroup(group));
      return [
        ...conditionChoices.filter((choice) => referenced.has(choice.conditionGroupId)),
        ...conditionChoices.filter((choice) => !referenced.has(choice.conditionGroupId))
      ];
    };

    const labGroups = nextGroups.filter((group) => {
      if (!group.resourceTypes.includes("Observation")) return false;
      const relationshipRecords = relationshipRecordsForLabGroup(group);
      if (relationshipRecords.length === 0) return false;
      if (group.observationBucket === "labs") return true;
      return relationshipRecords.some(
        (record) => deterministicObservationCategoryClassification(record).observationCategory === "labs"
      );
    });

    let cache = await loadRelationshipCache(key);
    const upsertAndPersist = async (entries: RelationshipCacheEntry[]) => {
      if (entries.length === 0) return;
      cache = upsertRelationshipCacheEntries(cache, entries);
      if (!options.isCurrentRun()) return;
      setRelationshipCache(cache);
      await saveRelationshipCache(key, cache);
    };

    // ---- DETERMINISTIC LAB PASS (all lab groups, no model needed) ----
    // Runs for every lab group regardless of model availability. Catches the
    // common associations (HbA1c→Diabetes, BP→Hypertension, etc.) instantly
    // so the user sees results before the model finishes loading.
    if (labGroups.length > 0 && conditionChoices.length > 0) {
      groupingConsoleLog("info", "deterministic-lab-pass-start", {
        labGroupCount: labGroups.length,
        conditionGroupCount: conditionGroups.length
      });
      for (const group of labGroups) {
        if (!options.isCurrentRun()) return;
        const groupId = relationshipGroupKey(group);
        const deterministicConditions = await findDeterministicConditionsForLab(group.patientFriendlyName);
        if (deterministicConditions.length === 0) continue;
        const matchedGroupIds: string[] = [];
        for (const conditionName of deterministicConditions) {
          const match = conditionChoices.find((choice) => choice.name === conditionName);
          if (match) matchedGroupIds.push(match.conditionGroupId);
        }
        if (matchedGroupIds.length === 0) continue;
        const deterministicEntries = matchedGroupIds.map((targetGroupId) =>
          relationshipCacheEntry({
            sourceGroupId: groupId,
            targetGroupId,
            sourceResourceType: "Observation",
            targetResourceType: "Condition",
            relationship: "monitoring_marker",
            confidence: 1,
            fallback: false,
            model: "deterministic:condition-lab"
          })
        );
        await upsertAndPersist(deterministicEntries);
        groupingConsoleLog("info", "deterministic-lab-pass-match", {
          labGroupId: groupId,
          labName: group.patientFriendlyName,
          matchedConditionNames: deterministicConditions,
          matchedGroupIds
        });
      }
    }

    // ---- DETERMINISTIC VITALS PASS ----
    const nonLabObservationGroups = nextGroups.filter((group) => {
      if (!group.resourceTypes.includes("Observation")) return false;
      if (labGroups.includes(group)) return false;
      return relationshipRecordsForLabGroup(group).length > 0;
    });
    if (nonLabObservationGroups.length > 0 && conditionChoices.length > 0) {
      groupingConsoleLog("info", "vitals-relationship-suggestion-start", {
        nonLabObservationGroupCount: nonLabObservationGroups.length
      });
      for (const group of nonLabObservationGroups) {
        if (!options.isCurrentRun()) return;
        const groupId = relationshipGroupKey(group);
        const deterministicConditions = await findDeterministicConditionsForLab(group.patientFriendlyName);
        if (deterministicConditions.length === 0) continue;
        const matchedGroupIds: string[] = [];
        for (const conditionName of deterministicConditions) {
          const match = conditionChoices.find((choice) => choice.name === conditionName);
          if (match) matchedGroupIds.push(match.conditionGroupId);
        }
        if (matchedGroupIds.length === 0) continue;
        const deterministicEntries = matchedGroupIds.map((targetGroupId) =>
          relationshipCacheEntry({
            sourceGroupId: groupId,
            targetGroupId,
            sourceResourceType: "Observation",
            targetResourceType: "Condition",
            relationship: "monitoring_marker",
            confidence: 1,
            fallback: false,
            model: "deterministic:condition-lab"
          })
        );
        await upsertAndPersist(deterministicEntries);
        groupingConsoleLog("info", "vitals-relationship-suggestion-deterministic", {
          observationGroupId: groupId,
          observationName: group.patientFriendlyName,
          matchedConditionNames: deterministicConditions,
          matchedGroupIds
        });
      }
    }

    // ---- DETERMINISTIC MEDICATION PASS ----
    const medicationGroups = nextGroups.filter(
      (group) =>
        group.resourceTypes.includes("MedicationRequest") &&
        recordsForNextGroup(group).length > 0
    );
    if (medicationGroups.length > 0 && conditionChoices.length > 0) {
      groupingConsoleLog("info", "medication-relationship-suggestion-start", {
        medicationGroupCount: medicationGroups.length,
        conditionGroupCount: conditionGroups.length
      });
      for (const group of medicationGroups) {
        if (!options.isCurrentRun()) return;
        const groupId = relationshipGroupKey(group);
        setStatus(`Linking medications to conditions...`);
        const rxnormCodes = Array.from(
          new Set(
            recordsForNextGroup(group).flatMap((record) =>
              (record.codingKeys ?? [])
                .filter((k) => k.startsWith("rxnorm:"))
                .map((k) => k.slice("rxnorm:".length))
            )
          )
        );
        const deterministicConditions = await findDeterministicConditionsForMedication(
          group.patientFriendlyName,
          rxnormCodes.length > 0 ? { rxnormCodes } : undefined
        );
        if (deterministicConditions.length === 0) continue;
        const matchedGroupIds: string[] = [];
        for (const conditionName of deterministicConditions) {
          const match = conditionChoices.find((choice) => choice.name === conditionName);
          if (match) matchedGroupIds.push(match.conditionGroupId);
        }
        if (matchedGroupIds.length === 0) continue;
        const deterministicEntries = matchedGroupIds.map((targetGroupId) =>
          relationshipCacheEntry({
            sourceGroupId: groupId,
            targetGroupId,
            sourceResourceType: "MedicationRequest",
            targetResourceType: "Condition",
            relationship: "treatment",
            confidence: 1,
            fallback: false,
            model: "deterministic:condition-med"
          })
        );
        await upsertAndPersist(deterministicEntries);
        groupingConsoleLog("info", "medication-relationship-suggestion-deterministic", {
          medicationGroupId: groupId,
          medicationName: group.patientFriendlyName,
          matchedConditionNames: deterministicConditions,
          matchedGroupIds
        });
      }
    }

    if (!options.isCurrentRun()) return;
    groupingConsoleLog("info", "deterministic-pass-complete", {
      cacheEntryCount: cache.entries.length
    });

    // If deterministic-only mode or model unavailable, we're done. The LLM
    // enrichment below is for labs not covered by the deterministic table.
    if (options.deterministicOnly || !options.canRunLocalModel) {
      groupingConsoleLog("info", "relationship-suggestion-complete", {
        processedCount: 0,
        cacheEntryCount: cache.entries.length,
        reason: options.deterministicOnly ? "deterministic-only" : "model-unavailable"
      });
      setStatus("Records grouped, classified, and linked locally");
      return;
    }

    // ---- LLM ENRICHMENT (labs without deterministic matches) ----
    const enrichmentLabGroups = labGroups.filter((group) => {
      const groupId = relationshipGroupKey(group);
      const entries = relationshipEntriesForSourceGroup(cache, "ObservationGroup.associateConditionGroup", groupId);
      // Skip labs that already have a positive deterministic entry
      const hasDeterministicMatch = entries.some(
        (entry) => entry.model.startsWith("deterministic:") && entry.relationship !== "none"
      );
      if (hasDeterministicMatch) return false;
      // Skip labs already processed by this model
      return !entries.some((entry) => entry.model === options.selectedModelId);
    });
    const explicitContextByLabGroupId = new Map<string, string[]>(
      enrichmentLabGroups.map((group) => {
        const groupRecords = relationshipRecordsForLabGroup(group);
        const referencedConditionContext = [...referencedConditionGroupIdsForRecords(groupRecords)]
          .map((conditionGroupId) => conditionChoiceById.get(conditionGroupId)?.name)
          .filter((name): name is string => Boolean(name))
          .map((name) => `Referenced condition candidate: ${name}`);
        return [
          relationshipGroupKey(group),
          [...referencedConditionContext, ...explicitRelatedContextForRecords(groupRecords)].slice(0, 8)
        ];
      })
    );

    groupingConsoleLog("info", "llm-enrichment-start", {
      labGroupCount: labGroups.length,
      enrichmentLabGroupCount: enrichmentLabGroups.length,
      conditionGroupCount: conditionGroups.length,
      selectedModelId: options.selectedModelId
    });

    for (let index = 0; index < enrichmentLabGroups.length; index += 1) {
      if (!options.isCurrentRun()) return;
      const group = enrichmentLabGroups[index];
      const groupId = relationshipGroupKey(group);
      const groupRecords = relationshipRecordsForLabGroup(group);
      const explicitRelatedContext = explicitContextByLabGroupId.get(groupId) ?? [];
      const orderedConditionChoices = conditionChoicesForLabGroup(group);
      setStatus(`Enriching lab associations... ${index + 1}/${enrichmentLabGroups.length}`);

      // Deterministic re-check (safety net — same lookup as the upfront pass).
      const deterministicConditions = await findDeterministicConditionsForLab(group.patientFriendlyName);
      if (deterministicConditions.length > 0) {
        const matchedGroupIds: string[] = [];
        for (const conditionName of deterministicConditions) {
          const match = conditionChoices.find((choice) => choice.name === conditionName);
          if (match) matchedGroupIds.push(match.conditionGroupId);
        }
        if (matchedGroupIds.length > 0) {
          const deterministicEntries = matchedGroupIds.map((targetGroupId) =>
            relationshipCacheEntry({
              sourceGroupId: groupId,
              targetGroupId,
              sourceResourceType: "Observation",
              targetResourceType: "Condition",
              relationship: "monitoring_marker",
              confidence: 1,
              fallback: false,
              model: "deterministic:condition-lab"
            })
          );
          await upsertAndPersist(deterministicEntries);
          groupingConsoleLog("info", "relationship-suggestion-deterministic", {
            labGroupId: groupId,
            labName: group.patientFriendlyName,
            matchedConditionNames: deterministicConditions,
            matchedGroupIds
          });
          continue;
        }
      }
      try {
        const labGroupContext: LabGroupContext = {
          groupId: group.groupId ?? relationshipGroupKey(group),
          patientFriendlyName: group.patientFriendlyName,
          resourceIds: group.resourceIds,
          resourceTypes: group.resourceTypes
        };
        const associations = await associateLabGroupWithConditions(labGroupContext, orderedConditionChoices, {
          explicitRelatedContext,
          onProgress: (message) => {
            if (options.isCurrentRun()) setStatus(message);
          }
        });
        if (!options.isCurrentRun()) return;
        const entries =
          associations.length > 0
            ? associations.map((association) =>
                relationshipCacheEntry({
                  sourceGroupId: groupId,
                  targetGroupId: association.conditionGroupId,
                  sourceResourceType: "Observation",
                  targetResourceType: "Condition",
                  relationship: association.relationship,
                  confidence: association.confidence,
                  fallback: association.fallback,
                  model: options.selectedModelId
                })
              )
            : [
                relationshipCacheEntry({
                  sourceGroupId: groupId,
                  targetGroupId: "__none__",
                  sourceResourceType: "Observation",
                  targetResourceType: "Condition",
                  relationship: "none",
                  confidence: 0,
                  fallback: true,
                  model: options.selectedModelId
                })
              ];
        await upsertAndPersist(entries);

        // Telemetry for model-vs-deterministic agreement. The deterministic
        // layer (FHIR references) and the model are now both running on every
        // lab group; comparing them surfaces model regressions early without
        // hardcoding the defense back in.
        const deterministicGroupIds = [...referencedConditionGroupIdsForRecords(groupRecords)];
        const modelGroupIds = associations.map((association) => association.conditionGroupId);
        const modelMatchedDeterministic =
          modelGroupIds.length > 0 &&
          deterministicGroupIds.length > 0 &&
          modelGroupIds.some((id) => deterministicGroupIds.includes(id));
        groupingConsoleLog("info", "relationship-suggestion-group-complete", {
          labGroupId: groupId,
          labName: group.patientFriendlyName,
          acceptedAssociationCount: associations.length,
          acceptedConditionGroupIds: modelGroupIds,
          confidenceValues: associations.map((association) => association.confidence),
          conditionChoiceCount: orderedConditionChoices.length,
          conditionChoiceNames: orderedConditionChoices.map((choice) => choice.name),
          eligibleRecordCount: groupRecords.length,
          referenceContextCount: explicitRelatedContext.length,
          referenceContext: explicitRelatedContext,
          deterministicReferencedGroupIds: deterministicGroupIds,
          modelMatchedDeterministic,
          modelDisagreedWithDeterministic:
            deterministicGroupIds.length > 0 && (modelGroupIds.length === 0 || !modelMatchedDeterministic)
        });
      } catch (caught) {
        groupingConsoleLog("warn", "relationship-suggestion-fallback", {
          labGroupId: groupId,
          error: caught instanceof Error ? caught.message : String(caught)
        });
      }
    }

    if (!options.isCurrentRun()) return;
    groupingConsoleLog("info", "relationship-suggestion-complete", {
      processedCount: enrichmentLabGroups.length,
      cacheEntryCount: cache.entries.length
    });
    setStatus("Records grouped, classified, and linked locally");
    setStatus("Records grouped, classified, and linked locally");
  }

  async function refineGroupingWithModel(nextRecords = records) {
    const runId = groupingRunId.current + 1;
    groupingRunId.current = runId;
    const isCurrentRun = () => groupingRunId.current === runId;
    setError(null);
    setGroupingDiagnostics([]);
    setExpandedGroupKeys(new Set());
    groupingConsoleLog("info", "refine-start", {
      runId,
      totalRecords: nextRecords.length,
      activeTab,
      localGroupingMode,
      localGroupingModelId: TRANSFORMERS_LLM_MODEL_ID,
      localGroupingBatchSize: incrementalNamingBatchSize({}),
      resourceCounts: (Object.keys(RESOURCE_LABELS) as ExplorerTab[]).reduce<Record<string, number>>((counts, type) => {
        counts[type] = recordsByType(nextRecords, type).length;
        return counts;
      }, {})
    });
    try {
      const key = await getOrCreateSessionVaultKey();
      let cache = await loadGroupingCache(key);
      let cacheById = groupingCacheByCompactId(cache);
      const selectedModelId = TRANSFORMERS_LLM_MODEL_ID;
      const canRunLocalModel = browserCanAttemptNaming();
      groupingConsoleLog("info", "cache-loaded", {
        runId,
        cacheEntryCount: cache.entries.length,
        cacheUpdatedAt: cache.updatedAt
      });
      setStatus("Applying patient-friendly terminology lookup");
      const basePlans = resourceTypesWithActiveFirst(activeTab).map((type) => {
        const subset = recordsByType(nextRecords, type);
        const compactRecords = compactRecordsForModel(subset);
        return { type, subset, compactRecords };
      });
      groupingConsoleLog("info", "compact-records-built", {
        runId,
        plans: basePlans.map((plan) => ({
          type: plan.type,
          sourceRecordCount: plan.subset.length,
          compactConceptCount: plan.compactRecords.length,
          compactRecordIds: plan.compactRecords.map((record) => record.id)
        }))
      });
      const lookup = await loadPatientFriendlyLookupForRecords(basePlans.flatMap((plan) => plan.compactRecords));
      const lookupEntries = basePlans.flatMap((plan) =>
        cacheEntriesFromPatientFriendlyLookup(plan.compactRecords, lookup)
      );
      groupingConsoleLog("info", "lookup-applied", {
        runId,
        lookupEntryCount: lookupEntries.length,
        lookupEntriesByType: (Object.keys(RESOURCE_LABELS) as ExplorerTab[]).reduce<Record<string, number>>((counts, type) => {
          counts[type] = lookupEntries.filter((entry) => entry.resourceType === type).length;
          return counts;
        }, {}),
        loadedLookupSystems: Object.keys(lookup)
      });
      if (lookupEntries.length > 0) {
        cache = upsertLookupEntriesWithoutReplacingModelResults(cache, lookupEntries);
        cacheById = groupingCacheByCompactId(cache);
        setGroupingCache(cache);
        await saveGroupingCache(key, cache);
      }
      const plans = basePlans.map(({ type, subset, compactRecords }) => {
        const completeOptions = {
          allowLookup: true,
          modelId: selectedModelId
        };
        const cachedCompactRecords = compactRecords.filter((record) =>
          cacheEntryCompleteForRecord(record, cacheById.get(record.id), completeOptions)
        );
        const uncachedCompactRecords = compactRecords.filter(
          (record) => !cacheEntryCompleteForRecord(record, cacheById.get(record.id), completeOptions)
        );
        const cachedCompactResult = cachedCompactGrouping(cachedCompactRecords, cacheById);
        return {
          type,
          subset,
          compactRecords,
          cachedCompactRecords,
          uncachedCompactRecords,
          cachedCompactResult
        };
      });
      const totalUncachedClusters = plans.reduce((total, plan) => total + plan.uncachedCompactRecords.length, 0);
      groupingConsoleLog("info", "refine-plan", {
        runId,
        totalUncachedConcepts: totalUncachedClusters,
        plans: plans.map((plan) => ({
          type: plan.type,
          sourceRecordCount: plan.subset.length,
          compactConceptCount: plan.compactRecords.length,
          cachedConceptCount: plan.cachedCompactRecords.length,
          uncachedConceptCount: plan.uncachedCompactRecords.length,
          selectedModelId,
          lookupAllowedAsComplete: true,
          uncachedRecordIds: plan.uncachedCompactRecords.map((record) => record.id)
        }))
      });
      const workingResults = new Map<ExplorerTab, PatientGroupingResult>();
      for (const plan of plans) {
        workingResults.set(
          plan.type,
          finalCachedTypeGrouping(
            plan.cachedCompactRecords,
            plan.cachedCompactResult,
            plan.uncachedCompactRecords,
            plan.subset
          )
        );
      }
      const initialCombined = combineGroupingResults([...workingResults.values()]);
      setGroups(initialCombined.groups);
      setGroupingSource(initialCombined.source);
      setGroupingCache(cache);

      // FIRST deterministic pass — runs on lookup-named groups before the
      // model loads. Catches HbA1c→Diabetes, BP→Hypertension, Metformin→
      // Diabetes, etc. instantly. The user sees these associations while the
      // model is still downloading/loading.
      await runPostGroupingRelationships(initialCombined.groups, nextRecords, key, {
        canRunLocalModel,
        selectedModelId,
        isCurrentRun,
        deterministicOnly: true
      });

      if (totalUncachedClusters === 0) {
        groupingConsoleLog("info", "refine-complete-from-cache", {
          runId,
          lookupEntryCount: lookupEntries.length,
          cacheEntryCount: cache.entries.length
        });
        setStatus(lookupEntries.length ? "Records grouped from patient-friendly lookup and local cache" : "Records grouped from local cache");
        setGroupingProgress(null);
        await runPostGroupingClassification(nextRecords, key, {
          canRunLocalModel,
          selectedModelId,
          isCurrentRun
        });
        await runPostGroupingRelationships(initialCombined.groups, nextRecords, key, {
          canRunLocalModel,
          selectedModelId,
          isCurrentRun
        });
        return;
      }

      if (!canRunLocalModel) {
        groupingConsoleLog("warn", "naming-unavailable", {
          runId,
          reason: "WebGPU unavailable or webdriver browser",
          totalUncachedConcepts: totalUncachedClusters
        });
        setStatus(
          lookupEntries.length
            ? "Patient-friendly lookup applied; local model unavailable for remaining records"
            : "Cached groups restored; local model unavailable for new records"
        );
        setGroupingProgress(null);
        await runPostGroupingClassification(nextRecords, key, {
          canRunLocalModel: false,
          selectedModelId,
          isCurrentRun
        });
        // Deterministic relationships already ran in the upfront pass above.
        // LLM enrichment is skipped because the model is unavailable.
        return;
      }

      setModelBusy(true);
      setStatus("Organizing medical records...");
      setGroupingProgress({ completed: 0, total: totalUncachedClusters });

      const failures: string[] = [];
      const diagnostics: string[] = [];
      const reportDiagnostic = (diagnostic: NamingDiagnostic) => {
        const formatted = formatNamingDiagnostic(diagnostic);
        console.warn("[fhir4px:local-grouping]", {
          ...diagnostic,
          formatted,
          uiVisible: !diagnostic.recovered,
          note: "Resource ids are local FHIR ids or compact cluster ids."
        });
        if (diagnostic.recovered) return;
        diagnostics.push(formatted);
        if (isCurrentRun()) setGroupingDiagnostics([...diagnostics]);
      };
      let completedBeforeType = 0;
      for (const { type, subset, compactRecords, cachedCompactRecords, uncachedCompactRecords, cachedCompactResult } of plans) {
        if (!isCurrentRun()) return;
        if (subset.length === 0 || uncachedCompactRecords.length === 0) {
          continue;
        }
        groupingConsoleLog("info", "resource-type-refine-start", {
          runId,
          type,
          sourceRecordCount: subset.length,
          compactConceptCount: compactRecords.length,
          cachedConceptCount: cachedCompactRecords.length,
          uncachedConceptCount: uncachedCompactRecords.length,
          uncachedRecordIds: uncachedCompactRecords.map((record) => record.id)
        });
        setStatus("Organizing medical records...");

        try {
          for await (const update of groupWithNamingIncrementalStream(uncachedCompactRecords, {
            initialAvailableNames: cachedNamesForType(compactRecords, cacheById, { includeLookup: true }),
            onDiagnostic: reportDiagnostic,
            onProgress: (message) => {
              if (isCurrentRun()) setStatus(message);
            }
          })) {
            if (!isCurrentRun()) return;
            const updateFallback = deterministicPatientGrouping(update.completedRecords);
            const updateCompactResult = validateGroupingResult(update.completedRecords, update.result, updateFallback);
            const nextEntries = cacheEntriesFromCompactResult(
              update.completedRecords,
              updateCompactResult,
              selectedModelId
            );
            if (nextEntries.length > 0) {
              cache = upsertGroupingCacheEntries(cache, nextEntries);
              cacheById = groupingCacheByCompactId(cache);
              setGroupingCache(cache);
              await saveGroupingCache(key, cache);
            }

            workingResults.set(type, progressiveTypeGrouping(update, subset, cachedCompactRecords, cachedCompactResult));
            const combined = combineGroupingResults([...workingResults.values()]);
            const completed = completedBeforeType + update.completedCount;
            flushSync(() => {
              setGroups(combined.groups);
              setGroupingSource(combined.source);
              setGroupingProgress({ completed, total: totalUncachedClusters });
              setStatus(`Organizing medical records... ${completed}/${totalUncachedClusters}`);
            });
            await waitForBrowserPaint();
            if (!isCurrentRun()) return;
          }
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "model failed";
          groupingConsoleLog("error", "resource-type-refine-failed", {
            runId,
            type,
            sourceRecordCount: subset.length,
            uncachedConceptCount: uncachedCompactRecords.length,
            uncachedRecordIds: uncachedCompactRecords.map((record) => record.id),
            error: message
          });
          reportDiagnostic({
            phase: `${RESOURCE_LABELS[type]} resource-type refinement`,
            affectedRecordIds: uncachedCompactRecords.map((record) => record.id),
            affectedCount: uncachedCompactRecords.length,
            fallbackScope: "resource-type",
            message: `All uncached ${RESOURCE_LABELS[type].toLowerCase()} concepts for this resource type fell back to source labels. ${message}`
          });
          if (!localModelFallbackIsRecoverable(caught)) {
            failures.push(`${RESOURCE_LABELS[type]}: ${message}`);
          }
          workingResults.set(
            type,
            finalCachedTypeGrouping(
              cachedCompactRecords,
              cachedCompactResult,
              uncachedCompactRecords,
              subset
            )
          );
          const combined = combineGroupingResults([...workingResults.values()]);
          flushSync(() => {
            setGroups(combined.groups);
            setGroupingSource(combined.source);
            setGroupingProgress({
              completed: completedBeforeType + uncachedCompactRecords.length,
              total: totalUncachedClusters
            });
          });
          await waitForBrowserPaint();
          if (!isCurrentRun()) return;
        }
        completedBeforeType += uncachedCompactRecords.length;
      }
      if (!isCurrentRun()) return;
      const combined = combineGroupingResults([...workingResults.values()]);
      const visibleFailures = failures.filter((failure) => !localModelFallbackMessageIsRecoverable(failure));
      groupingConsoleLog("info", "refine-complete", {
        runId,
        groupCount: combined.groups.length,
        groupingSource: combined.source,
        diagnosticCount: diagnostics.length,
        visibleFailureCount: visibleFailures.length
      });
      setGroups(combined.groups);
      setGroupingSource(combined.source);
      setGroupingDiagnostics(diagnostics);
      setStatus(
        visibleFailures.length || diagnostics.length
          ? "Records grouped locally with documented fallback"
          : "Records grouped locally"
      );
      setError(
        visibleFailures.length
          ? `Local grouping fallback details: ${visibleFailures.join("; ")}`
          : null
      );
      await runPostGroupingClassification(nextRecords, key, {
        canRunLocalModel,
        selectedModelId,
        isCurrentRun
      });
      await runPostGroupingRelationships(combined.groups, nextRecords, key, {
        canRunLocalModel,
        selectedModelId,
        isCurrentRun
      });
    } catch (caught) {
      if (isCurrentRun()) {
        groupingConsoleLog("error", "refine-failed", {
          runId,
          error: caught instanceof Error ? caught.message : String(caught)
        });
        showSourceRecords("Local model failed; showing source records");
        setError(caught instanceof Error ? `Local grouping model failed: ${caught.message}` : "Local grouping model failed");
      }
    } finally {
      if (isCurrentRun()) {
        setModelBusy(false);
        setGroupingProgress(null);
      } else if (queuedLocalModelSwitch.current) {
        queuedLocalModelSwitch.current = false;
        setModelBusy(false);
        setGroupingProgress(null);
      }
    }
  }

  async function loadLocalData(autoFetch = false) {
    setError(null);
    try {
      const key = await getOrCreateSessionVaultKey();
      const nextSources = await ensureConnectedSources(key);
      const nextPatches = await localVault.listJson<PatientPatch>(key, "patient-patch");
      const nextPatientRecords = await localVault.listJson<PatientAuthoredRecord>(key, "patient-authored-record");
      const nextGroupingCache = await loadGroupingCache(key);
      const nextClassificationCache = await loadClassificationCache(key);
      const nextRelationshipCache = await loadRelationshipCache(key);
      const nextDatasets: Record<string, FhirDataset> = {};
      for (const source of nextSources) {
        const sourceDataset = await getSourceDataset(key, source.id);
        if (sourceDataset) nextDatasets[source.id] = sourceDataset;
      }

      setSources(nextSources);
      setSourceDatasets(nextDatasets);
      setPatches(nextPatches);
      setPatientAuthoredRecords(nextPatientRecords);
      setGroupingCache(nextGroupingCache);
      setClassificationCache(nextClassificationCache);
      setRelationshipCache(nextRelationshipCache);
      if (nextSources.length === 0) {
        setStatus("Add a portal to fetch records");
        return;
      }
      if (Object.keys(nextDatasets).length > 0) showSourceRecords("Records loaded from local vault");
      if (autoFetch) {
        const missing = nextSources.filter((source) => !nextDatasets[source.id] || source.status === "connected");
        if (missing.length > 0) await refreshSources(missing, nextSources, nextDatasets, nextPatches, nextPatientRecords);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load local portal connections");
      setStatus("Load failed");
    }
  }

  async function refreshSources(
    targets = sources,
    nextSources = sources,
    baseDatasets = sourceDatasets,
    nextPatches = patches,
    nextPatientRecords = patientAuthoredRecords
  ) {
    if (targets.length === 0) {
      await loadLocalData(true);
      return;
    }
    setError(null);
    setBusy(true);
    setStatus("Downloading medical records...");
    let workingSources = nextSources;
    const workingDatasets = { ...baseDatasets };

    try {
      const key = await getOrCreateSessionVaultKey();
      for (const source of targets) {
        const result = await fetchAndStoreSourceDataset(key, source, {
          onStatus(updated) {
            workingSources = workingSources.map((candidate) => (candidate.id === updated.id ? updated : candidate));
            setSources(workingSources);
            setStatus(updated.status === "fetching" ? "Downloading medical records..." : `${sourceLabel(updated)} ${updated.status}`);
          }
        });
        workingSources = workingSources.map((candidate) => (candidate.id === result.source.id ? result.source : candidate));
        workingDatasets[result.source.id] = result.dataset;
        setSources(workingSources);
        setSourceDatasets({ ...workingDatasets });
      }

      showSourceRecords(targets.length === 1 ? "Records loaded" : "All portal records loaded");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "FHIR fetch failed");
      setStatus("Fetch failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (didAutoLoad.current) return;
    didAutoLoad.current = true;
    void loadLocalData(true);
  }, []);

  useEffect(() => subscribeNamingWarmupStatus(setNamingWarmupStatus), []);

  useEffect(() => {
    const onSmartAuthComplete = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (isSmartAuthPopupMessage(detail) && detail.type === "fhir4px.smartAuth.complete") {
        void loadLocalData(true);
      }
    };

    window.addEventListener(SMART_AUTH_POPUP_EVENT, onSmartAuthComplete);
    return () => window.removeEventListener(SMART_AUTH_POPUP_EVENT, onSmartAuthComplete);
  }, []);

  useEffect(() => {
    if (!browserCanAttemptNaming() || records.length === 0 || busy || modelBusy) return;
    const key = `${activeSourceId}|${localGroupingMode}|${autoGroupingSignature}`;
    if (lastAutoGroupingKey.current === key) return;
    lastAutoGroupingKey.current = key;
    void refineGroupingWithModel(records);
  }, [activeSourceId, autoGroupingSignature, busy, localGroupingMode, modelBusy, records]);

  useEffect(() => {
    if (!addRecordDialogOpen || !newRecordOptionSystem || codingOptionsBySystem[newRecordOptionSystem]) return;

    let cancelled = false;
    setCodingOptionsLoading(true);
    setCodingOptionsError(null);
    loadPatientAuthoredCodingOptions(newRecordOptionSystem)
      .then((options) => {
        if (cancelled) return;
        setCodingOptionsBySystem((current) => ({ ...current, [newRecordOptionSystem]: options }));
      })
      .catch((caught) => {
        if (cancelled) return;
        setCodingOptionsError(caught instanceof Error ? caught.message : "Could not load coding options");
      })
      .finally(() => {
        if (!cancelled) setCodingOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [addRecordDialogOpen, codingOptionsBySystem, newRecordOptionSystem]);

  async function saveOverlay(record: GroupableRecord, field: "patientRecordVisibility" | "patientRecordStatus", value: string) {
    const key = await getOrCreateSessionVaultKey();
    const patch = createPatientPatch({
      targetResourceType: record.resourceType,
      targetResourceId: record.id,
      field,
      value
    });
    await localVault.putJson(key, { type: "patient-patch", id: patch.id }, patch);
    const nextPatches = [patch, ...patches];
    setPatches(nextPatches);
    showSourceRecords("Local view updated");
  }

  function resetAddRecordDraft(type = newRecordType) {
    setNewRecordText("");
    setNewRecordStatus(defaultStatusForPatientAuthoredType(type));
    setNewRecordDate("");
    setNewRecordDosage("");
    setNewRecordReaction("");
    setNewRecordCriticality("");
    setNewRecordNote("");
    setSelectedCodingOption(null);
    setCodingOptionsError(null);
  }

  function openAddRecordDialog() {
    resetAddRecordDraft(newRecordType);
    setAddRecordDialogOpen(true);
  }

  function closeAddRecordDialog() {
    setAddRecordDialogOpen(false);
  }

  async function savePatientRecord() {
    const description = newRecordRequiredText.trim();
    if (!description || !addRecordCanSave) return;

    const optionSystem = patientAuthoredOptionSystemForType(newRecordType);
    const coding = selectedCodingOption && optionSystem ? codingOptionToCoding(selectedCodingOption, optionSystem) : undefined;
    const concept = {
      text: description,
      ...(coding ? { coding: [coding] } : {})
    };
    const note = newRecordNote.trim() || undefined;
    const authoredDate = newRecordDate || undefined;
    const statusOptions = addRecordStatusOptions(newRecordType);
    const statusLabel = statusOptionLabel(statusOptions, newRecordStatus);
    const resource =
      newRecordType === "MedicationRequest"
        ? {
            resourceType: "MedicationRequest" as const,
            status: newRecordStatus as "active" | "completed" | "stopped" | "on-hold" | "unknown",
            medicationCodeableConcept: concept,
            authoredOn: authoredDate,
            dosageInstruction: newRecordDosage.trim() ? [{ text: newRecordDosage.trim() }] : undefined
          }
        : newRecordType === "Immunization"
          ? {
              resourceType: "Immunization" as const,
              status: newRecordStatus as "completed" | "not-done",
              vaccineCode: concept,
              occurrenceDateTime: newRecordDate
            }
          : {
              resourceType: "AllergyIntolerance" as const,
              clinicalStatus: {
                text: statusLabel,
                coding: [
                  {
                    system: ALLERGY_CLINICAL_STATUS_SYSTEM,
                    code: newRecordStatus,
                    display: statusLabel
                  }
                ]
              },
              code: concept,
              criticality: newRecordCriticality
                ? (newRecordCriticality as "low" | "high" | "unable-to-assess")
                : undefined,
              reaction: newRecordReaction.trim() ? [{ description: newRecordReaction.trim() }] : undefined,
              recordedDate: authoredDate
            };

    const key = await getOrCreateSessionVaultKey();
    const record = createPatientAuthoredRecord({
      resourceType: newRecordType,
      resource,
      label: description,
      status: newRecordStatus,
      note
    });
    await localVault.putJson(key, { type: "patient-authored-record", id: record.id }, record);
    const nextPatientRecords = [record, ...patientAuthoredRecords];
    setPatientAuthoredRecords(nextPatientRecords);
    resetAddRecordDraft(newRecordType);
    closeAddRecordDialog();
    showSourceRecords("Patient record added locally");
  }

  function openDetails(record: GroupableRecord, cluster?: DedupedRecordCluster) {
    setSelectedRecordKey(recordKey(record));
    setSelectedMatchingRecordKeys((cluster?.records ?? [record]).map(recordKey));
    setSelectedMatchReason(cluster?.matchReason ?? null);
  }

  function groupPrimaryTab(group: PatientFriendlyGroup): ExplorerTab {
    return (
      group.resourceTypes.find((resourceType): resourceType is ExplorerTab =>
        (EXPLORER_TABS as readonly string[]).includes(resourceType)
      ) ?? activeTab
    );
  }

  function groupExpansionKey(group: PatientFriendlyGroup, tab = activeTab) {
    return `${tab}:${group.groupId}:${group.resourceIds.join(".")}`;
  }

  function navigateToGroup(group: PatientFriendlyGroup) {
    const tab = groupPrimaryTab(group);
    setSelectedRecordKey(null);
    setSelectedMatchingRecordKeys([]);
    setSelectedMatchReason(null);
    setActiveTab(tab);
    setViewMode("grouped");
    setExpandedGroupKeys((current) => new Set([...current, groupExpansionKey(group, tab)]));
  }

  function toggleGroupExpanded(key: string) {
    setExpandedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function recordsForGroup(group: PatientFriendlyGroup): GroupableRecord[] {
    return records.filter(
      (record) =>
        group.resourceIds.includes(record.id) &&
        record.resourceType === activeTab &&
        !record.hidden &&
        displayObservationRecordInBucket(record, activeObservationBucket, observationById.get(record.id)) &&
        displayEncounterRecordInVisitClass(record, visitClassFilter)
    );
  }

  function allRecordsForGroup(group: PatientFriendlyGroup): GroupableRecord[] {
    return records.filter(
      (record) =>
        group.resourceIds.includes(record.id) &&
        group.resourceTypes.includes(record.resourceType) &&
        !record.hidden
    );
  }

  function sortedRecordsForGroup(group: PatientFriendlyGroup): GroupableRecord[] {
    const groupRecords = recordsForGroup(group);
    return groupSort === "group-name"
      ? sortRecordsForDisplay(groupRecords, activeTab)
      : [...groupRecords].sort((left, right) =>
          compareRecordsByDate(left, right, groupSort === "oldest" ? "oldest" : "newest")
        );
  }

  function groupLatestTimestamp(group: PatientFriendlyGroup): number | undefined {
    const timestamps = recordsForGroup(group)
      .map(recordTimestamp)
      .filter((value): value is number => value !== undefined);
    return timestamps.length ? Math.max(...timestamps) : undefined;
  }

  function groupRecordCount(group: PatientFriendlyGroup): number {
    return dedupeGroupedRecords(recordsForGroup(group)).length;
  }

  function sortGroupsForDisplay(nextGroups: PatientFriendlyGroup[]): PatientFriendlyGroup[] {
    return [...nextGroups].sort((left, right) => {
      if (groupSort === "group-name") {
        return left.patientFriendlyName.localeCompare(right.patientFriendlyName);
      }
      if (groupSort === "most-records") {
        const countOrder = groupRecordCount(right) - groupRecordCount(left);
        return countOrder || left.patientFriendlyName.localeCompare(right.patientFriendlyName);
      }

      const leftTime = groupLatestTimestamp(left);
      const rightTime = groupLatestTimestamp(right);
      if (leftTime === undefined && rightTime === undefined) {
        return left.patientFriendlyName.localeCompare(right.patientFriendlyName);
      }
      if (leftTime === undefined) return 1;
      if (rightTime === undefined) return -1;
      const dateOrder = groupSort === "newest" ? rightTime - leftTime : leftTime - rightTime;
      return dateOrder || left.patientFriendlyName.localeCompare(right.patientFriendlyName);
    });
  }

  function groupLabelByRecordId(nextGroups: PatientFriendlyGroup[]): Map<string, string> {
    const labels = new Map<string, string>();
    for (const group of nextGroups) {
      for (const id of group.resourceIds) {
        if (!labels.has(id)) labels.set(id, group.patientFriendlyName);
      }
    }
    return labels;
  }

  function sortedDateClusters(nextRecords: GroupableRecord[]): DedupedRecordCluster[] {
    return dedupeGroupedRecords(nextRecords).sort((left, right) =>
      compareRecordsByDate(left.canonical, right.canonical, dateSort)
    );
  }

  function dateSections(clusters: DedupedRecordCluster[]): Array<{ label: string; clusters: DedupedRecordCluster[] }> {
    const sections = new Map<string, DedupedRecordCluster[]>();
    for (const cluster of clusters) {
      const label = recordDateSectionLabel(cluster.canonical);
      sections.set(label, [...(sections.get(label) ?? []), cluster]);
    }
    return [...sections.entries()].map(([label, sectionClusters]) => ({ label, clusters: sectionClusters }));
  }

  function renderResourceNavigation(orientation: "horizontal" | "vertical") {
    const isVertical = orientation === "vertical";
    return (
      <Tabs
        orientation={orientation}
        value={activeTab}
        onChange={(_event, value) => setActiveTab(value)}
        variant="scrollable"
        allowScrollButtonsMobile={!isVertical}
        aria-label="Resource types"
        sx={{
          borderRight: isVertical ? 1 : 0,
          borderBottom: isVertical ? 0 : 1,
          borderColor: "divider",
          minWidth: isVertical ? 86 : undefined,
          maxWidth: "100%",
          "& .MuiTabs-scroller": {
            overflowX: isVertical ? undefined : "auto"
          },
          "& .MuiTab-root": {
            minHeight: isVertical ? 68 : 64,
            minWidth: isVertical ? 76 : 88,
            px: 1,
            py: 1,
            borderRadius: 1,
            color: "text.secondary",
            textTransform: "none",
            fontWeight: 700,
            gap: 0.5,
            "&.Mui-selected": {
              bgcolor: "rgba(116, 192, 252, 0.12)",
              color: "primary.main"
            }
          }
        }}
      >
        {EXPLORER_TABS.map((type) => (
          <Tab
            key={type}
            value={type}
            icon={resourceTypeIcon(type, isVertical ? 22 : 20)}
            iconPosition="top"
            label={`${RESOURCE_LABELS[type]} (${recordsByType(records, type).length})`}
          />
        ))}
      </Tabs>
    );
  }

  function renderSourceSelector() {
    if (sources.length < 2) return null;

    return (
      <ToggleButtonGroup
        exclusive
        size="small"
        value={activeSourceId}
        onChange={(_event, value: string | null) => {
          if (value) {
            setActiveSourceId(value);
            const selected = sources.find((source) => source.id === value);
            showSourceRecords(value === "all" || !selected ? "Showing all portals" : `Showing ${sourceLabel(selected)}`);
          }
        }}
        aria-label="Record source"
        sx={{
          maxWidth: "100%",
          overflowX: "auto",
          "& .MuiToggleButton-root": { whiteSpace: "nowrap" }
        }}
      >
        <ToggleButton value="all" aria-label="All portals">
          All portals ({sources.length})
        </ToggleButton>
        {sources.map((source) => (
          <ToggleButton key={source.id} value={source.id} aria-label={sourceLabel(source)}>
            {sourceLabel(source)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    );
  }

  function dataStatusSummary() {
    const unresolvedReferenceCount =
      (dataset?.referenceResolution?.skipped.length ?? 0) + (dataset?.referenceResolution?.unresolved.length ?? 0);
    const referencePart = unresolvedReferenceCount > 0 ? `${unresolvedReferenceCount} linked records unavailable` : undefined;
    const reconnectCount = filteredSources.filter(
      (source) => source.status === "error" || source.status === "needs-reconnect"
    ).length;
    const reconnectPart =
      reconnectCount === 0
        ? undefined
        : reconnectCount === 1
          ? "Needs reconnect"
          : `${reconnectCount} portals need reconnect`;

    if (sources.length === 0) {
      const localCount = patientAuthoredRecords.length;
      return localCount > 0
        ? `${localCount} local ${localCount === 1 ? "record" : "records"} · No portal connected`
        : "No portal connected";
    }

    if (activeSourceId === "all") {
      const resourceCount = filteredSources.reduce(
        (total, source) => total + (sourceDatasets[source.id]?.resources.length ?? source.recordCount ?? 0),
        0
      );
      return [
        filteredSources.length > 1 ? "All portals" : sourceLabel(filteredSources[0]),
        filteredSources.length > 1 ? `${filteredSources.length} connected` : undefined,
        resourceCount > 0 ? `${resourceCount} records` : undefined,
        reconnectPart,
        referencePart
      ]
        .filter(Boolean)
        .join(" · ");
    }

    const source = filteredSources[0] ?? sources.find((candidate) => candidate.id === activeSourceId);
    if (!source) return ["No portal selected", referencePart].filter(Boolean).join(" · ");

    const resourceCount = sourceDatasets[source.id]?.resources.length ?? source.recordCount;
    return [
      sourceLabel(source),
      resourceCount !== undefined ? `${resourceCount} records` : undefined,
      reconnectPart,
      referencePart
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function appDataIsLoading() {
    return ["preparing", "downloading", "loading"].includes(webLlmWarmupStatus.phase);
  }

  function dataStatusPrimaryText() {
    if (busy) return "Downloading medical records...";
    if (modelBusy) {
      const warmup = getNamingWarmupStatus();
      if (warmup.phase === "loading" && !groupingProgress) return "Loading AI model (first use only)...";
      if (status.startsWith("Classifying") || status.startsWith("Linking") || status.startsWith("Switching")) return status;
      if (status.startsWith("Loading AI model")) return status;
      return groupingProgress && groupingProgress.total > 0
        ? `Organizing medical records... ${groupingProgress.completed}/${groupingProgress.total}`
        : "Organizing medical records...";
    }
    if (appDataIsLoading()) return webLlmWarmupStatus.message ?? "Loading AI model...";
    return dataStatusSummary();
  }

  function dataStatusDetailText() {
    if (busy || modelBusy) return dataStatusSummary();
    if (appDataIsLoading()) return sources.length > 0 ? dataStatusSummary() : null;
    if (groupingDiagnostics.length > 0) return "Some records used AI model fallback names.";
    if (sources.length === 0 && status !== "Ready") return status;
    return null;
  }

  function renderDataStatusBar() {
    const canAttemptLocalGrouping = records.length > 0 && browserCanAttemptNaming();
    const menuOpen = Boolean(dataMenuAnchorEl);
    const detailText = dataStatusDetailText();
    const appDataLoading = appDataIsLoading();
    const dataProgressValue =
      busy
        ? null
        : modelBusy
          ? groupingProgressValue
          : null;
    const unavailableReferences =
      (dataset?.referenceResolution?.skipped.length ?? 0) + (dataset?.referenceResolution?.unresolved.length ?? 0);
    const hasSourceError = filteredSources.some((source) => source.status === "error" || source.status === "needs-reconnect");
    const hasPendingSource = filteredSources.some((source) => source.status === "connected" || source.status === "fetching");
    const statusTone = hasSourceError || error
      ? {
          accent: "error.main",
          bgcolor: "rgba(244, 67, 54, 0.10)",
          dot: "error.main"
        }
      : unavailableReferences > 0 || hasPendingSource
        ? {
            accent: "warning.main",
            bgcolor: "rgba(255, 193, 7, 0.12)",
            dot: "warning.main"
          }
        : busy || modelBusy || appDataLoading
          ? {
              accent: "primary.main",
              bgcolor: "rgba(25, 118, 210, 0.12)",
              dot: "primary.main"
            }
          : sources.length > 0
            ? {
                accent: "success.main",
                bgcolor: "rgba(46, 125, 50, 0.12)",
                dot: "success.main"
              }
            : {
                accent: "divider",
                bgcolor: "rgba(255,255,255,0.025)",
                dot: "text.secondary"
              };

    return (
      <Box
        sx={{
          borderRadius: 1,
          borderLeft: 4,
          borderColor: statusTone.accent,
          bgcolor: statusTone.bgcolor,
          p: { xs: 1.25, sm: 1.5 }
        }}
      >
        <Stack spacing={1.25}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1.25}
            alignItems={{ xs: "stretch", md: "center" }}
            justifyContent="space-between"
          >
            <Stack minWidth={0} spacing={0.25}>
              <Stack direction="row" spacing={0.75} alignItems="center" minWidth={0}>
                <Box
                  aria-hidden="true"
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: statusTone.dot,
                    flex: "0 0 auto"
                  }}
                />
                <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: "anywhere" }}>
                  {dataStatusPrimaryText()}
                </Typography>
              </Stack>
              {detailText && (
                <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                  {detailText}
                </Typography>
              )}
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
              <Button
                variant="outlined"
                size="small"
                startIcon={<Plus size={16} />}
                onClick={openAddRecordDialog}
              >
                Add record
              </Button>
              <Button
                variant="outlined"
                size="small"
                startIcon={<Database size={16} />}
                endIcon={<ChevronDown size={16} />}
                onClick={(event) => setDataMenuAnchorEl(event.currentTarget)}
                aria-haspopup="menu"
                aria-expanded={menuOpen ? "true" : undefined}
              >
                Data
              </Button>
              <Menu anchorEl={dataMenuAnchorEl} open={menuOpen} onClose={() => setDataMenuAnchorEl(null)}>
                <MenuItem
                  disabled={busy}
                  onClick={() => {
                    setDataMenuAnchorEl(null);
                    void refreshSources();
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <RefreshCcw size={16} />
                    <Typography>Refresh all</Typography>
                  </Stack>
                </MenuItem>
                <MenuItem
                  component="a"
                  href="/providers"
                  onClick={() => setDataMenuAnchorEl(null)}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Plus size={16} />
                    <Typography>Add portal</Typography>
                  </Stack>
                </MenuItem>
              </Menu>
            </Stack>
          </Stack>
          {(busy || modelBusy || appDataLoading) &&
            (dataProgressValue === null ? (
              <LinearProgress sx={{ height: 3, borderRadius: 999 }} />
            ) : (
              <LinearProgress variant="determinate" value={dataProgressValue} sx={{ height: 3, borderRadius: 999 }} />
            ))}
          {renderSourceSelector()}
        </Stack>
      </Box>
    );
  }

  function renderPatientProfile() {
    const primary = patientProfiles[0]?.patient ?? summary?.patient;
    if (!primary) return null;

    const name = patientDisplayName(primary);
    const birthDate = patientBirthDateLabel(primary);
    const gender = patientGenderLabel(primary);
    const address = patientAddressLabel(primary);
    const telecoms = patientTelecomLabels(primary);

    return (
      <Box sx={{ px: { xs: 0, sm: 0.5 }, py: 0.5 }}>
        <Stack spacing={1.25}>
          <Stack direction="row" justifyContent="space-between" gap={1} alignItems="flex-start" flexWrap="wrap" useFlexGap>
            <Stack spacing={0.25} minWidth={0}>
              <Typography variant="h3" fontWeight={700} sx={{ overflowWrap: "anywhere" }}>
                {name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Patient profile
              </Typography>
            </Stack>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap justifyContent="flex-end">
              {birthDate && <Chip size="small" variant="outlined" label={`DOB ${birthDate}`} />}
              {gender && <Chip size="small" variant="outlined" label={gender} />}
              {patientProfiles.length > 1 && <Chip size="small" label={`${patientProfiles.length} portal profiles`} />}
            </Stack>
          </Stack>
          {(address || telecoms.length > 0) && (
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {address && <Chip size="small" variant="outlined" label={address} />}
              {telecoms.map((label) => (
                <Chip key={label} size="small" variant="outlined" label={label} />
              ))}
            </Stack>
          )}
          {patientProfiles.length > 0 && (
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {patientProfiles.map((profile) => (
                <Chip key={profile.sourceId} size="small" label={profile.sourceName} />
              ))}
            </Stack>
          )}
        </Stack>
      </Box>
    );
  }

  function renderCodeChips(record: GroupableRecord) {
    const codings = record.codeCodings ?? [];
    const keys = record.codingKeys ?? [];
    if (codings.length === 0 && keys.length === 0 && (record.codeTexts ?? []).length === 0) return null;

    return (
      <Stack spacing={1}>
        <Typography fontWeight={700}>Codes</Typography>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {(record.codeTexts ?? []).map((text) => (
            <Chip key={`text:${text}`} size="small" variant="outlined" label={text} />
          ))}
          {codings.map((coding) => (
            <Chip
              key={`${coding.code ?? ""}:${coding.display ?? ""}`}
              size="small"
              variant="outlined"
              label={[coding.code, coding.display].filter(Boolean).join(" - ")}
            />
          ))}
          {keys.map((key) => (
            <Chip key={key} size="small" variant="outlined" label={key} />
          ))}
        </Stack>
      </Stack>
    );
  }

  function suggestedRelationshipLabel(entry: RelationshipCacheEntry): string {
    if (entry.model === "fhir_reference") return "Linked in medical record";
    const value = entry.relationship;
    if (value === "monitoring_marker") return "Monitoring marker";
    if (value === "treatment") return "Treatment";
    if (value === "potentially_related") return "Potentially related";
    return "No local suggestion";
  }

  function suggestedGroupLinks(group: PatientFriendlyGroup): Array<{ entry: RelationshipCacheEntry; relatedGroup: PatientFriendlyGroup }> {
    const groupId = relationshipGroupKey(group);
    return suggestedGroupRelationships.flatMap((entry) => {
      const relatedGroupId =
        entry.sourceGroupId === groupId ? entry.targetGroupId : entry.targetGroupId === groupId ? entry.sourceGroupId : null;
      if (!relatedGroupId) return [];
      const relatedGroup = groupByRelationshipKey.get(relatedGroupId);
      return relatedGroup ? [{ entry, relatedGroup }] : [];
    });
  }

  function explicitRecordLinks(record: GroupableRecord): Array<{ relationship: RecordRelationship; relatedRecord: GroupableRecord }> {
    const currentKey = recordKey(record);
    const seen = new Set<string>();
    return (explicitRelationshipsByRecordKey.get(currentKey) ?? []).flatMap((relationship) => {
      const relatedKey = otherRelationshipRecordKey(relationship, currentKey);
      if (seen.has(`${relatedKey}:${relationship.kind}`)) return [];
      seen.add(`${relatedKey}:${relationship.kind}`);
      const relatedRecord = recordByKey.get(relatedKey);
      return relatedRecord ? [{ relationship, relatedRecord }] : [];
    });
  }

  function explicitGroupLinks(group: PatientFriendlyGroup): Array<{
    relationship: RecordRelationship;
    relatedRecord: GroupableRecord;
    relatedGroup?: PatientFriendlyGroup;
  }> {
    const groupKeys = new Set(allRecordsForGroup(group).map(recordKey));
    const seen = new Set<string>();
    return allRecordsForGroup(group).flatMap((record) =>
      (explicitRelationshipsByRecordKey.get(recordKey(record)) ?? []).flatMap((relationship) => {
        const relatedKey = otherRelationshipRecordKey(relationship, recordKey(record));
        if (groupKeys.has(relatedKey) || seen.has(`${relatedKey}:${relationship.kind}`)) return [];
        seen.add(`${relatedKey}:${relationship.kind}`);
        const relatedRecord = recordByKey.get(relatedKey);
        if (!relatedRecord) return [];
        return [
          {
            relationship,
            relatedRecord,
            relatedGroup: groupByRecordKey.get(relatedKey)
          }
        ];
      })
    );
  }

  function renderSuggestedGroupLinks(group: PatientFriendlyGroup) {
    const links = suggestedGroupLinks(group);
    if (links.length === 0) return null;
    const heading = group.resourceTypes.includes("Condition")
      ? "Related labs"
      : group.resourceTypes.includes("Observation")
        ? "Related conditions"
        : "Suggested locally";

    return (
      <Stack spacing={0.75}>
        <Typography variant="body2" color="text.secondary" fontWeight={700}>
          {heading}
        </Typography>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {links.slice(0, 6).map(({ entry, relatedGroup }) => (
            <Chip
              key={`${entry.sourceGroupId}:${entry.targetGroupId}:${entry.relationship}`}
              size="small"
              color="secondary"
              variant="outlined"
              label={`${relatedGroup.patientFriendlyName} · ${suggestedRelationshipLabel(entry)} (${Math.round(
                entry.confidence * 100
              )}%)`}
              onClick={() => navigateToGroup(relatedGroup)}
            />
          ))}
        </Stack>
      </Stack>
    );
  }

  function renderExplicitGroupLinks(group: PatientFriendlyGroup) {
    const links = explicitGroupLinks(group);
    if (links.length === 0) return null;
    return (
      <Stack spacing={0.75}>
        <Typography variant="body2" color="text.secondary" fontWeight={700}>
          Linked in medical record
        </Typography>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {links.slice(0, 6).map(({ relationship, relatedRecord, relatedGroup }) => (
            <Chip
              key={`${relationship.id}:${recordKey(relatedRecord)}`}
              size="small"
              variant="outlined"
              label={`${RESOURCE_LABELS[relatedRecord.resourceType]}: ${
                relatedGroup?.patientFriendlyName ?? relatedRecord.sourceLabel
              }`}
              onClick={() => (relatedGroup ? navigateToGroup(relatedGroup) : openDetails(relatedRecord))}
            />
          ))}
        </Stack>
      </Stack>
    );
  }

  function renderRelatedData(record: GroupableRecord) {
    const recordLinks = explicitRecordLinks(record);
    const group = groupByRecordKey.get(recordKey(record));
    const groupLinks = group ? suggestedGroupLinks(group) : [];
    if (recordLinks.length === 0 && groupLinks.length === 0) return null;

    return (
      <Stack spacing={1}>
        <Typography fontWeight={700}>Related records</Typography>
        {recordLinks.length > 0 && (
          <Stack spacing={0.75}>
            <Typography variant="body2" color="text.secondary">
              Linked in medical record
            </Typography>
            <Stack spacing={1}>
              {recordLinks.slice(0, 8).map(({ relationship, relatedRecord }) => (
                <Box
                  key={`${relationship.id}:${recordKey(relatedRecord)}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDetails(relatedRecord)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openDetails(relatedRecord);
                    }
                  }}
                  sx={{
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    cursor: "pointer",
                    p: 1,
                    "&:hover": { borderColor: "primary.main" },
                    "&:focus-visible": {
                      outline: "2px solid",
                      outlineColor: "primary.main",
                      outlineOffset: 2
                    }
                  }}
                >
                  <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={RESOURCE_LABELS[relatedRecord.resourceType]} />
                    <Typography fontWeight={700} sx={{ overflowWrap: "anywhere" }}>
                      {relatedRecord.sourceLabel}
                    </Typography>
                    <Chip size="small" variant="outlined" label={relationship.label} />
                  </Stack>
                </Box>
              ))}
            </Stack>
          </Stack>
        )}
        {groupLinks.length > 0 && (
          <Stack spacing={0.75}>
            <Typography variant="body2" color="text.secondary">
              Related groups
            </Typography>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              {groupLinks.slice(0, 8).map(({ entry, relatedGroup }) => (
                <Chip
                  key={`${entry.sourceGroupId}:${entry.targetGroupId}:${entry.relationship}:drawer`}
                  size="small"
                  color="secondary"
                  variant="outlined"
                  label={`${relatedGroup.patientFriendlyName} · ${suggestedRelationshipLabel(entry)} (${Math.round(
                    entry.confidence * 100
                  )}%)`}
                  onClick={() => navigateToGroup(relatedGroup)}
                />
              ))}
            </Stack>
          </Stack>
        )}
      </Stack>
    );
  }

  function renderAddRecordDialog() {
    const optionSystem = patientAuthoredOptionSystemForType(newRecordType);
    const statusOptions = addRecordStatusOptions(newRecordType);
    const conceptLabel =
      newRecordType === "MedicationRequest"
        ? "Medication"
        : newRecordType === "Immunization"
          ? "Vaccine"
          : "Allergy";

    return (
      <Dialog
        open={addRecordDialogOpen}
        onClose={closeAddRecordDialog}
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: { borderRadius: 1 } }}
      >
        <DialogTitle>Add patient record</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <TextField
              select
              required
              label="Record type"
              value={newRecordType}
              onChange={(event) => {
                const nextType = event.target.value as PatientAuthoredResourceType;
                setNewRecordType(nextType);
                resetAddRecordDraft(nextType);
              }}
              size="small"
            >
              {PATIENT_RESOURCE_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            {optionSystem ? (
              <Autocomplete<PatientAuthoredCodingOption, false, false, true>
                freeSolo
                options={filteredNewRecordCodingOptions}
                filterOptions={(options) => options}
                value={selectedCodingOption}
                inputValue={newRecordText}
                loading={codingOptionsLoading}
                onInputChange={(_event, value, reason) => {
                  setNewRecordText(value);
                  if (reason === "input" || reason === "clear") setSelectedCodingOption(null);
                }}
                onChange={(_event, value) => {
                  if (typeof value === "string") {
                    setNewRecordText(value);
                    setSelectedCodingOption(null);
                    return;
                  }
                  setSelectedCodingOption(value);
                  setNewRecordText(value?.technicalName ?? "");
                }}
                getOptionLabel={(option) => (typeof option === "string" ? option : option.name)}
                isOptionEqualToValue={(option, value) => option.code === value.code && option.technicalName === value.technicalName}
                renderOption={(props, option) => {
                  const { key: _muiKey, ...optionProps } = props;
                  return (
                    <Box component="li" key={`${optionSystem}:${option.code}:${option.technicalName}`} {...optionProps}>
                      <Stack spacing={0.25} minWidth={0}>
                        <Typography variant="body2" fontWeight={700} sx={{ overflowWrap: "anywhere" }}>
                          {option.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                          {option.technicalName} · {option.code}
                        </Typography>
                      </Stack>
                    </Box>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    required
                    label={conceptLabel}
                    error={Boolean(codingOptionsError)}
                    helperText={
                      codingOptionsError ??
                      (selectedCodingOption
                        ? `${optionSystem.toUpperCase()} ${selectedCodingOption.code}`
                        : optionSystem === "rxnorm"
                          ? "RxNorm"
                          : "CVX")
                    }
                    size="small"
                  />
                )}
              />
            ) : (
              <TextField
                required
                label={conceptLabel}
                value={newRecordText}
                onChange={(event) => setNewRecordText(event.target.value)}
                size="small"
              />
            )}

            <TextField
              select
              required
              label={newRecordType === "AllergyIntolerance" ? "Clinical status" : "Status"}
              value={newRecordStatus}
              onChange={(event) => setNewRecordStatus(event.target.value)}
              size="small"
            >
              {statusOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            {newRecordType === "MedicationRequest" && (
              <>
                <TextField
                  label="Dosage instructions"
                  value={newRecordDosage}
                  onChange={(event) => setNewRecordDosage(event.target.value)}
                  size="small"
                />
                <TextField
                  label="Start or authored date"
                  type="date"
                  value={newRecordDate}
                  onChange={(event) => setNewRecordDate(event.target.value)}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
              </>
            )}

            {newRecordType === "Immunization" && (
              <TextField
                required
                label="Date given"
                type="date"
                value={newRecordDate}
                onChange={(event) => setNewRecordDate(event.target.value)}
                size="small"
                InputLabelProps={{ shrink: true }}
              />
            )}

            {newRecordType === "AllergyIntolerance" && (
              <>
                <TextField
                  select
                  label="Criticality"
                  value={newRecordCriticality}
                  onChange={(event) => setNewRecordCriticality(event.target.value)}
                  size="small"
                >
                  {ALLERGY_CRITICALITY_OPTIONS.map((option) => (
                    <MenuItem key={option.value || "none"} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Reaction"
                  value={newRecordReaction}
                  onChange={(event) => setNewRecordReaction(event.target.value)}
                  size="small"
                />
                <TextField
                  label="Recorded date"
                  type="date"
                  value={newRecordDate}
                  onChange={(event) => setNewRecordDate(event.target.value)}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
              </>
            )}

            <TextField
              label="Note"
              value={newRecordNote}
              onChange={(event) => setNewRecordNote(event.target.value)}
              size="small"
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAddRecordDialog}>Cancel</Button>
          <Button variant="contained" disabled={!addRecordCanSave} onClick={() => void savePatientRecord()}>
            Add record
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  function renderDetailDrawer() {
    const record = selectedRecord;
    const observation = record ? observationById.get(record.id) : undefined;
    const matchingRecords = selectedMatchingRecords.length ? selectedMatchingRecords : record ? [record] : [];
    const closeDetails = () => {
      setSelectedRecordKey(null);
      setSelectedMatchingRecordKeys([]);
      setSelectedMatchReason(null);
    };

    return (
      <Drawer
        anchor="right"
        open={Boolean(record)}
        onClose={closeDetails}
        PaperProps={{
          sx: {
            width: { xs: "100%", sm: 520 },
            maxWidth: "100%",
            p: 2
          }
        }}
      >
        {record && (
          <Stack spacing={2.25}>
            <Stack direction="row" alignItems="flex-start" justifyContent="space-between" gap={1}>
              <Stack spacing={0.75} minWidth={0}>
                <Typography variant="h2" sx={{ overflowWrap: "anywhere" }}>
                  {record.sourceLabel}
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={RESOURCE_LABELS[record.resourceType]} />
                  {record.status && <Chip size="small" color={statusChipColor(record.status)} label={record.status} />}
                  {record.source === "patient" && <Chip size="small" color="secondary" label="Patient added" />}
                  {record.inactiveOverlay && <Chip size="small" color="warning" label="Inactive locally" />}
                  {matchingRecords.length > 1 && (
                    <Chip size="small" variant="outlined" label={`${matchingRecords.length} matching records`} />
                  )}
                </Stack>
              </Stack>
              <IconButton aria-label="Close details" onClick={closeDetails}>
                <X size={20} />
              </IconButton>
            </Stack>

            <Divider />

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: "auto minmax(0, 1fr)",
                columnGap: 1.5,
                rowGap: 1
              }}
            >
              <Typography color="text.secondary">Source</Typography>
              <Typography>{record.source === "patient" ? "Patient added" : "Provider record"}</Typography>
              {record.portalSourceName && (
                <>
                  <Typography color="text.secondary">Portal</Typography>
                  <Typography>{record.portalSourceName}</Typography>
                </>
              )}
              {detailDate(record) && (
                <>
                  <Typography color="text.secondary">Date</Typography>
                  <Typography>{detailDate(record)}</Typography>
                </>
              )}
              {record.category && (
                <>
                  <Typography color="text.secondary">Category</Typography>
                  <Typography>{record.category}</Typography>
                </>
              )}
              {record.displayValue && (
                <>
                  <Typography color="text.secondary">Value</Typography>
                  <Typography>{record.displayValue}</Typography>
                </>
              )}
              {record.canonicalValue !== undefined && (
                <>
                  <Typography color="text.secondary">Normalized</Typography>
                  <Typography>
                    {record.canonicalValue.toFixed(2)}
                    {record.canonicalUnit ? ` ${record.canonicalUnit}` : ""}
                  </Typography>
                </>
              )}
              {record.ingredients?.length ? (
                <>
                  <Typography color="text.secondary">Ingredients</Typography>
                  <Typography>{record.ingredients.join(", ")}</Typography>
                </>
              ) : null}
              {record.route && (
                <>
                  <Typography color="text.secondary">Route</Typography>
                  <Typography>{record.route}</Typography>
                </>
              )}
              {record.dosageForm && (
                <>
                  <Typography color="text.secondary">Form</Typography>
                  <Typography>{record.dosageForm}</Typography>
                </>
              )}
            </Box>

            {observation && (
              <Stack spacing={1}>
                <Typography fontWeight={700}>Observation value</Typography>
                <Typography color="text.secondary">
                  {observation.value}
                  {observation.interpretation ? `, ${observation.interpretation}` : ""}
                  {observation.abnormal ? ", abnormal flag present" : ""}
                </Typography>
              </Stack>
            )}

            {renderCodeChips(record)}

            {renderRelatedData(record)}

            {matchingRecords.length > 1 && (
              <Stack spacing={1}>
                <Typography fontWeight={700}>Matching records</Typography>
                {selectedMatchReason && <Typography color="text.secondary">{selectedMatchReason}</Typography>}
                <Stack spacing={1}>
                  {matchingRecords.map((match) => {
                    const raw = resourceByKey.get(recordKey(match));
                    const matchObservation = observationById.get(match.id);
                    return (
                      <Box
                        key={`match:${recordKey(match)}`}
                        sx={{
                          border: 1,
                          borderColor: match.id === record.id ? "primary.main" : "divider",
                          borderRadius: 1,
                          p: 1.25
                        }}
                      >
                        <Stack spacing={1}>
                          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography fontWeight={700} sx={{ overflowWrap: "anywhere" }}>
                              {match.sourceLabel}
                            </Typography>
                            {match.id === record.id && <Chip size="small" color="primary" label="Canonical" />}
                            {match.portalSourceName && <Chip size="small" variant="outlined" label={match.portalSourceName} />}
                            <Chip size="small" variant="outlined" label={`Score ${recordQualityScore(match)}`} />
                          </Stack>
                          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                            {match.status && <Chip size="small" label={match.status} color={statusChipColor(match.status)} />}
                            {match.date && <Chip size="small" variant="outlined" label={detailDate(match)} />}
                            {matchObservation?.value && <Chip size="small" variant="outlined" label={matchObservation.value} />}
                          </Stack>
                          {raw && (
                            <Accordion disableGutters>
                              <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                                <Typography fontWeight={700}>Source FHIR</Typography>
                              </AccordionSummary>
                              <AccordionDetails>
                                <Box
                                  component="pre"
                                  sx={{
                                    m: 0,
                                    maxHeight: 260,
                                    overflow: "auto",
                                    fontSize: "0.78rem",
                                    whiteSpace: "pre-wrap",
                                    overflowWrap: "anywhere"
                                  }}
                                >
                                  {JSON.stringify(raw, null, 2)}
                                </Box>
                              </AccordionDetails>
                            </Accordion>
                          )}
                        </Stack>
                      </Box>
                    );
                  })}
                </Stack>
              </Stack>
            )}

            {selectedRawResource && (
              <Accordion disableGutters>
                <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                  <Typography fontWeight={700}>FHIR details</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box
                    component="pre"
                    sx={{
                      m: 0,
                      maxHeight: 360,
                      overflow: "auto",
                      fontSize: "0.78rem",
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere"
                    }}
                  >
                    {JSON.stringify(selectedRawResource, null, 2)}
                  </Box>
                </AccordionDetails>
              </Accordion>
            )}
          </Stack>
        )}
      </Drawer>
    );
  }

  function duplicateChipLabel(cluster?: DedupedRecordCluster): string | null {
    if (!cluster || cluster.duplicateCount === 0) return null;
    const canonicalPortal = cluster.canonical.portalSourceName || cluster.canonical.portalSourceId;
    const otherPortals = [
      ...new Set(
        cluster.records
          .filter((record) => record.id !== cluster.canonical.id)
          .map((record) => record.portalSourceName || record.portalSourceId)
          .filter((value): value is string => Boolean(value && value !== canonicalPortal))
      )
    ];
    if (otherPortals.length === 1) return `Also in ${otherPortals[0]}`;
    return `${cluster.records.length} matching records`;
  }

  function renderRecord(
    record: GroupableRecord,
    cluster?: DedupedRecordCluster,
    options: { groupName?: string; compact?: boolean } = {}
  ) {
    const observation = observationById.get(record.id);
    const duplicateLabel = duplicateChipLabel(cluster);
    const compact = options.compact ?? density === "compact";
    const dateLabel = observation?.effectiveDate ? displayObservationDate(observation.effectiveDate) : recordDateLabel(record);
    return (
      <Box
        key={`${record.resourceType}:${record.id}`}
        role="button"
        tabIndex={0}
        onClick={() => openDetails(record, cluster)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openDetails(record, cluster);
          }
        }}
        sx={{
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          cursor: "pointer",
          p: compact ? 1 : 1.5,
          transition: "border-color 120ms ease, background-color 120ms ease",
          "&:hover": {
            borderColor: "primary.main",
            bgcolor: "rgba(255,255,255,0.03)"
          },
          "&:focus-visible": {
            outline: "2px solid",
            outlineColor: "primary.main",
            outlineOffset: 2
          }
        }}
      >
        <Stack spacing={compact ? 0.75 : 1}>
          <Stack direction="row" justifyContent="space-between" gap={1} alignItems="flex-start">
            <Stack minWidth={0} spacing={0.25}>
              <Typography fontWeight={700} variant={compact ? "body2" : "body1"} sx={{ overflowWrap: "anywhere" }}>
                {record.sourceLabel}
              </Typography>
              {observation && !compact && (
                <Typography color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                  {observation.value}
                  {observation.normalizedValue.canonicalUnit &&
                    observation.normalizedValue.canonicalValue !== undefined &&
                    ` (${observation.normalizedValue.canonicalValue.toFixed(2)} ${observation.normalizedValue.canonicalUnit})`}
                </Typography>
              )}
              {compact && (
                <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                  {[observation?.value ?? record.displayValue, dateLabel].filter(Boolean).join(" · ")}
                </Typography>
              )}
            </Stack>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap justifyContent="flex-end">
              {options.groupName && <Chip size="small" variant="outlined" label={options.groupName} />}
              {record.status && <Chip size="small" color={statusChipColor(record.status)} label={record.status} />}
              {!compact && record.portalSourceName && <Chip size="small" variant="outlined" label={record.portalSourceName} />}
              {duplicateLabel && <Chip size="small" color="primary" variant="outlined" label={duplicateLabel} />}
              {record.source === "patient" && <Chip size="small" color="secondary" label="Patient added" />}
              {record.inactiveOverlay && <Chip size="small" color="warning" label="Inactive locally" />}
            </Stack>
          </Stack>
          {!compact && dateLabel && dateLabel !== "No date" && (
            <Typography variant="caption" color="text.secondary">
              {detailDate(record) ?? dateLabel}
            </Typography>
          )}
          {!compact && record.source === "provider" && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Info size={16} />}
                onClick={(event) => {
                  event.stopPropagation();
                  openDetails(record, cluster);
                }}
              >
                Details
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<RefreshCcw size={16} />}
                onClick={(event) => {
                  event.stopPropagation();
                  void saveOverlay(record, "patientRecordStatus", "inactive");
                }}
              >
                Mark inactive
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="warning"
                startIcon={<EyeOff size={16} />}
                onClick={(event) => {
                  event.stopPropagation();
                  void saveOverlay(record, "patientRecordVisibility", "hidden");
                }}
              >
                Hide locally
              </Button>
            </Stack>
          )}
          {!compact && record.source === "patient" && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Info size={16} />}
                onClick={(event) => {
                  event.stopPropagation();
                  openDetails(record, cluster);
                }}
              >
                Details
              </Button>
            </Stack>
          )}
        </Stack>
      </Box>
    );
  }

  function renderObservationTracking(group: PatientFriendlyGroup, clusters: DedupedRecordCluster[]) {
    if (activeTab !== "Observation") return null;
    const observationEntries = clusters
      .map((cluster) => ({
        cluster,
        record: cluster.canonical,
        observation: observationById.get(cluster.canonical.id)
      }))
      .filter(
        (entry): entry is { cluster: DedupedRecordCluster; record: GroupableRecord; observation: ReferralSummary["observations"][number] } =>
          Boolean(entry.observation)
      )
      .filter((entry) =>
        displayObservationBucket(entry.record, entry.observation) === activeObservationBucket
      )
      .sort((left, right) => (right.observation.effectiveDate || "").localeCompare(left.observation.effectiveDate || ""));
    const observations = observationEntries.map((entry) => entry.observation);
    if (observations.length === 0) return null;

    const latest = observations[0];
    const numericObservations = observations.filter((observation) => numericObservationValue(observation) !== undefined);
    const numericValues = numericObservations.map((observation) => numericObservationValue(observation) as number);
    const categoryLabels = [
      ...new Set(observations.map((observation) => observation.category || observation.categoryCode).filter(Boolean))
    ];
    const unit = numericObservations.map(numericObservationUnit).find(Boolean);
    const min = numericValues.length ? Math.min(...numericValues) : undefined;
    const max = numericValues.length ? Math.max(...numericValues) : undefined;
    const chartPoints = observationEntries
      .filter((entry) => numericObservationValue(entry.observation) !== undefined)
      .flatMap((entry) => {
        const observation = entry.observation;
        const date = observation.effectiveDate ? new Date(observation.effectiveDate) : null;
        if (!date || Number.isNaN(date.getTime())) return [];
        return [
          {
            cluster: entry.cluster,
            record: entry.record,
            observation,
            date,
            value: numericObservationValue(observation) as number,
            unit: numericObservationUnit(observation),
            comparableUnit: observationComparableUnit(observation)
          }
        ];
      })
      .sort((left, right) => left.date.getTime() - right.date.getTime());
    const chartUnits = new Set(chartPoints.map((point) => point.comparableUnit));
    const chartUnit = chartUnits.size === 1 ? [...chartUnits][0] : undefined;
    const canChartObservation = chartPoints.length >= 2 && chartUnits.size === 1;

    return (
      <Stack spacing={1}>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {categoryLabels.slice(0, 2).map((category) => (
            <Chip key={category} size="small" variant="outlined" label={category} />
          ))}
          <Chip size="small" label={`${observations.length} results`} />
          <Chip
            size="small"
            label={`Latest: ${latest.value}${latest.effectiveDate ? ` (${displayObservationDate(latest.effectiveDate)})` : ""}`}
          />
          {min !== undefined && max !== undefined && (
            <Chip
              size="small"
              label={`Range: ${min.toFixed(2)}-${max.toFixed(2)}${unit ? ` ${unit}` : ""}`}
            />
          )}
        </Stack>
        {canChartObservation && (
          <Box
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              height: 260,
              minWidth: 0,
              overflow: "hidden",
              pt: 1
            }}
          >
            <LineChart
              title={`${group.patientFriendlyName} trend chart`}
              desc="Select a plotted point to open the source observation."
              height={240}
              margin={{ left: 56, right: 16, top: 16, bottom: 36 }}
              xAxis={[
                {
                  scaleType: "time",
                  data: chartPoints.map((point) => point.date),
                  valueFormatter: (value) =>
                    value instanceof Date ? value.toLocaleDateString() : displayObservationDate(String(value)) ?? String(value)
                }
              ]}
              series={[
                {
                  data: chartPoints.map((point) => point.value),
                  label:
                    chartUnit && chartUnit !== "unitless"
                      ? `${group.patientFriendlyName} (${chartUnit})`
                      : group.patientFriendlyName,
                  showMark: true,
                  curve: "linear",
                  valueFormatter: (value) =>
                    value === null
                      ? ""
                      : `${Number(value).toFixed(2)}${chartUnit && chartUnit !== "unitless" ? ` ${chartUnit}` : ""}`
                }
              ]}
              grid={{ horizontal: true }}
              hideLegend
              skipAnimation
              onMarkClick={(_event, item) => {
                if (typeof item.dataIndex !== "number") return;
                const point = chartPoints[item.dataIndex];
                if (!point) return;
                openDetails(point.record, point.cluster);
              }}
            />
          </Box>
        )}
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          {observations.slice(0, 8).map((observation) => (
            <Chip
              key={`${observation.id}:trend`}
              size="small"
              variant="outlined"
              label={`${displayObservationDate(observation.effectiveDate) || "No date"}: ${observation.value}`}
            />
          ))}
        </Stack>
      </Stack>
    );
  }

  function renderGroup(group: PatientFriendlyGroup) {
    const groupRecords = sortedRecordsForGroup(group);
    if (groupRecords.length === 0) return null;

    const allergySuperseded = activeTab === "AllergyIntolerance" && allergyGroupSuperseded(groupRecords);
    const groupStatus = supportsResourceStatusFilter(activeTab)
      ? allergySuperseded
        ? ({ kind: "inactive", label: "Superseded", activeForFilter: false, color: "warning" } satisfies GroupStatusRollup)
        : groupStatusRollup(groupRecords)
      : null;
    const encounterVisitClass =
      activeTab === "Encounter" && groupRecords.length > 0
        ? encounterVisitClassForRecord(groupRecords[0])
        : null;
    const clusters = dedupeGroupedRecords(groupRecords);
    const canonicalRecords = clusters.map((cluster) => cluster.canonical);
    const duplicateCount = clusters.reduce((total, cluster) => total + cluster.duplicateCount, 0);
    const expansionKey = groupExpansionKey(group);
    const collapsedLimit = density === "compact" ? 1 : MAX_COLLAPSED_GROUP_RECORDS;
    const hasMoreRecords = clusters.length > collapsedLimit;
    const isExpanded = expandedGroupKeys.has(expansionKey);
    const displayedClusters =
      hasMoreRecords && !isExpanded ? clusters.slice(0, collapsedLimit) : clusters;
    const portalCount = new Set(groupRecords.map((record) => record.portalSourceId).filter(Boolean)).size;
    const latestRecord = [...canonicalRecords].sort((left, right) => compareRecordsByDate(left, right, "newest"))[0];
    const latestLabel = latestRecord ? recordDateLabel(latestRecord) : undefined;

    return (
      <Box
        key={expansionKey}
        sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: density === "compact" ? 1.25 : 2 }}
      >
        <Stack spacing={density === "compact" ? 1 : 1.5}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant={density === "compact" ? "subtitle1" : "h3"} fontWeight={700}>
              {group.patientFriendlyName}
            </Typography>
            {groupStatus && <Chip size="small" color={groupStatus.color} label={groupStatus.label} />}
            {encounterVisitClass && encounterVisitClass !== "unknown" && (
              <Chip size="small" color="primary" variant="outlined" label={visitClassLabel(encounterVisitClass)} />
            )}
            <Chip size="small" label={`${canonicalRecords.length} ${canonicalRecords.length === 1 ? "result" : "results"}`} />
            {latestLabel && latestLabel !== "No date" && <Chip size="small" variant="outlined" label={`Latest: ${latestLabel}`} />}
            {duplicateCount > 0 && (
              <Chip size="small" color="primary" variant="outlined" label={`${duplicateCount} matching records collapsed`} />
            )}
            {density !== "compact" && portalCount > 1 && <Chip size="small" variant="outlined" label={`${portalCount} portals`} />}
            {density !== "compact" && <Chip size="small" label={`${Math.round(group.confidence * 100)}%`} />}
            {group.fallback && <Chip size="small" variant="outlined" label="Review" />}
          </Stack>
          {density !== "compact" && renderObservationTracking(group, clusters)}
          {density !== "compact" && renderSuggestedGroupLinks(group)}
          {density !== "compact" && renderExplicitGroupLinks(group)}
          <Stack spacing={density === "compact" ? 0.75 : 1}>
            {displayedClusters.map((cluster) => renderRecord(cluster.canonical, cluster))}
          </Stack>
          {hasMoreRecords && (
            <Button
              size="small"
              variant="outlined"
              endIcon={
                <ChevronDown
                  size={16}
                  style={{ transform: isExpanded ? "rotate(180deg)" : undefined, transition: "transform 120ms ease" }}
                />
              }
              aria-expanded={isExpanded}
              onClick={() => toggleGroupExpanded(expansionKey)}
              sx={{ alignSelf: "flex-start" }}
            >
              {isExpanded ? "Show fewer" : `Show all ${clusters.length}`}
            </Button>
          )}
        </Stack>
      </Box>
    );
  }

  function renderDateView(clusters: DedupedRecordCluster[], labelsByRecordId: Map<string, string>) {
    const sections = dateSections(clusters);
    return (
      <Timeline
        position="right"
        sx={{
          m: 0,
          p: 0,
          [`& .MuiTimelineItem-root`]: {
            minHeight: "auto"
          },
          [`& .MuiTimelineOppositeContent-root`]: {
            flex: { xs: "0 0 88px", sm: "0 0 132px" },
            maxWidth: { xs: 88, sm: 132 },
            px: { xs: 0.5, sm: 1 },
            pt: 0.75,
            textAlign: "right"
          },
          [`& .MuiTimelineContent-root`]: {
            minWidth: 0,
            px: { xs: 1, sm: 1.5 },
            pb: density === "compact" ? 1 : 1.5
          }
        }}
      >
        {sections.map((section, index) => (
          <TimelineItem key={`date-section:${section.label}`}>
            <TimelineOppositeContent>
              <Typography variant="subtitle2" color="text.secondary" fontWeight={700} sx={{ overflowWrap: "anywhere" }}>
                {section.label}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {section.clusters.length} {section.clusters.length === 1 ? "record" : "records"}
              </Typography>
            </TimelineOppositeContent>
            <TimelineSeparator>
              <TimelineDot
                variant="outlined"
                color={section.label === "No date" ? "grey" : "primary"}
                sx={{ my: 0.75, bgcolor: "background.paper" }}
              />
              {index < sections.length - 1 && <TimelineConnector />}
            </TimelineSeparator>
            <TimelineContent>
              <Stack spacing={density === "compact" ? 0.75 : 1}>
                {section.clusters.map((cluster) =>
                  renderRecord(cluster.canonical, cluster, {
                    groupName: labelsByRecordId.get(cluster.canonical.id),
                    compact: density === "compact"
                  })
                )}
              </Stack>
            </TimelineContent>
          </TimelineItem>
        ))}
      </Timeline>
    );
  }

  const tabRecords = recordsByType(records, activeTab);
  const tabGroups = groupsByType(displayGroups, activeTab);
  const statusFilterEnabled = supportsResourceStatusFilter(activeTab);
  const observationVisibleTabGroups =
    activeTab === "Observation"
      ? tabGroups.filter((group) =>
          group.resourceIds.some((id) => {
            const record = recordByKey.get(`Observation/${id}`);
            return record && displayObservationRecordInBucket(record, activeObservationBucket, observationById.get(id));
          })
        )
      : tabGroups;
  const visitVisibleTabGroups =
    activeTab === "Encounter" && visitClassFilter !== "all"
      ? observationVisibleTabGroups.filter((group) =>
          group.resourceIds.some((id) => {
            const record = recordByKey.get(`Encounter/${id}`);
            return record && displayEncounterRecordInVisitClass(record, visitClassFilter);
          })
        )
      : observationVisibleTabGroups;
  const baseVisibleTabGroups = visitVisibleTabGroups;
  const visibleTabGroups =
    statusFilterEnabled && resourceStatusFilter === "active"
      ? baseVisibleTabGroups.filter((group) => groupActiveForStatusFilter(group))
      : baseVisibleTabGroups;
  const visibleGroupResourceIds = new Set(visibleTabGroups.flatMap((group) => group.resourceIds));
  const visibleTabRecords =
    activeTab === "Observation"
      ? tabRecords.filter((record) => displayObservationRecordInBucket(record, activeObservationBucket, observationById.get(record.id)))
      : activeTab === "Encounter" && visitClassFilter !== "all"
        ? tabRecords.filter((record) => displayEncounterRecordInVisitClass(record, visitClassFilter))
      : statusFilterEnabled && resourceStatusFilter === "active"
        ? tabRecords.filter((record) => visibleGroupResourceIds.has(record.id))
        : tabRecords;
  const statusFilterGroupCounts = statusFilterEnabled
    ? {
        active: baseVisibleTabGroups.filter((group) => groupActiveForStatusFilter(group)).length,
        all: baseVisibleTabGroups.length
      }
    : { active: 0, all: 0 };
  const sortedVisibleTabGroups = sortGroupsForDisplay(visibleTabGroups);
  const canUseGroupedView = sortedVisibleTabGroups.length > 0;
  const effectiveViewMode: ExplorerViewMode = canUseGroupedView ? viewMode : "date";
  const dateViewClusters = sortedDateClusters(visibleTabRecords);
  const labelsByRecordId = groupLabelByRecordId(visibleTabGroups);
  const groupingProgressValue =
    groupingProgress && groupingProgress.total > 0
      ? Math.round((groupingProgress.completed / groupingProgress.total) * 100)
      : null;

  function renderRecordViewToolbar() {
    const recordCount = visibleTabRecords.length;
    const totalCount = tabRecords.length;
    const recordLabel =
      (activeTab === "Observation" || statusFilterEnabled) && totalCount !== recordCount
        ? `${recordCount} of ${totalCount} ${totalCount === 1 ? "record" : "records"}`
        : `${recordCount} ${recordCount === 1 ? "record" : "records"}`;
    const sortOptions = effectiveViewMode === "grouped" ? GROUP_SORT_OPTIONS : DATE_SORT_OPTIONS;

    return (
      <Box
        sx={{
          py: { xs: 0.5, sm: 0.75 }
        }}
      >
        <Stack spacing={1.25}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "minmax(220px, 1fr) auto" },
              gap: 1.25,
              alignItems: "center"
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" minWidth={0}>
              <Box
                aria-hidden="true"
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 1,
                  display: "grid",
                  placeItems: "center",
                  flex: "0 0 auto",
                  color: "primary.main",
                  bgcolor: "rgba(116, 192, 252, 0.12)"
                }}
              >
                {resourceTypeIcon(activeTab, 22)}
              </Box>
              <Stack minWidth={0} spacing={0}>
                <Typography variant="h3" fontWeight={700} sx={{ overflowWrap: "anywhere" }}>
                  {RESOURCE_LABELS[activeTab]}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {recordLabel}
                </Typography>
              </Stack>
            </Stack>

            {visibleTabRecords.length > 0 && (
              <Stack
                direction="row"
                spacing={1}
                flexWrap="wrap"
                useFlexGap
                alignItems="center"
                justifyContent={{ xs: "flex-start", lg: "flex-end" }}
              >
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={effectiveViewMode}
                  onChange={(_event, value: ExplorerViewMode | null) => {
                    if (value) setViewMode(value);
                  }}
                  aria-label="Record view"
                  sx={{
                    maxWidth: "100%",
                    "& .MuiToggleButton-root": { whiteSpace: "nowrap", minWidth: 74 }
                  }}
                >
                  <ToggleButton value="grouped" aria-label="Grouped view" disabled={!canUseGroupedView}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Layers size={15} />
                      <span>Group</span>
                    </Stack>
                  </ToggleButton>
                  <ToggleButton value="date" aria-label="Date view">
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <CalendarDays size={15} />
                      <span>Date</span>
                    </Stack>
                  </ToggleButton>
                </ToggleButtonGroup>

                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={density}
                  onChange={(_event, value: ExplorerDensity | null) => {
                    if (value) setDensity(value);
                  }}
                  aria-label="Display density"
                  sx={{
                    maxWidth: "100%",
                    "& .MuiToggleButton-root": { whiteSpace: "nowrap", minWidth: 70 }
                  }}
                >
                  <ToggleButton value="comfortable" aria-label="Detail density">
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <List size={15} />
                      <span>Detail</span>
                    </Stack>
                  </ToggleButton>
                  <ToggleButton value="compact" aria-label="Compact density">
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <ListCollapse size={15} />
                      <span>Compact</span>
                    </Stack>
                  </ToggleButton>
                </ToggleButtonGroup>

                <TextField
                  select
                  size="small"
                  label="Sort by"
                  value={effectiveViewMode === "grouped" ? groupSort : dateSort}
                  onChange={(event) => {
                    if (effectiveViewMode === "grouped") setGroupSort(event.target.value as GroupSortMode);
                    else setDateSort(event.target.value as DateSortMode);
                  }}
                  sx={{ minWidth: { xs: 150, sm: 174 } }}
                >
                  {sortOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            )}
          </Box>

          {activeTab === "Observation" && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={activeObservationBucket}
              onChange={(_event, value: ObservationBucket | null) => {
                if (value) setActiveObservationBucket(value);
              }}
              aria-label="Observation category"
              sx={{
                alignSelf: "flex-start",
                maxWidth: "100%",
                overflowX: "auto",
                "& .MuiToggleButton-root": { whiteSpace: "nowrap" }
              }}
            >
              {(Object.keys(OBSERVATION_BUCKET_LABELS) as ObservationBucket[]).map((bucket) => (
                <ToggleButton key={bucket} value={bucket} aria-label={OBSERVATION_BUCKET_LABELS[bucket]}>
                  {OBSERVATION_BUCKET_LABELS[bucket]} ({observationBucketCounts[bucket]})
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}

          {activeTab === "Encounter" && (
            <TextField
              select
              size="small"
              label="Visit type"
              value={visitClassFilter}
              onChange={(event) => {
                setVisitClassFilter(event.target.value as VisitClassFilter);
              }}
              sx={{
                alignSelf: "flex-start",
                minWidth: { xs: "100%", sm: 220 },
                maxWidth: "100%"
              }}
            >
              {VISIT_CLASS_FILTER_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label} ({visitClassCounts[option.value]})
                </MenuItem>
              ))}
            </TextField>
          )}

          {statusFilterEnabled && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={resourceStatusFilter}
              onChange={(_event, value: ResourceStatusFilter | null) => {
                if (value) setResourceStatusFilter(value);
              }}
              aria-label={`${RESOURCE_LABELS[activeTab]} status`}
              sx={{
                alignSelf: "flex-start",
                maxWidth: "100%",
                overflowX: "auto",
                "& .MuiToggleButton-root": { whiteSpace: "nowrap" }
              }}
            >
              <ToggleButton value="active" aria-label={`Active ${RESOURCE_LABELS[activeTab].toLowerCase()}`}>
                Active ({statusFilterGroupCounts.active})
              </ToggleButton>
              <ToggleButton value="all" aria-label={`All ${RESOURCE_LABELS[activeTab].toLowerCase()}`}>
                All ({statusFilterGroupCounts.all})
              </ToggleButton>
            </ToggleButtonGroup>
          )}
        </Stack>
      </Box>
    );
  }

  return (
    <>
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2.5}>
            {renderDataStatusBar()}
            {renderPatientProfile()}
            {error && <Alert severity="warning">{error}</Alert>}

            <Divider />

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "92px minmax(0, 1fr)" },
                gap: { xs: 2, md: 2.5 },
                alignItems: "start"
              }}
            >
              <Box sx={{ display: { xs: "none", md: "block" }, position: "sticky", top: 16 }}>
                {renderResourceNavigation("vertical")}
              </Box>
              <Stack spacing={2.25} minWidth={0}>
                <Box sx={{ display: { xs: "block", md: "none" } }}>{renderResourceNavigation("horizontal")}</Box>

                {renderRecordViewToolbar()}

            {visibleTabRecords.length === 0 ? (
              <Alert severity="info">
                No {statusFilterEnabled && resourceStatusFilter === "active" ? "active " : ""}
                {RESOURCE_LABELS[activeTab].toLowerCase()} available.
              </Alert>
            ) : effectiveViewMode === "date" ? (
              renderDateView(dateViewClusters, labelsByRecordId)
            ) : (
              <Stack spacing={density === "compact" ? 1 : 2}>{sortedVisibleTabGroups.map(renderGroup)}</Stack>
            )}
              </Stack>
            </Box>
          </Stack>
        </CardContent>
      </Card>
      {renderAddRecordDialog()}
      {renderDetailDrawer()}
    </>
  );
}
