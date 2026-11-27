/**
 * Care gaps computed from the loaded dataset alone.
 *
 * The Records page normally computes them and publishes them; it is only
 * mounted after its first visit, though, so a reload straight onto the
 * Quality area has none. This path gives that case the same gaps from the
 * session's resources, without the Records page. Dismissals belong to the
 * Records page, so nothing here is filtered by them.
 */

import { loadAnalyticResources } from "./analytic-resources";
import { assembleCareGaps, type CareGap } from "./care-gaps";
import { runImmunizationForecast } from "./immunization-forecast";
import { runQualityEvaluation } from "./quality-run";

let cachedRun: Promise<CareGap[]> | null = null;

/** Forget the computed gaps — call when the dataset changes. */
export function invalidateCareGaps(): void {
  cachedRun = null;
}

/** Run (or return the cached) care gaps for the loaded dataset. */
export function runCareGaps(): Promise<CareGap[]> {
  if (!cachedRun) {
    cachedRun = computeCareGaps().catch((caught: unknown) => {
      cachedRun = null;
      throw caught;
    });
  }
  return cachedRun;
}

async function computeCareGaps(): Promise<CareGap[]> {
  const resources = await loadAnalyticResources();
  const ofType = (resourceType: string) => resources.filter((resource) => resource.resourceType === resourceType);
  const patient = ofType("Patient")[0];
  // The forecast is the CDC schedule's half; a patient is needed for it.
  const forecast = patient
    ? await runImmunizationForecast(patient, ofType("Immunization"), ofType("Condition"), ofType("AllergyIntolerance"))
    : [];
  const evaluation = await runQualityEvaluation();
  return assembleCareGaps(forecast, evaluation.measures);
}
