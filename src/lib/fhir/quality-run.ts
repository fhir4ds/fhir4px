/**
 * Dataset-scoped evaluation cache: US Core conformance checks, CMS quality
 * measures and the authored cohorts, computed once per loaded dataset and
 * shared by the Records summary (care-gap band), the Quality page and the
 * Cohorts page. Invalidated when the dataset changes (see
 * invalidateQualityEvaluation).
 */

import { engineLoadResources } from "../engine/engine-client";
import { loadSessionResources } from "../engine/session-data";
import { runUsCoreChecks, type UsCoreCheckResult } from "./uscore-checks";
import {
  invalidateQualityMeasures,
  qualityDatasetVersion,
  runQualityMeasures,
  type MeasureResult
} from "./measures";
import { COHORT_DEFINITIONS, executeCohort, type CohortResult } from "./cohorts-runner";
import { patientName } from "../smart/sources";

export interface QualityEvaluation {
  resourceCount: number;
  /** Name on the loaded Patient resource, when there is one. */
  patientName: string | null;
  checks: UsCoreCheckResult[];
  measures: MeasureResult[];
  /** Authored cohort definitions, executed after the measures. */
  cohorts: CohortResult[];
}

export { qualityDatasetVersion };

async function executeQualityEvaluation(): Promise<QualityEvaluation> {
  const resources = await loadSessionResources();
  await engineLoadResources(resources);
  const checks = await runUsCoreChecks(resources);
  const measures = await runQualityMeasures();
  // The resources are staged already; each cohort only translates and queries.
  const cohorts: CohortResult[] = [];
  for (const definition of COHORT_DEFINITIONS) {
    cohorts.push(await executeCohort(definition));
  }
  const patient = resources.find((resource) => resource.resourceType === "Patient") ?? null;
  return {
    resourceCount: resources.length,
    patientName: patient ? patientName(patient) ?? null : null,
    checks,
    measures,
    cohorts
  };
}

let cachedRun: Promise<QualityEvaluation> | null = null;

export function invalidateQualityEvaluation(): void {
  cachedRun = null;
  invalidateQualityMeasures();
}

/** Run (or return the cached) full quality evaluation for the loaded dataset. */
export function runQualityEvaluation(): Promise<QualityEvaluation> {
  if (!cachedRun) {
    cachedRun = executeQualityEvaluation().catch((caught) => {
      cachedRun = null;
      throw caught;
    });
  }
  return cachedRun;
}
