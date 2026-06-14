import type { FhirResource } from "../smart/data";

export type ObservationValueKind =
  | "quantity"
  | "codeable-concept"
  | "string"
  | "boolean"
  | "integer"
  | "datetime"
  | "period"
  | "absent"
  | "unknown";

export interface NormalizedObservationValue {
  kind: ObservationValueKind;
  display: string;
  numericValue?: number;
  displayUnit?: string;
  ucumCode?: string;
  canonicalValue?: number;
  canonicalUnit?: string;
  sourceSystem?: string;
  sourceCode?: string;
  dataAbsentReason?: string;
  originalField?: string;
}

interface CodeableConceptLike {
  text?: string;
  coding?: Array<{ system?: string; code?: string; display?: string }>;
}

function firstCodingText(value: unknown): string | undefined {
  const concept = value as CodeableConceptLike | undefined;
  return concept?.text || concept?.coding?.find((coding) => coding.display)?.display || concept?.coding?.[0]?.code;
}

function normalizeQuantityUnit(unit?: string, code?: string): { displayUnit?: string; ucumCode?: string } {
  const ucumCode = code?.trim() || undefined;
  const displayUnit = unit?.trim() || ucumCode;
  return { displayUnit, ucumCode };
}

function canonicalizeQuantity(value: number, unit?: string, code?: string): Pick<
  NormalizedObservationValue,
  "canonicalValue" | "canonicalUnit"
> {
  const normalized = (code || unit || "").trim().toLowerCase();

  if (["kg", "kilogram", "kilograms"].includes(normalized)) return { canonicalValue: value, canonicalUnit: "kg" };
  if (["g", "gram", "grams"].includes(normalized)) return { canonicalValue: value / 1000, canonicalUnit: "kg" };
  if (["[lb_av]", "lb", "lbs", "pound", "pounds"].includes(normalized)) {
    return { canonicalValue: value * 0.45359237, canonicalUnit: "kg" };
  }

  if (["cm", "centimeter", "centimeters"].includes(normalized)) return { canonicalValue: value, canonicalUnit: "cm" };
  if (["m", "meter", "meters"].includes(normalized)) return { canonicalValue: value * 100, canonicalUnit: "cm" };
  if (["[in_i]", "in", "inch", "inches"].includes(normalized)) {
    return { canonicalValue: value * 2.54, canonicalUnit: "cm" };
  }

  if (["cel", "c", "degc", "°c"].includes(normalized)) return { canonicalValue: value, canonicalUnit: "Cel" };
  if (["[degf]", "f", "degf", "°f"].includes(normalized)) {
    return { canonicalValue: (value - 32) / 1.8, canonicalUnit: "Cel" };
  }

  if (["%", "mm[hg]", "/min", "{beats}/min"].includes(normalized)) {
    return { canonicalValue: value, canonicalUnit: code || unit };
  }

  return {};
}

function periodDisplay(period: { start?: string; end?: string }): string {
  if (period.start && period.end) return `${period.start} to ${period.end}`;
  return period.start || period.end || "Period recorded";
}

export function normalizeObservationValue(resource: FhirResource): NormalizedObservationValue {
  const quantity = resource.valueQuantity as
    | {
        value?: number;
        unit?: string;
        code?: string;
        system?: string;
        comparator?: string;
      }
    | undefined;

  if (quantity && typeof quantity.value === "number") {
    const { displayUnit, ucumCode } = normalizeQuantityUnit(quantity.unit, quantity.code);
    const prefix = quantity.comparator ? `${quantity.comparator} ` : "";
    const display = [prefix + quantity.value, displayUnit].filter(Boolean).join(" ");
    return {
      kind: "quantity",
      display,
      numericValue: quantity.value,
      displayUnit,
      ucumCode,
      sourceSystem: quantity.system,
      sourceCode: quantity.code,
      originalField: "valueQuantity",
      ...canonicalizeQuantity(quantity.value, quantity.unit, quantity.code)
    };
  }

  const codeableValue = firstCodingText(resource.valueCodeableConcept);
  if (codeableValue) {
    return {
      kind: "codeable-concept",
      display: codeableValue,
      originalField: "valueCodeableConcept"
    };
  }

  if (typeof resource.valueString === "string") {
    return { kind: "string", display: resource.valueString, originalField: "valueString" };
  }

  if (typeof resource.valueBoolean === "boolean") {
    return { kind: "boolean", display: String(resource.valueBoolean), originalField: "valueBoolean" };
  }

  if (typeof resource.valueInteger === "number") {
    return {
      kind: "integer",
      display: String(resource.valueInteger),
      numericValue: resource.valueInteger,
      originalField: "valueInteger"
    };
  }

  if (typeof resource.valueDateTime === "string") {
    return { kind: "datetime", display: resource.valueDateTime, originalField: "valueDateTime" };
  }

  const period = resource.valuePeriod as { start?: string; end?: string } | undefined;
  if (period?.start || period?.end) {
    return { kind: "period", display: periodDisplay(period), originalField: "valuePeriod" };
  }

  const absentReason = firstCodingText(resource.dataAbsentReason);
  if (absentReason) {
    return {
      kind: "absent",
      display: absentReason,
      dataAbsentReason: absentReason,
      originalField: "dataAbsentReason"
    };
  }

  return { kind: "unknown", display: "No value recorded" };
}

export function observationHasAbnormalInterpretation(resource: FhirResource): boolean {
  const interpretations = Array.isArray(resource.interpretation) ? resource.interpretation : [resource.interpretation];
  const codes = interpretations
    .flatMap((interpretation) => (interpretation as CodeableConceptLike | undefined)?.coding ?? [])
    .map((coding) => coding.code?.toUpperCase())
    .filter(Boolean);
  return codes.some((code) => code !== "N" && code !== "NORMAL");
}
