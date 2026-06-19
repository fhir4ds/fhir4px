import type { PatientAuthoredRecord, PatientPatch } from "./patches";
import type { CanonicalCode } from "./canonical-codes";
import type { GroupReferenceRange } from "./reference-ranges";
import type {
  DisplayCodingSummary,
  DisplayCondition,
  DisplayDiagnosticReport,
  DisplayEncounter,
  DisplayImmunization,
  DisplayMedication,
  DisplayObservation,
  DisplayProcedure,
  ReferralSummary
} from "./types";

export type GroupableResourceType =
  | "MedicationRequest"
  | "AllergyIntolerance"
  | "Condition"
  | "Observation"
  | "Immunization"
  | "Encounter"
  | "Procedure"
  | "DiagnosticReport";
export type PatientObservationBucket = "labs" | "vitals" | "other";

export interface GroupableRecord {
  id: string;
  resourceType: GroupableResourceType;
  sourceLabel: string;
  status?: string;
  category?: string;
  categoryCode?: string;
  unit?: string;
  valueKind?: string;
  date?: string;
  displayValue?: string;
  canonicalValue?: number;
  canonicalUnit?: string;
  codeTexts?: string[];
  codeCodings?: DisplayCodingSummary[];
  codingKeys?: string[];
  groupingText?: string;
  ingredients?: string[];
  dosageForm?: string;
  route?: string;
  memberResourceIds?: string[];
  resourceCount?: number;
  sourceLabels?: string[];
  latestDate?: string;
  portalSourceId?: string;
  portalSourceName?: string;
  source: "provider" | "patient";
  hidden?: boolean;
  inactiveOverlay?: boolean;
}

export interface PatientFriendlyGroup {
  groupId: string;
  patientFriendlyName: string;
  resourceIds: string[];
  resourceTypes: GroupableResourceType[];
  observationBucket?: PatientObservationBucket;
  confidence: number;
  reason: string;
  fallback: boolean;
  /**
   * Canonical code resolved from patient-friendly name via the canonical-codes
   * tables (ICD-10 for conditions, LOINC for labs/vitals, RxNorm for meds).
   * Populated post-grouping in PatientExplorer. Used by GBD DW lookup,
   * reference-range resolver, and future code-keyed features.
   */
  canonicalCode?: CanonicalCode;
  referenceRange?: GroupReferenceRange;
}

export interface PatientGroupingResult {
  groups: PatientFriendlyGroup[];
  unassigned: string[];
  source: "source" | "deterministic" | "lookup" | "webllm" | "transformers" | "mixed";
}

function kebab(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function overlayForRecord(record: GroupableRecord, patches: PatientPatch[]): { hidden: boolean; inactive: boolean } {
  const relevant = patches.filter(
    (patch) => patch.targetResourceType === record.resourceType && patch.targetResourceId === record.id
  );
  return {
    hidden: relevant.some((patch) => patch.field === "patientRecordVisibility" && patch.value === "hidden"),
    inactive: relevant.some((patch) => patch.field === "patientRecordStatus" && patch.value === "inactive")
  };
}

function sourceLabelName(record: GroupableRecord): string {
  return record.sourceLabel.trim() || record.resourceType;
}

function normalizedSourceLabel(record: GroupableRecord): string {
  return sourceLabelName(record).toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizedKeyPart(value?: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function observationBucketFromCategory(category?: string, categoryCode?: string): PatientObservationBucket | undefined {
  const normalized = (categoryCode || category || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (normalized === "laboratory" || normalized === "lab") return "labs";
  if (normalized === "vital-signs" || normalized === "vital-sign") return "vitals";
  return undefined;
}

function observationBucketForRecord(record: GroupableRecord): PatientObservationBucket | undefined {
  return record.resourceType === "Observation" ? observationBucketFromCategory(record.category, record.categoryCode) : undefined;
}

function conceptText(value: unknown): string | undefined {
  const concept = value as { text?: string; coding?: Array<{ display?: string; code?: string }> } | undefined;
  return concept?.text || concept?.coding?.find((coding) => coding.display)?.display || concept?.coding?.[0]?.code;
}

function conceptCodings(value: unknown): DisplayCodingSummary[] {
  const concept = value as { coding?: Array<{ code?: string; display?: string }> } | undefined;
  return [
    ...new Map(
      (concept?.coding ?? [])
        .filter((coding) => coding.code || coding.display)
        .map((coding) => [`${coding.code ?? ""}|${coding.display ?? ""}`, { code: coding.code, display: coding.display }])
    ).values()
  ];
}

function conceptCodingKeys(value: unknown): string[] {
  const concept = value as { coding?: Array<{ system?: string; code?: string }> } | undefined;
  return [
    ...new Set(
      (concept?.coding ?? [])
        .filter((coding): coding is { system?: string; code: string } => Boolean(coding.code))
        .map((coding) => {
          const system = coding.system?.toLowerCase() ?? "";
          if (system.includes("rxnorm")) return `rxnorm:${coding.code}`;
          if (system.includes("hl7.org/fhir/sid/cvx")) return `cvx:${coding.code}`;
          if (system.includes("snomed.info/sct")) return `snomed:${coding.code}`;
          return coding.system ? `${coding.system}|${coding.code}` : coding.code;
        })
    )
  ];
}

function patientAuthoredRecordToGroupableRecord(authored: PatientAuthoredRecord): GroupableRecord {
  if (authored.resource?.resourceType === "MedicationRequest") {
    const concept = authored.resource.medicationCodeableConcept;
    const label = conceptText(concept) || authored.label || "Medication";
    const codingKeys = conceptCodingKeys(concept);
    const dosageText = authored.resource.dosageInstruction?.map((item) => item.text).filter(Boolean).join("; ");
    return {
      id: authored.id,
      resourceType: "MedicationRequest",
      sourceLabel: label,
      status: authored.resource.status,
      codingKeys,
      codeTexts: [concept.text || label],
      codeCodings: conceptCodings(concept),
      groupingText: [label, concept.text, dosageText, ...codingKeys].filter(Boolean).join(" "),
      date: authored.resource.authoredOn ?? authored.authoredAt,
      displayValue: dosageText,
      source: "patient"
    };
  }

  if (authored.resource?.resourceType === "Immunization") {
    const concept = authored.resource.vaccineCode;
    const label = conceptText(concept) || authored.label || "Immunization";
    const codingKeys = conceptCodingKeys(concept);
    return {
      id: authored.id,
      resourceType: "Immunization",
      sourceLabel: label,
      status: authored.resource.status,
      codingKeys,
      codeTexts: [concept.text || label],
      codeCodings: conceptCodings(concept),
      groupingText: [label, concept.text, ...codingKeys].filter(Boolean).join(" "),
      date: authored.resource.occurrenceDateTime ?? authored.authoredAt,
      source: "patient"
    };
  }

  if (authored.resource?.resourceType === "AllergyIntolerance") {
    const concept = authored.resource.code;
    const label = conceptText(concept) || authored.label || "Allergy";
    const reaction = authored.resource.reaction?.map((item) => item.description).filter(Boolean).join("; ");
    return {
      id: authored.id,
      resourceType: "AllergyIntolerance",
      sourceLabel: label,
      status: conceptText(authored.resource.clinicalStatus) || authored.status,
      codeTexts: [concept.text || label],
      codeCodings: conceptCodings(concept),
      groupingText: [label, reaction, authored.resource.criticality].filter(Boolean).join(" "),
      date: authored.resource.recordedDate ?? authored.authoredAt,
      displayValue: [authored.resource.criticality, reaction].filter(Boolean).join(" · ") || undefined,
      source: "patient"
    };
  }

  return {
    id: authored.id,
    resourceType: authored.resourceType,
    sourceLabel: authored.label,
    status: authored.status,
    date: authored.authoredAt,
    source: "patient"
  };
}

function mergeObservationBucket(
  existing: PatientObservationBucket | undefined,
  next: PatientObservationBucket | undefined
): PatientObservationBucket | undefined {
  if (!existing) return next;
  if (!next) return existing;
  return existing === next ? existing : undefined;
}

function sharedObservationBucket(records: GroupableRecord[]): PatientObservationBucket | undefined {
  const buckets = [
    ...new Set(
      records.map(observationBucketForRecord).filter((bucket): bucket is PatientObservationBucket => Boolean(bucket))
    )
  ];
  return buckets.length === 1 ? buckets[0] : undefined;
}

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))].sort(
    (left, right) => left.localeCompare(right)
  );
}

function uniqueCodings(codings: DisplayCodingSummary[]): DisplayCodingSummary[] {
  return [
    ...new Map(
      codings
        .filter((coding) => coding.code || coding.display)
        .map((coding) => [`${coding.code ?? ""}|${coding.display ?? ""}`, coding])
    ).values()
  ].sort((left, right) => `${left.code ?? ""} ${left.display ?? ""}`.localeCompare(`${right.code ?? ""} ${right.display ?? ""}`));
}

function latestDate(values: Array<string | undefined>): string | undefined {
  return uniqueSorted(values).at(-1);
}

function mostCommonLabel(records: GroupableRecord[]): string {
  const counts = new Map<string, number>();
  for (const record of records) {
    const label = sourceLabelName(record);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || "Record";
}

function exactSourceConceptParts(record: GroupableRecord): string[] {
  return uniqueSorted([
    ...(record.codingKeys ?? []),
    record.sourceLabel,
    ...(record.codeTexts ?? []),
    ...(record.codeCodings ?? []).flatMap((coding) => [coding.code, coding.display])
  ])
    .map(normalizedKeyPart)
    .filter(Boolean);
}

function exactSourceConceptKey(record: GroupableRecord): string {
  return exactSourceConceptParts(record).join("|");
}

const TARGET_CODING_PREFIXES: Record<GroupableResourceType, string[]> = {
  MedicationRequest: ["rxnorm", "ndc"],
  AllergyIntolerance: ["snomed"],
  Condition: ["snomed", "icd10cm"],
  Observation: ["loinc", "snomed", "cpt"],
  Immunization: ["cvx"],
  Encounter: ["snomed", "cpt"],
  Procedure: ["snomed", "cpt"],
  DiagnosticReport: ["loinc", "snomed", "cpt"]
};

function codingPrefix(key: string): string {
  return key.split(":", 1)[0]?.toLowerCase() ?? "";
}

function targetCodingKeys(record: GroupableRecord): string[] {
  const codingKeys = uniqueSorted(record.codingKeys ?? []);
  const targetPrefixes = TARGET_CODING_PREFIXES[record.resourceType];
  for (const prefix of targetPrefixes) {
    const matches = codingKeys.filter((key) => codingPrefix(key) === prefix);
    if (matches.length > 0) return matches;
  }
  return [];
}

function titleCaseFromParts(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function medicationIngredientRouteBasis(record: GroupableRecord): ReturnType<typeof rawGroupingBasis> | undefined {
  if (record.resourceType !== "MedicationRequest") return undefined;
  const ingredients = uniqueSorted(record.ingredients ?? []).map(normalizedKeyPart).filter(Boolean);
  if (!ingredients.length) return undefined;
  const route = normalizedKeyPart(record.route);

  const displayIngredients = uniqueSorted(record.ingredients ?? []);
  const displayName = titleCaseFromParts([...displayIngredients, record.route || ""]);

  return {
    groupId: route
      ? `medicationrequest-ingredient-route-${kebab([...ingredients, route].join("-"))}`
      : `medicationrequest-ingredient-${kebab(ingredients.join("-"))}`,
    name: displayName || sourceLabelName(record),
    confidence: route ? 0.8 : 0.7,
    reason: route ? "Grouped by source medication ingredient and route." : "Grouped by source medication ingredient.",
    fallback: false
  };
}

function rawGroupingBasis(record: GroupableRecord): {
  groupId: string;
  name: string;
  confidence: number;
  reason: string;
  fallback: boolean;
} {
  // Keep deterministic grouping deliberately narrow. Do not add clinical
  // semantic maps here. Patient-friendly normalization belongs to WebLLM now
  // and to a terminology service later. This path may only use exact source
  // code/display/text facts, plus medication ingredient/route facts that are
  // explicitly present or resolved from the source FHIR resources.
  const medicationBasis = medicationIngredientRouteBasis(record);
  if (medicationBasis) return medicationBasis;

  const targetKeys = targetCodingKeys(record);
  if (targetKeys.length > 0) {
    const conceptKey = targetKeys.join("|");
    return {
      groupId: `${record.resourceType.toLowerCase()}-target-code-${kebab(conceptKey) || stableHash(conceptKey)}`,
      name: sourceLabelName(record),
      confidence: 0.8,
      reason: "Grouped by preferred source standard code.",
      fallback: false
    };
  }

  const codingKeys = [...new Set(record.codingKeys ?? [])].sort();
  if (codingKeys.length > 0) {
    const conceptKey = exactSourceConceptKey(record);
    return {
      groupId: `${record.resourceType.toLowerCase()}-concept-${kebab(conceptKey) || stableHash(conceptKey)}`,
      name: sourceLabelName(record),
      confidence: 0.75,
      reason: "Grouped by identical source code/display/text.",
      fallback: false
    };
  }

  const normalizedLabel = normalizedSourceLabel(record);
  return {
    groupId: `${record.resourceType.toLowerCase()}-label-${kebab(normalizedLabel) || kebab(record.id)}`,
    name: sourceLabelName(record),
    confidence: 0.55,
    reason: "Grouped by exact source label.",
    fallback: true
  };
}

function compactGroupingKey(record: GroupableRecord): string {
  const codingKeys = uniqueSorted(record.codingKeys ?? []);
  const targetKeys = targetCodingKeys(record);
  const sourceLabel = normalizedSourceLabel(record);
  const exactConceptKey = exactSourceConceptKey(record);
  const normalizedCategory = normalizedKeyPart(record.categoryCode || record.category);

  if (record.resourceType === "MedicationRequest") {
    const ingredients = uniqueSorted(record.ingredients ?? []).map(normalizedKeyPart).filter(Boolean);
    const route = normalizedKeyPart(record.route);
    if (ingredients.length && route) {
      return [record.resourceType, "ingredient-route", ingredients.join("+"), route].join("|");
    }
    if (ingredients.length) return [record.resourceType, "ingredient", ingredients.join("+")].join("|");
    if (targetKeys.length) return [record.resourceType, "target-code", targetKeys.join("|")].join("|");
    if (codingKeys.length) return [record.resourceType, "code", codingKeys.join("|")].join("|");
    return [record.resourceType, "label", sourceLabel].join("|");
  }

  if (record.resourceType === "Observation") {
    if (targetKeys.length) return [record.resourceType, normalizedCategory, "target-code", targetKeys.join("|")].join("|");
    if (codingKeys.length) return [record.resourceType, normalizedCategory, "concept", exactConceptKey].join("|");
    return [record.resourceType, normalizedCategory, "label", sourceLabel].join("|");
  }

  if (targetKeys.length) return [record.resourceType, "target-code", targetKeys.join("|")].join("|");
  if (codingKeys.length) return [record.resourceType, "concept", exactConceptKey].join("|");
  return [record.resourceType, "label", sourceLabel].join("|");
}

function mergedRecordSource(records: GroupableRecord[]): GroupableRecord["source"] {
  return records.some((record) => record.source === "patient") ? "patient" : "provider";
}

function combineGroupingText(records: GroupableRecord[]): string | undefined {
  const parts = uniqueSorted(
    records.flatMap((record) => [
      record.groupingText,
      record.sourceLabel,
      record.category,
      record.categoryCode,
      record.unit,
      record.valueKind,
      record.dosageForm,
      record.route,
      ...(record.codingKeys ?? []),
      ...(record.ingredients ?? [])
    ])
  );
  return parts.length ? parts.join(" | ").slice(0, 900) : undefined;
}

export function compactRecordsForModel(records: GroupableRecord[]): GroupableRecord[] {
  const buckets = new Map<string, GroupableRecord[]>();

  for (const record of records.filter((candidate) => !candidate.hidden)) {
    const key = compactGroupingKey(record);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(record);
    else buckets.set(key, [record]);
  }

  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const first = bucket[0];
      const memberResourceIds = uniqueSorted(bucket.flatMap((record) => record.memberResourceIds ?? [record.id]));
      const sourceLabels = uniqueSorted(bucket.map((record) => record.sourceLabel));
      const dates = bucket.flatMap((record) => [record.latestDate, record.date]);
      const compactId = `cluster:${first.resourceType}:${stableHash(key)}`;
      const compactLabel = mostCommonLabel(bucket);

      return {
        ...first,
        id: compactId,
        sourceLabel: compactLabel,
        status: bucket.length === 1 ? first.status : undefined,
        codingKeys: uniqueSorted(bucket.flatMap((record) => record.codingKeys ?? [])),
        codeTexts: uniqueSorted(bucket.flatMap((record) => record.codeTexts ?? [record.sourceLabel])),
        codeCodings: uniqueCodings(bucket.flatMap((record) => record.codeCodings ?? [])),
        groupingText: combineGroupingText(bucket),
        ingredients: uniqueSorted(bucket.flatMap((record) => record.ingredients ?? [])),
        dosageForm: first.dosageForm,
        route: first.route,
        date: latestDate(dates),
        latestDate: latestDate(dates),
        displayValue: bucket.length === 1 ? first.displayValue : undefined,
        canonicalValue: bucket.length === 1 ? first.canonicalValue : undefined,
        canonicalUnit: first.canonicalUnit,
        memberResourceIds,
        resourceCount: memberResourceIds.length,
        sourceLabels,
        source: mergedRecordSource(bucket),
        hidden: false,
        inactiveOverlay: bucket.some((record) => record.inactiveOverlay)
      } satisfies GroupableRecord;
    })
    .sort(
      (left, right) =>
        left.resourceType.localeCompare(right.resourceType) ||
        (left.categoryCode || left.category || "").localeCompare(right.categoryCode || right.category || "") ||
        left.sourceLabel.localeCompare(right.sourceLabel)
    );
}

export function expandCompactGrouping(
  compactRecords: GroupableRecord[],
  result: PatientGroupingResult
): PatientGroupingResult {
  const originalIdsByCompactId = new Map(
    compactRecords.map((record) => [record.id, record.memberResourceIds?.length ? record.memberResourceIds : [record.id]])
  );

  const expandedGroups = result.groups.map((group) => {
    const resourceIds = [
      ...new Set(
        group.resourceIds.flatMap((id) => {
          return originalIdsByCompactId.get(id) ?? [id];
        })
      )
    ];

    return {
      ...group,
      resourceIds
    };
  });

  const unassigned = [
    ...new Set(result.unassigned.flatMap((id) => originalIdsByCompactId.get(id) ?? [id]))
  ];

  return {
    ...result,
    groups: expandedGroups,
    unassigned
  };
}

export function buildGroupableRecords(
  summary: ReferralSummary,
  options: { patches?: PatientPatch[]; patientAuthoredRecords?: PatientAuthoredRecord[] } = {}
): GroupableRecord[] {
  const patches = options.patches ?? [];
  const records: GroupableRecord[] = [];

  function add(record: GroupableRecord): void {
    const overlay = overlayForRecord(record, patches);
    records.push({ ...record, hidden: overlay.hidden, inactiveOverlay: overlay.inactive });
  }

  for (const medication of summary.medications) {
    add({
      id: medication.id,
      resourceType: "MedicationRequest",
      sourceLabel: medication.label,
      status: medication.status,
      codingKeys: medication.codingKeys,
      codeTexts: medication.codeSummary?.text ? [medication.codeSummary.text] : [medication.label],
      codeCodings: medication.codeSummary?.codings,
      groupingText: medication.groupingText,
      ingredients: medication.ingredients,
      dosageForm: medication.dosageForm,
      route: medication.route,
      date: medication.authoredAt,
      portalSourceId: medication.portalSourceId,
      portalSourceName: medication.portalSourceName,
      source: medication.source
    });
  }

  for (const condition of summary.conditions) {
    add({
      id: condition.id,
      resourceType: "Condition",
      sourceLabel: condition.label,
      status: condition.clinicalStatus,
      codingKeys: condition.codingKeys,
      codeTexts: condition.codeSummary?.text ? [condition.codeSummary.text] : [condition.label],
      codeCodings: condition.codeSummary?.codings,
      date: condition.authoredAt,
      portalSourceId: condition.portalSourceId,
      portalSourceName: condition.portalSourceName,
      source: condition.source
    });
  }

  for (const allergy of summary.allergies) {
    add({
      id: allergy.id,
      resourceType: "AllergyIntolerance",
      sourceLabel: allergy.label,
      status: allergy.clinicalStatus,
      codingKeys: allergy.codingKeys,
      codeTexts: allergy.codeSummary?.text ? [allergy.codeSummary.text] : [allergy.label],
      codeCodings: allergy.codeSummary?.codings,
      groupingText: [allergy.label, allergy.clinicalStatus, allergy.criticality, ...(allergy.codingKeys ?? [])]
        .filter(Boolean)
        .join(" "),
      date: allergy.authoredAt,
      displayValue: allergy.criticality,
      portalSourceId: allergy.portalSourceId,
      portalSourceName: allergy.portalSourceName,
      source: allergy.source
    });
  }

  for (const observation of summary.observations) {
    add({
      id: observation.id,
      resourceType: "Observation",
      sourceLabel: observation.label,
      status: observation.status,
      category: observation.category,
      categoryCode: observation.categoryCode,
      unit: observation.normalizedValue.displayUnit,
      valueKind: observation.normalizedValue.kind,
      date: observation.effectiveDate,
      displayValue: observation.value,
      canonicalValue: observation.normalizedValue.canonicalValue,
      canonicalUnit: observation.normalizedValue.canonicalUnit,
      codingKeys: observation.codingKeys,
      codeTexts: observation.codeSummary?.text ? [observation.codeSummary.text] : [observation.label],
      codeCodings: observation.codeSummary?.codings,
      portalSourceId: observation.portalSourceId,
      portalSourceName: observation.portalSourceName,
      groupingText: [
        observation.label,
        observation.category,
        observation.categoryCode,
        observation.normalizedValue.displayUnit,
        observation.normalizedValue.kind,
        ...(observation.codingKeys ?? [])
      ]
        .filter(Boolean)
        .join(" "),
      source: observation.source
    });
  }

  for (const immunization of summary.immunizations) {
    const codingKeys = (immunization.codes ?? []).map((code) => `cvx:${code}`);
    add({
      id: immunization.id,
      resourceType: "Immunization",
      sourceLabel: immunization.label,
      codingKeys,
      codeTexts: immunization.codeSummary?.text ? [immunization.codeSummary.text] : [immunization.label],
      codeCodings: immunization.codeSummary?.codings,
      groupingText: [immunization.label, ...codingKeys].join(" "),
      status: immunization.status,
      date: immunization.occurrenceDate,
      portalSourceId: immunization.portalSourceId,
      portalSourceName: immunization.portalSourceName,
      source: immunization.source
    });
  }

  for (const encounter of summary.encounters) {
    add({
      id: encounter.id,
      resourceType: "Encounter",
      sourceLabel: encounter.label,
      status: encounter.status,
      category: encounter.classLabel,
      codingKeys: encounter.codingKeys,
      codeTexts: uniqueSorted([
        encounter.codeSummary?.text,
        encounter.reasonSummary?.text,
        encounter.label,
        encounter.classLabel,
        encounter.serviceProvider
      ]),
      codeCodings: uniqueCodings([
        ...(encounter.codeSummary?.codings ?? []),
        ...(encounter.reasonSummary?.codings ?? [])
      ]),
      groupingText: [
        encounter.label,
        encounter.classLabel,
        encounter.serviceProvider,
        encounter.codeSummary?.text,
        encounter.reasonSummary?.text,
        ...(encounter.codingKeys ?? [])
      ]
        .filter(Boolean)
        .join(" "),
      date: encounter.periodStart ?? encounter.periodEnd,
      displayValue: encounter.serviceProvider,
      portalSourceId: encounter.portalSourceId,
      portalSourceName: encounter.portalSourceName,
      source: encounter.source
    });
  }

  for (const procedure of summary.procedures) {
    add({
      id: procedure.id,
      resourceType: "Procedure",
      sourceLabel: procedure.label,
      status: procedure.status,
      category: procedure.category,
      codingKeys: procedure.codingKeys,
      codeTexts: uniqueSorted([procedure.codeSummary?.text, procedure.reasonSummary?.text, procedure.label, procedure.category]),
      codeCodings: uniqueCodings([
        ...(procedure.codeSummary?.codings ?? []),
        ...(procedure.reasonSummary?.codings ?? [])
      ]),
      groupingText: [
        procedure.label,
        procedure.category,
        procedure.codeSummary?.text,
        procedure.reasonSummary?.text,
        ...(procedure.codingKeys ?? [])
      ]
        .filter(Boolean)
        .join(" "),
      date: procedure.performedDate,
      portalSourceId: procedure.portalSourceId,
      portalSourceName: procedure.portalSourceName,
      source: procedure.source
    });
  }

  for (const report of summary.diagnosticReports) {
    add({
      id: report.id,
      resourceType: "DiagnosticReport",
      sourceLabel: report.label,
      status: report.status,
      category: report.category,
      codingKeys: report.codingKeys,
      codeTexts: uniqueSorted([report.codeSummary?.text, report.label, report.category]),
      codeCodings: report.codeSummary?.codings,
      groupingText: [report.label, report.category, report.codeSummary?.text, ...(report.codingKeys ?? [])]
        .filter(Boolean)
        .join(" "),
      date: report.effectiveDate ?? report.issued,
      displayValue:
        report.conclusion ||
        (report.resultCount ? `${report.resultCount} linked ${report.resultCount === 1 ? "result" : "results"}` : undefined),
      portalSourceId: report.portalSourceId,
      portalSourceName: report.portalSourceName,
      source: report.source
    });
  }

  for (const authored of options.patientAuthoredRecords ?? []) {
    add(patientAuthoredRecordToGroupableRecord(authored));
  }

  return records;
}

export function deterministicPatientGrouping(records: GroupableRecord[]): PatientGroupingResult {
  const grouped = new Map<string, PatientFriendlyGroup>();
  const visibleRecords = records.filter((record) => !record.hidden);

  for (const record of visibleRecords) {
    const basis = rawGroupingBasis(record);
    const existing = grouped.get(basis.groupId);

    if (existing) {
      existing.resourceIds.push(record.id);
      if (!existing.resourceTypes.includes(record.resourceType)) existing.resourceTypes.push(record.resourceType);
      existing.confidence = Math.min(existing.confidence, basis.confidence);
      existing.fallback = existing.fallback || basis.fallback;
      const bucket = observationBucketForRecord(record);
      existing.observationBucket = mergeObservationBucket(existing.observationBucket, bucket);
    } else {
      grouped.set(basis.groupId, {
        groupId: basis.groupId,
        patientFriendlyName: basis.name,
        resourceIds: [record.id],
        resourceTypes: [record.resourceType],
        observationBucket: observationBucketForRecord(record),
        confidence: basis.confidence,
        reason: basis.reason,
        fallback: basis.fallback
      });
    }
  }

  return {
    groups: [...grouped.values()].sort((left, right) =>
      left.patientFriendlyName.localeCompare(right.patientFriendlyName)
    ),
    unassigned: [],
    source: "deterministic"
  };
}

export function sourceRecordGrouping(records: GroupableRecord[]): PatientGroupingResult {
  const visibleRecords = records.filter((record) => !record.hidden);
  return {
    groups: visibleRecords
      .map((record) => ({
        groupId: `${record.resourceType.toLowerCase()}-source-${kebab(record.id) || stableHash(record.id)}`,
        patientFriendlyName: sourceLabelName(record),
        resourceIds: [record.id],
        resourceTypes: [record.resourceType],
        observationBucket: observationBucketForRecord(record),
        confidence: 0.5,
        reason: "Source record displayed without model grouping.",
        fallback: true
      }))
      .sort((left, right) => left.patientFriendlyName.localeCompare(right.patientFriendlyName)),
    unassigned: [],
    source: "source"
  };
}

export function splitFallbackGroupsToSourceRecords(
  result: PatientGroupingResult,
  records: GroupableRecord[]
): PatientGroupingResult {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const groups: PatientFriendlyGroup[] = [];
  let splitAny = false;

  for (const group of result.groups) {
    if (!group.fallback || group.resourceIds.length <= 1) {
      groups.push(group);
      continue;
    }

    splitAny = true;
    for (const id of group.resourceIds) {
      const record = recordsById.get(id);
      if (!record) {
        groups.push({
          ...group,
          groupId: `${group.groupId}-source-${stableHash(id)}`,
          resourceIds: [id],
          confidence: Math.min(group.confidence, 0.5),
          fallback: true
        });
        continue;
      }

      groups.push({
        groupId: `${record.resourceType.toLowerCase()}-source-${kebab(record.id) || stableHash(record.id)}`,
        patientFriendlyName: sourceLabelName(record),
        resourceIds: [record.id],
        resourceTypes: [record.resourceType],
        observationBucket: observationBucketForRecord(record),
        confidence: Math.min(group.confidence, 0.5),
        reason: "Source record fallback for ungrouped local model output.",
        fallback: true
      });
    }
  }

  return {
    groups,
    unassigned: result.unassigned,
    source: splitAny && result.source === "webllm" ? "mixed" : result.source
  };
}

const UNSAFE_OBSERVATION_GROUP_NAMES = new Set([
  "blood counts",
  "blood count",
  "blood sugar",
  "blood pressure",
  "cardiovascular",
  "cholesterol",
  "diabetes",
  "diabetes monitoring",
  "high blood pressure",
  "hypertension",
  "kidney disease",
  "kidney function",
  "lab",
  "lab result",
  "lab results",
  "laboratory",
  "liver disease",
  "liver function",
  "metabolic health",
  "type 2 diabetes",
  "vital sign",
  "vital signs"
]);

const UNSAFE_OBSERVATION_GROUP_PHRASES = [
  "care program",
  "diabetes",
  "disease",
  "monitoring",
  "screening"
];

function isUnsafeObservationGroupName(name: string): boolean {
  const normalized = normalizedKeyPart(name);
  if (!normalized) return true;
  if (UNSAFE_OBSERVATION_GROUP_NAMES.has(normalized)) return true;

  if (normalized.includes("blood pressure")) {
    return !/\b(systolic|diastolic|mean arterial|orthostatic)\b/.test(normalized);
  }

  if (normalized.includes("cholesterol")) {
    return !/\b(ldl|hdl|total|non hdl|triglycerides?)\b/.test(normalized);
  }

  return UNSAFE_OBSERVATION_GROUP_PHRASES.some((phrase) => normalized.includes(phrase));
}

function observationSourceConceptMatchesName(records: GroupableRecord[], patientFriendlyName: string): boolean {
  const normalizedName = normalizedKeyPart(patientFriendlyName);
  if (!normalizedName) return false;

  return records.some((record) => {
    const sourceConcepts = [
      record.sourceLabel,
      ...(record.codeTexts ?? []),
      ...(record.codeCodings ?? []).map((coding) => coding.display)
    ];

    return sourceConcepts.some((concept) => normalizedKeyPart(concept) === normalizedName);
  });
}

function shouldRejectModelGroup(records: GroupableRecord[], resourceIds: string[], patientFriendlyName: string): boolean {
  const groupRecords = records.filter((record) => resourceIds.includes(record.id));
  if (!groupRecords.length) return false;
  const resourceTypes = new Set(groupRecords.map((record) => record.resourceType));
  return (
    resourceTypes.size === 1 &&
    resourceTypes.has("Observation") &&
    isUnsafeObservationGroupName(patientFriendlyName) &&
    !observationSourceConceptMatchesName(groupRecords, patientFriendlyName)
  );
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

function unusedFallbackGroups(
  records: GroupableRecord[],
  fallback: PatientGroupingResult,
  assigned: Set<string>,
  existingGroupIds: Set<string>
): PatientFriendlyGroup[] {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const unassigned = new Set(records.filter((record) => !record.hidden && !assigned.has(record.id)).map((record) => record.id));
  const groups: PatientFriendlyGroup[] = [];

  for (const group of fallback.groups) {
    const resourceIds = group.resourceIds.filter((id) => unassigned.has(id));
    if (!resourceIds.length) continue;

    let groupId = group.groupId;
    for (let suffix = 1; existingGroupIds.has(groupId); suffix += 1) {
      groupId = `${group.groupId}-fallback-${suffix}`;
    }
    existingGroupIds.add(groupId);
    for (const id of resourceIds) assigned.add(id);

    groups.push({
      ...group,
      groupId,
      resourceIds,
      resourceTypes: [
        ...new Set(
          resourceIds
            .map((id) => recordsById.get(id)?.resourceType)
            .filter((type): type is GroupableResourceType => Boolean(type))
        )
      ],
      observationBucket: sharedObservationBucket(
        resourceIds
          .map((id) => recordsById.get(id))
          .filter((record): record is GroupableRecord => Boolean(record))
      ),
      confidence: Math.min(group.confidence, 0.55),
      reason: group.reason || "Fallback grouping for records left unassigned by the local model.",
      fallback: true
    });
  }

  return groups;
}

export function validateGroupingResult(
  records: GroupableRecord[],
  result: unknown,
  fallback: PatientGroupingResult
): PatientGroupingResult {
  const recordIds = new Set(records.filter((record) => !record.hidden).map((record) => record.id));
  const parsed = result as Partial<PatientGroupingResult> | undefined;
  if (!parsed || !Array.isArray(parsed.groups)) return fallback;

  const groupsById = new Map<string, PatientFriendlyGroup>();
  const assigned = new Set<string>();
  let acceptedModelGroupCount = 0;

  for (const group of parsed.groups as Partial<PatientFriendlyGroup>[]) {
    if (!group || typeof group.patientFriendlyName !== "string" || !Array.isArray(group.resourceIds)) continue;
    const validIds = [
      ...new Set(
        group.resourceIds.filter(
          (id): id is string => typeof id === "string" && recordIds.has(id) && !assigned.has(id)
        )
      )
    ];
    if (validIds.length === 0) continue;
    if (shouldRejectModelGroup(records, validIds, group.patientFriendlyName)) continue;
    acceptedModelGroupCount += 1;
    const confidence = typeof group.confidence === "number" ? Math.max(0, Math.min(1, group.confidence)) : 0.5;
    for (const id of validIds) assigned.add(id);
    const groupId = typeof group.groupId === "string" && group.groupId ? group.groupId : kebab(group.patientFriendlyName);
    const resourceTypes = Array.isArray(group.resourceTypes)
      ? [...new Set(group.resourceTypes.filter((type): type is GroupableResourceType => typeof type === "string"))]
      : [...new Set(records.filter((record) => validIds.includes(record.id)).map((record) => record.resourceType))];
    const groupRecords = records.filter((record) => validIds.includes(record.id));
    const observationBucket =
      resourceTypes.length === 1 && resourceTypes[0] === "Observation"
        ? parseObservationBucket(group.observationBucket) ?? sharedObservationBucket(groupRecords)
        : undefined;
    const existing = groupsById.get(groupId);

    if (existing) {
      existing.resourceIds.push(...validIds);
      for (const type of resourceTypes) {
        if (!existing.resourceTypes.includes(type)) existing.resourceTypes.push(type);
      }
      existing.confidence = Math.min(existing.confidence, confidence);
      existing.fallback = existing.fallback || Boolean(group.fallback) || confidence < 0.55;
      existing.observationBucket = mergeObservationBucket(existing.observationBucket, observationBucket);
      existing.reason = existing.reason || "Generated by local model.";
      continue;
    }

    groupsById.set(groupId, {
      groupId,
      patientFriendlyName: group.patientFriendlyName.slice(0, 80),
      resourceIds: validIds,
      resourceTypes,
      observationBucket,
      confidence,
      reason: typeof group.reason === "string" ? group.reason.slice(0, 160) : "Generated by local model.",
      fallback: Boolean(group.fallback) || confidence < 0.55
    });
  }

  if (acceptedModelGroupCount === 0) return fallback;

  const fallbackGroups = unusedFallbackGroups(records, fallback, assigned, new Set(groupsById.keys()));
  for (const group of fallbackGroups) groupsById.set(group.groupId, group);

  const groups = [...groupsById.values()].map((group) => ({
    ...group,
    resourceIds: [...new Set(group.resourceIds)],
    resourceTypes: group.resourceTypes.length
      ? group.resourceTypes
      : [
          ...new Set(
            records
              .filter((record) => group.resourceIds.includes(record.id))
              .map((record) => record.resourceType)
          )
        ]
  }));

  const unassigned = [...recordIds].filter((id) => !assigned.has(id));
  return { groups, unassigned, source: fallbackGroups.length ? "mixed" : "webllm" };
}
