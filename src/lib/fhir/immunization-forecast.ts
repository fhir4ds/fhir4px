/**
 * CDC CDSi immunization forecasting via the cicada engine
 * (fhir-fli/cicada — Dart implementation of the CDC's Clinical Decision
 * Support for Immunization logic specification, validated against the CDC
 * test suite). The engine is pinned as a precompiled JS artifact under
 * /vendor/cicada/ and exposes globalThis.cicadaForecast(parametersJson).
 *
 * Input is a FHIR R4 Parameters resource (assessmentDate, patient,
 * immunization, condition, allergyIntolerance); output contains
 * ImmunizationEvaluation and ImmunizationRecommendation resources —
 * one recommendation per vaccine group with forecast status and
 * earliest/recommended/past-due date criteria.
 */

import type { FhirResource } from "../smart/data";

interface ForecastDateCriterion {
  code?: { coding?: Array<{ code?: string }> };
  value?: string;
}

interface ForecastRecommendation {
  vaccineCode?: Array<{ coding?: Array<{ code?: string; display?: string }> }>;
  forecastStatus?: { coding?: Array<{ code?: string; display?: string }> };
  forecastReason?: { coding?: Array<{ code?: string; display?: string }> };
  dateCriterion?: ForecastDateCriterion[];
  description?: string;
}

export interface ImmunizationForecastItem {
  vaccineCodes: string[];
  vaccineLabel: string;
  status: string;
  statusDisplay?: string;
  reason?: string;
  earliestDate?: string;
  recommendedDate?: string;
  pastDueDate?: string;
  description?: string;
}

const DATE_CRITERION_CODES: Record<string, keyof ImmunizationForecastItem> = {
  "30981-5": "earliestDate",
  "30980-7": "recommendedDate",
  "59778-1": "pastDueDate"
};

let scriptPromise: Promise<void> | null = null;

function loadEngine(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof (globalThis as { cicadaForecast?: unknown }).cicadaForecast === "function") {
      resolve();
      return;
    }
    const base = import.meta.env.BASE_URL || "/";
    const script = document.createElement("script");
    script.src = `${base.replace(/\/?$/, "/")}vendor/cicada/cicada.js`;
    script.onload = () => {
      if (typeof (globalThis as { cicadaForecast?: unknown }).cicadaForecast === "function") resolve();
      else reject(new Error("cicada engine loaded but cicadaForecast is not available"));
    };
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("cicada engine failed to load"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Build the $immds-forecast input Parameters from the local dataset. */
export function buildForecastParameters(
  patient: FhirResource | null,
  immunizations: FhirResource[],
  conditions: FhirResource[],
  allergies: FhirResource[],
  assessmentDate: string = new Date().toISOString().slice(0, 10)
): FhirResource {
  const parameter: Array<Record<string, unknown>> = [
    { name: "assessmentDate", valueDate: assessmentDate }
  ];
  if (patient) parameter.push({ name: "patient", resource: patient });
  for (const immunization of immunizations) parameter.push({ name: "immunization", resource: immunization });
  for (const condition of conditions) parameter.push({ name: "condition", resource: condition });
  for (const allergy of allergies) parameter.push({ name: "allergyIntolerance", resource: allergy });
  return { resourceType: "Parameters", parameter } as FhirResource;
}

/** Parse the engine's ImmunizationRecommendation resources into view items. */
export function parseForecastResult(resultJson: string): ImmunizationForecastItem[] {
  const parsed = JSON.parse(resultJson) as {
    error?: string;
    parameter?: Array<{ resource?: FhirResource }>;
  };
  if (parsed.error) throw new Error(parsed.error);
  const items: ImmunizationForecastItem[] = [];
  for (const entry of parsed.parameter ?? []) {
    const resource = entry.resource;
    if (resource?.resourceType !== "ImmunizationRecommendation") continue;
    for (const recommendation of (resource as { recommendation?: ForecastRecommendation[] }).recommendation ?? []) {
      const vaccineCodes = (recommendation.vaccineCode ?? [])
        .flatMap((concept) => concept.coding ?? [])
        .map((coding) => coding.code ?? "")
        .filter(Boolean);
      const item: ImmunizationForecastItem = {
        vaccineCodes,
        vaccineLabel:
          recommendation.vaccineCode?.[0]?.coding?.[0]?.display ??
          (vaccineCodes.length > 0 ? `CVX ${vaccineCodes.join(", ")}` : "Vaccine"),
        status: recommendation.forecastStatus?.coding?.[0]?.code ?? "unknown",
        statusDisplay: recommendation.forecastStatus?.coding?.[0]?.display,
        reason: recommendation.forecastReason?.coding?.[0]?.display,
        description: recommendation.description
      };
      for (const criterion of recommendation.dateCriterion ?? []) {
        const code = criterion.code?.coding?.[0]?.code;
        const target = code ? DATE_CRITERION_CODES[code] : undefined;
        if (target && criterion.value) {
          (item[target] as string) = criterion.value;
        }
      }
      items.push(item);
    }
  }
  return items;
}

/** Run the CDC CDSi forecast (engine loads once per session). */
export async function runImmunizationForecast(
  patient: FhirResource | null,
  immunizations: FhirResource[],
  conditions: FhirResource[],
  allergies: FhirResource[],
  options: { assessmentDate?: string } = {}
): Promise<ImmunizationForecastItem[]> {
  await loadEngine();
  const parameters = buildForecastParameters(patient, immunizations, conditions, allergies, options.assessmentDate);
  const forecast = (globalThis as unknown as { cicadaForecast: (input: string) => string }).cicadaForecast;
  return parseForecastResult(forecast(JSON.stringify(parameters)));
}
