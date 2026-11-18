/**
 * Dataset-scoped quality evaluation cache: US Core conformance checks + CMS
 * quality measures, computed once per loaded dataset and shared by the
 * Records summary (care-gap band) and the Quality page. Invalidated when the
 * dataset changes (see invalidateQualityEvaluation).
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

export interface QualityEvaluation {
  resourceCount: number;
  checks: UsCoreCheckResult[];
  measures: MeasureResult[];
}

export { qualityDatasetVersion };

async function executeQualityEvaluation(): Promise<QualityEvaluation> {
  const resources = await loadSessionResources();
  await engineLoadResources(resources);
  const checks = await runUsCoreChecks(resources);
  const measures = await runQualityMeasures();
  return { resourceCount: resources.length, checks, measures };
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
