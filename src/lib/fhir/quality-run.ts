/**
 * Dataset-scoped evaluation cache: US Core conformance checks, CMS quality
 * measures and the authored cohorts, computed once per loaded dataset and
 * shared by the Records summary (care-gap band), the Quality page and the
 * Cohorts page. Invalidated when the dataset changes (see
 * invalidateQualityEvaluation).
 */

import { engineLoadResources } from "../engine/engine-client";
import { loadAnalyticResources } from "./analytic-resources";
import { runUsCoreChecks, type UsCoreCheckResult } from "./uscore-checks";
import {
  invalidateQualityMeasures,
  qualityDatasetVersion,
  runQualityMeasures,
  type MeasureResult
} from "./measures";
import { COHORT_DEFINITIONS, executeCohort, type CohortResult } from "./cohorts-runner";
import { headerPatientFor, type PatientHeaderInfo } from "./patient-header";

export interface QualityEvaluation {
  resourceCount: number;
  /** The loaded patient, for the app header (null without a Patient resource). */
  patient: PatientHeaderInfo | null;
  checks: UsCoreCheckResult[];
  measures: MeasureResult[];
  /** Authored cohort definitions, executed after the measures. */
  cohorts: CohortResult[];
}

export { qualityDatasetVersion };

async function executeQualityEvaluation(): Promise<QualityEvaluation> {
  const resources = await loadAnalyticResources();
  await engineLoadResources(resources);
  const checks = await runUsCoreChecks(resources);
  const measures = await runQualityMeasures();
  // The resources are staged already; each cohort only translates and queries.
  const cohorts: CohortResult[] = [];
  for (const definition of COHORT_DEFINITIONS) {
    cohorts.push(await executeCohort(definition));
  }
  return {
    resourceCount: resources.length,
    patient: headerPatientFor(resources.filter((resource) => resource.resourceType === "Patient")),
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
