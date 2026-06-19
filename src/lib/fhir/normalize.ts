import type { FhirResource } from "../smart/data";
import { normalizeObservationValue, observationHasAbnormalInterpretation } from "./observation-values";
import { createResourceIndex, resolveReference, type ResourceIndex } from "./references";
import type {
  DisplayAllergy,
  DisplayCondition,
  DisplayDiagnosticReport,
  DisplayEncounter,
  DisplayImmunization,
  DisplayMedication,
  DisplayObservation,
  DisplayProcedure,
  ExtractedReferenceRange,
  ReferralSummary
} from "./types";
import type { DisplayCodeSummary } from "./types";

function codingText(resource: FhirResource, path: string[]): string | undefined {
  let current: unknown = resource;
  for (const part of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  const concept = current as { text?: string; coding?: Array<{ display?: string; code?: string }> };
  return concept?.text || concept?.coding?.find((coding) => coding.display)?.display || concept?.coding?.[0]?.code;
}

function firstCodingText(value: unknown): string | undefined {
  const concept = value as { text?: string; coding?: Array<{ display?: string; code?: string }> };
  return concept?.text || concept?.coding?.find((coding) => coding.display)?.display || concept?.coding?.[0]?.code;
}

function firstCodingCode(value: unknown): string | undefined {
  const concept = value as { coding?: Array<{ code?: string }> };
  return concept?.coding?.find((coding) => coding.code)?.code;
}

function codeSummaryFromConcept(value: unknown): DisplayCodeSummary | undefined {
  const concept = value as { text?: string; coding?: Array<{ code?: string; display?: string }> } | undefined;
  const codings = [
    ...new Map(
      (concept?.coding ?? [])
        .filter((coding) => coding.code || coding.display)
        .map((coding) => [`${coding.code ?? ""}|${coding.display ?? ""}`, { code: coding.code, display: coding.display }])
    ).values()
  ];
  const text = typeof concept?.text === "string" && concept.text.trim() ? concept.text.trim() : undefined;
  if (!text && codings.length === 0) return undefined;
  return { text, codings };
}

function summarizeCode(resource: FhirResource, path: string[]): DisplayCodeSummary | undefined {
  let current: unknown = resource;
  for (const part of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return codeSummaryFromConcept(current);
}

const OID_CODE_SYSTEM_PREFIXES: Record<string, string> = {
  "2.16.840.1.113883.6.1": "loinc",
  "2.16.840.1.113883.6.8": "ucum",
  "2.16.840.1.113883.6.12": "cpt",
  "2.16.840.1.113883.6.69": "ndc",
  "2.16.840.1.113883.6.88": "rxnorm",
  "2.16.840.1.113883.6.96": "snomed",
  "2.16.840.1.113883.12.292": "cvx"
};

function oidFromSystem(system?: string): string | undefined {
  const value = system?.trim().toLowerCase();
  if (!value) return undefined;
  const match = value.match(/^(?:urn:oid:|oid:)?([0-2](?:\.\d+)+)$/);
  return match?.[1];
}

function codingKey(system: string | undefined, code: string): string {
  const oid = oidFromSystem(system);
  if (oid && OID_CODE_SYSTEM_PREFIXES[oid]) return `${OID_CODE_SYSTEM_PREFIXES[oid]}:${code}`;
  if (oid) return `oid:${oid}:${code}`;

  const normalizedSystem = system?.toLowerCase();
  if (normalizedSystem?.includes("rxnorm")) return `rxnorm:${code}`;
  if (normalizedSystem?.includes("loinc.org")) return `loinc:${code}`;
  if (normalizedSystem?.includes("snomed.info/sct")) return `snomed:${code}`;
  if (normalizedSystem?.includes("hl7.org/fhir/sid/cvx")) return `cvx:${code}`;
  if (normalizedSystem?.includes("hl7.org/fhir/sid/ndc")) return `ndc:${code}`;
  if (normalizedSystem?.includes("ama-assn.org/go/cpt")) return `cpt:${code}`;
  if (normalizedSystem?.includes("icd-10")) return `icd10cm:${code}`;
  return system ? `${system}|${code}` : code;
}

function codingKeysFromConcept(value: unknown): string[] {
  const concept = value as { coding?: Array<{ system?: string; code?: string }> };
  return [
    ...new Set(
      (concept?.coding ?? [])
        .filter((coding): coding is { system?: string; code: string } => Boolean(coding.code))
        .map((coding) => codingKey(coding.system, coding.code))
    )
  ];
}

function codingKeys(resource: FhirResource, path: string[]): string[] {
  let current: unknown = resource;
  for (const part of path) {
    if (typeof current !== "object" || current === null) return [];
    current = (current as Record<string, unknown>)[part];
  }

  return codingKeysFromConcept(current);
}

function codingCodes(resource: FhirResource, path: string[]): string[] {
  let current: unknown = resource;
  for (const part of path) {
    if (typeof current !== "object" || current === null) return [];
    current = (current as Record<string, unknown>)[part];
  }

  const concept = current as { coding?: Array<{ code?: string }> };
  return [...new Set((concept?.coding ?? []).map((coding) => coding.code).filter((code): code is string => Boolean(code)))];
}

function observationEffectiveDate(resource: FhirResource): string | undefined {
  if (typeof resource.effectiveDateTime === "string") return resource.effectiveDateTime;
  if (typeof resource.issued === "string") return resource.issued;

  const effectivePeriod = resource.effectivePeriod as { start?: string; end?: string } | undefined;
  return effectivePeriod?.start || effectivePeriod?.end;
}

function codingKeysFromConceptArray(value: unknown): string[] {
  return [
    ...new Set(
      (Array.isArray(value) ? value : value ? [value] : []).flatMap((entry) => codingKeysFromConcept(entry))
    )
  ];
}

function firstConceptSummary(value: unknown): DisplayCodeSummary | undefined {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  for (const entry of entries) {
    const summary = codeSummaryFromConcept(entry);
    if (summary) return summary;
  }
  return undefined;
}

function firstConceptText(value: unknown): string | undefined {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  for (const entry of entries) {
    const text = firstCodingText(entry);
    if (text) return text;
  }
  return undefined;
}

function referenceDisplay(reference: unknown, index?: ResourceIndex): string | undefined {
  const entry = reference as { reference?: string; display?: string } | undefined;
  if (!entry) return undefined;
  const resolved = resolveReference(entry.reference, index ?? { byKey: new Map() });
  const resolvedLabel =
    resolved?.resourceType === "Organization"
      ? typeof resolved.name === "string"
        ? resolved.name
        : undefined
      : resolved?.resourceType === "Practitioner"
        ? practitionerName(resolved)
        : resolved?.resourceType === "Location"
          ? typeof resolved.name === "string"
            ? resolved.name
            : undefined
          : undefined;
  return resolvedLabel || entry.display || entry.reference;
}

function practitionerName(resource: FhirResource): string | undefined {
  const names = Array.isArray(resource.name) ? resource.name : [];
  const selected = names[0] as { text?: string; given?: string[]; family?: string } | undefined;
  if (!selected) return undefined;
  if (selected.text?.trim()) return selected.text.trim();
  return [...(selected.given ?? []), selected.family].filter(Boolean).join(" ").trim() || undefined;
}

function periodStart(resource: FhirResource, field: string): string | undefined {
  const period = resource[field] as { start?: string; end?: string } | undefined;
  return period?.start || period?.end;
}

function encounterDate(resource: FhirResource): string | undefined {
  return periodStart(resource, "period");
}

function procedureDate(resource: FhirResource): string | undefined {
  if (typeof resource.performedDateTime === "string") return resource.performedDateTime;
  if (typeof resource.performedString === "string") return resource.performedString;
  return periodStart(resource, "performedPeriod");
}

function diagnosticReportDate(resource: FhirResource): string | undefined {
  if (typeof resource.effectiveDateTime === "string") return resource.effectiveDateTime;
  return periodStart(resource, "effectivePeriod") || (typeof resource.issued === "string" ? resource.issued : undefined);
}

function medicationReferenceLabel(resource: FhirResource, index?: ResourceIndex): string | undefined {
  const reference = (resource.medicationReference as { reference?: string; display?: string } | undefined) ?? undefined;
  if (!reference) return undefined;
  const referencedMedication = resolveReference(reference.reference, index ?? { byKey: new Map() });
  return (referencedMedication ? codingText(referencedMedication, ["code"]) : undefined) || reference.display || reference.reference;
}

function medicationReferenceResource(resource: FhirResource, index?: ResourceIndex): FhirResource | undefined {
  const reference = (resource.medicationReference as { reference?: string } | undefined) ?? undefined;
  if (!reference) return undefined;
  return resolveReference(reference.reference, index ?? { byKey: new Map() });
}

function medicationIngredientLabels(resource?: FhirResource): string[] {
  const ingredients = Array.isArray(resource?.ingredient) ? resource.ingredient : [];
  return [
    ...new Set(
      ingredients
        .map((ingredient) => {
          const entry = ingredient as {
            itemCodeableConcept?: unknown;
            itemReference?: { display?: string; reference?: string };
          };
          return firstCodingText(entry.itemCodeableConcept) || entry.itemReference?.display || entry.itemReference?.reference;
        })
        .filter((label): label is string => Boolean(label))
    )
  ];
}

function medicationRoute(resource: FhirResource): string | undefined {
  const dosageInstructions = Array.isArray(resource.dosageInstruction) ? resource.dosageInstruction : [];
  for (const instruction of dosageInstructions) {
    const route = (instruction as { route?: unknown }).route;
    const label = firstCodingText(route);
    if (label) return label;
  }
  return undefined;
}

function medicationInstructionTexts(resource: FhirResource): string[] {
  const dosageInstructions = Array.isArray(resource.dosageInstruction) ? resource.dosageInstruction : [];
  return dosageInstructions
    .map((instruction) => (instruction as { text?: unknown }).text)
    .filter((text): text is string => typeof text === "string" && Boolean(text.trim()));
}

function inferMedicationRouteFromSourceText(values: Array<string | undefined>): string | undefined {
  const text = values
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  if (!text.trim()) return undefined;

  if (/\b(sublingual|under the tongue)\b/.test(text)) return "Sublingual";
  if (/\bbuccal\b/.test(text)) return "Buccal";
  if (/\b(ophthalmic|eye drops?|in the eye|to the eye)\b/.test(text)) return "Ophthalmic";
  if (/\b(otic|ear drops?|in the ear|to the ear)\b/.test(text)) return "Otic";
  if (/\b(inhalation|inhaled|inhaler|nebulizer|nebulised|nebulized|inhale)\b/.test(text)) return "Inhaled";
  if (/\b(intranasal|nasal|nostril)\b/.test(text)) return "Nasal";
  if (/\b(transdermal|patch)\b/.test(text)) return "Transdermal";
  if (/\b(topical|cream|ointment|lotion|gel|shampoo|foam)\b/.test(text)) return "Topical";
  if (/\b(rectal|suppository)\b/.test(text)) return "Rectal";
  if (/\bvaginal\b/.test(text)) return "Vaginal";
  if (/\b(intravenous|iv)\b/.test(text)) return "Intravenous";
  if (/\b(intramuscular|im)\b/.test(text)) return "Intramuscular";
  if (/\b(subcutaneous|subcut|sc)\b/.test(text)) return "Subcutaneous";
  if (/\b(injection|injectable|inject|syringe|pen injector)\b/.test(text)) return "Injection";
  if (/\b(by mouth|mouth|oral|orally|tablet|capsule|caplet|chewable|lozenge)\b/.test(text)) return "Oral";

  return undefined;
}

export function normalizeMedication(resource: FhirResource, index?: ResourceIndex): DisplayMedication {
  const referencedMedication = medicationReferenceResource(resource, index);
  const medication =
    codingText(resource, ["medicationCodeableConcept"]) ||
    (referencedMedication ? codingText(referencedMedication, ["code"]) : undefined) ||
    medicationReferenceLabel(resource, index) ||
    codingText(resource, ["code"]) ||
    resource.id ||
    "Medication";
  const keys = [
    ...codingKeys(resource, ["medicationCodeableConcept"]),
    ...(referencedMedication ? codingKeys(referencedMedication, ["code"]) : [])
  ];
  const codeSummary =
    summarizeCode(resource, ["medicationCodeableConcept"]) ??
    (referencedMedication ? summarizeCode(referencedMedication, ["code"]) : undefined) ??
    (typeof (resource.medicationReference as { display?: string } | undefined)?.display === "string"
      ? { text: (resource.medicationReference as { display: string }).display }
      : undefined);
  const ingredients = medicationIngredientLabels(referencedMedication);
  const dosageForm = referencedMedication ? codingText(referencedMedication, ["form"]) : undefined;
  const route =
    medicationRoute(resource) ??
    inferMedicationRouteFromSourceText([medication, dosageForm, ...medicationInstructionTexts(resource)]);

  return {
    id: resource.id || crypto.randomUUID(),
    label: medication,
    status: typeof resource.status === "string" ? resource.status : "unknown",
    codingKeys: [...new Set(keys)],
    codeSummary,
    ingredients,
    dosageForm,
    route,
    groupingText: [medication, ...ingredients, dosageForm, route, ...keys].filter(Boolean).join(" "),
    source: "provider",
    authoredAt: typeof resource.authoredOn === "string" ? resource.authoredOn : undefined
  };
}

export function normalizeAllergy(resource: FhirResource): DisplayAllergy {
  return {
    id: resource.id || crypto.randomUUID(),
    label: codingText(resource, ["code"]) || resource.id || "Allergy",
    clinicalStatus: codingText(resource, ["clinicalStatus"]),
    criticality: typeof resource.criticality === "string" ? resource.criticality : undefined,
    codingKeys: codingKeys(resource, ["code"]),
    codeSummary: summarizeCode(resource, ["code"]),
    source: "provider",
    authoredAt: typeof resource.recordedDate === "string" ? resource.recordedDate : undefined
  };
}

export function normalizeCondition(resource: FhirResource): DisplayCondition {
  return {
    id: resource.id || crypto.randomUUID(),
    label: codingText(resource, ["code"]) || resource.id || "Condition",
    clinicalStatus: codingText(resource, ["clinicalStatus"]),
    codingKeys: codingKeys(resource, ["code"]),
    codeSummary: summarizeCode(resource, ["code"]),
    source: "provider",
    authoredAt:
      typeof resource.recordedDate === "string"
        ? resource.recordedDate
        : typeof resource.onsetDateTime === "string"
          ? resource.onsetDateTime
          : undefined
  };
}

export function normalizeObservation(resource: FhirResource): DisplayObservation {
  const normalizedValue = normalizeObservationValue(resource);
  return {
    id: resource.id || crypto.randomUUID(),
    label: codingText(resource, ["code"]) || resource.id || "Observation",
    value: normalizedValue.display,
    normalizedValue,
    status: typeof resource.status === "string" ? resource.status : "unknown",
    category: Array.isArray(resource.category)
      ? firstCodingText(resource.category[0])
      : firstCodingText(resource.category),
    categoryCode: Array.isArray(resource.category)
      ? firstCodingCode(resource.category[0])
      : firstCodingCode(resource.category),
    codingKeys: codingKeys(resource, ["code"]),
    codeSummary: summarizeCode(resource, ["code"]),
    effectiveDate: observationEffectiveDate(resource),
    interpretation: Array.isArray(resource.interpretation)
      ? firstCodingText(resource.interpretation[0])
      : firstCodingText(resource.interpretation),
    abnormal: observationHasAbnormalInterpretation(resource),
    referenceRange: extractReferenceRange(resource),
    source: "provider"
  };
}

function extractReferenceRange(resource: FhirResource): ExtractedReferenceRange | undefined {
  const ranges = Array.isArray(resource.referenceRange) ? resource.referenceRange : [];
  const first = ranges.find((r) => r && (r.low || r.high || r.text));
  if (!first) return undefined;
  const low = typeof first.low?.value === "number" ? first.low.value : undefined;
  const high = typeof first.high?.value === "number" ? first.high.value : undefined;
  const unit = (first.low?.unit ?? first.high?.unit ?? undefined) as string | undefined;
  const ucumCode = (first.low?.code ?? first.high?.code ?? undefined) as string | undefined;
  const text = typeof first.text === "string" && first.text.trim() ? first.text.trim() : undefined;
  if (low === undefined && high === undefined && !text) return undefined;
  return { low, high, unit, ucumCode, text };
}

export function normalizeImmunization(resource: FhirResource): DisplayImmunization {
  return {
    id: resource.id || crypto.randomUUID(),
    label: codingText(resource, ["vaccineCode"]) || resource.id || "Immunization",
    codes: codingCodes(resource, ["vaccineCode"]),
    codeSummary: summarizeCode(resource, ["vaccineCode"]),
    status: typeof resource.status === "string" ? resource.status : undefined,
    occurrenceDate:
      typeof resource.occurrenceDateTime === "string"
        ? resource.occurrenceDateTime
        : typeof resource.recorded === "string"
          ? resource.recorded
          : undefined,
    source: "provider"
  };
}

export function normalizeEncounter(resource: FhirResource, index?: ResourceIndex): DisplayEncounter {
  const typeLabel = firstConceptText(resource.type);
  const reasonLabel = firstConceptText(resource.reasonCode);
  const classEntry = resource.class as { display?: string; code?: string } | undefined;
  const classLabel = classEntry?.display || classEntry?.code;
  const serviceProvider = referenceDisplay(resource.serviceProvider, index);
  const label = typeLabel || reasonLabel || classLabel || serviceProvider || resource.id || "Encounter";
  const period = resource.period as { start?: string; end?: string } | undefined;

  return {
    id: resource.id || crypto.randomUUID(),
    label,
    status: typeof resource.status === "string" ? resource.status : undefined,
    classLabel,
    codeSummary: firstConceptSummary(resource.type),
    reasonSummary: firstConceptSummary(resource.reasonCode),
    codingKeys: [...new Set([...codingKeysFromConceptArray(resource.type), ...codingKeysFromConceptArray(resource.reasonCode)])],
    periodStart: period?.start,
    periodEnd: period?.end,
    serviceProvider,
    source: "provider"
  };
}

export function normalizeProcedure(resource: FhirResource): DisplayProcedure {
  const category = firstCodingText(resource.category);
  return {
    id: resource.id || crypto.randomUUID(),
    label: codingText(resource, ["code"]) || resource.id || "Procedure",
    status: typeof resource.status === "string" ? resource.status : undefined,
    category,
    codeSummary: summarizeCode(resource, ["code"]),
    reasonSummary: firstConceptSummary(resource.reasonCode),
    codingKeys: [...new Set([...codingKeys(resource, ["code"]), ...codingKeysFromConceptArray(resource.reasonCode)])],
    performedDate: procedureDate(resource),
    source: "provider"
  };
}

export function normalizeDiagnosticReport(resource: FhirResource): DisplayDiagnosticReport {
  const results = Array.isArray(resource.result) ? resource.result : [];
  return {
    id: resource.id || crypto.randomUUID(),
    label: codingText(resource, ["code"]) || resource.id || "Diagnostic report",
    status: typeof resource.status === "string" ? resource.status : undefined,
    category: firstConceptText(resource.category),
    codeSummary: summarizeCode(resource, ["code"]),
    codingKeys: codingKeys(resource, ["code"]),
    effectiveDate: diagnosticReportDate(resource),
    issued: typeof resource.issued === "string" ? resource.issued : undefined,
    resultCount: results.length || undefined,
    conclusion: typeof resource.conclusion === "string" && resource.conclusion.trim() ? resource.conclusion.trim() : undefined,
    source: "provider"
  };
}

export function buildReferralSummary(resources: FhirResource[]): ReferralSummary {
  const index = createResourceIndex(resources);
  return {
    patient: resources.find((resource) => resource.resourceType === "Patient") ?? null,
    medications: resources
      .filter((resource) => resource.resourceType === "MedicationRequest")
      .map((resource) => normalizeMedication(resource, index)),
    allergies: resources
      .filter((resource) => resource.resourceType === "AllergyIntolerance")
      .map(normalizeAllergy),
    conditions: resources
      .filter((resource) => resource.resourceType === "Condition")
      .map(normalizeCondition),
    observations: resources
      .filter((resource) => resource.resourceType === "Observation")
      .map(normalizeObservation)
      .sort((left, right) => (right.effectiveDate || "").localeCompare(left.effectiveDate || "")),
    immunizations: resources
      .filter((resource) => resource.resourceType === "Immunization")
      .map(normalizeImmunization)
      .sort((left, right) => (right.occurrenceDate || "").localeCompare(left.occurrenceDate || "")),
    encounters: resources
      .filter((resource) => resource.resourceType === "Encounter")
      .map((resource) => normalizeEncounter(resource, index))
      .sort((left, right) => (right.periodStart || "").localeCompare(left.periodStart || "")),
    procedures: resources
      .filter((resource) => resource.resourceType === "Procedure")
      .map(normalizeProcedure)
      .sort((left, right) => (right.performedDate || "").localeCompare(left.performedDate || "")),
    diagnosticReports: resources
      .filter((resource) => resource.resourceType === "DiagnosticReport")
      .map(normalizeDiagnosticReport)
      .sort((left, right) => (right.effectiveDate || right.issued || "").localeCompare(left.effectiveDate || left.issued || "")),
    generatedAt: new Date().toISOString()
  };
}
