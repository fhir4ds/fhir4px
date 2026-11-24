/**
 * Cohort execution — authored CQL translated by the fhir4ds CQL
 * translator and executed on the engine. Cohort pages consume this.
 */

import { engineQuery, engineLoadResources, type EngineQueryResult } from "../engine/engine-client";
import { translateCqlToSql } from "../engine/viewdef";
import { boolAt } from "../engine/result-values";
import type { FhirResource } from "../smart/data";
import { COHORT_DEFINITIONS, type CohortDefinition } from "./cohorts";

export { COHORT_DEFINITIONS };
export type { CohortDefinition };

/** The define every cohort library uses for membership. */
export const COHORT_MEMBERSHIP_DEFINE = "InInitialPopulation";

export interface CohortResult {
  definition: CohortDefinition;
  columns: string[];
  /** Member rows only — patients whose InInitialPopulation is true. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[][];
  error?: string;
  executionMs: number;
  /** Generated SQL (the fhir4ds translator output) for the SQL viewer. */
  sql?: string;
}

/**
 * Translate + execute one cohort definition over the loaded resources.
 * The resources must already be loaded into the engine (loadResources).
 *
 * Population SQL yields one row per loaded patient with a boolean per
 * define, so a row existing says nothing about membership: the cohort's
 * members are the rows whose InInitialPopulation is true.
 */
export async function executeCohort(definition: CohortDefinition): Promise<CohortResult> {
  const started = performance.now();
  try {
    const sql = await translateCqlToSql(definition.cql);
    const result = (await engineQuery(sql)) as EngineQueryResult;
    if (!result.columns.includes(COHORT_MEMBERSHIP_DEFINE)) {
      throw new Error(
        `Cohort "${definition.title}" defines no "${COHORT_MEMBERSHIP_DEFINE}" — cannot determine membership`
      );
    }
    const memberRows = result.rows.filter(
      (row) => boolAt(row, result.columns, COHORT_MEMBERSHIP_DEFINE) === true
    );
    return {
      definition,
      columns: result.columns,
      rows: memberRows,
      sql,
      executionMs: Math.round(performance.now() - started)
    };
  } catch (error) {
    return {
      definition,
      columns: [],
      rows: [],
      error: error instanceof Error ? error.message : String(error),
      executionMs: Math.round(performance.now() - started)
    };
  }
}

export async function executeAllCohorts(resources: FhirResource[]): Promise<CohortResult[]> {
  await engineLoadResources(resources);
  const results: CohortResult[] = [];
  for (const definition of COHORT_DEFINITIONS) {
    results.push(await executeCohort(definition));
  }
  return results;
}
