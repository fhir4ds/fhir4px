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
  /** Every loaded patient: member or not, and which criteria were met. */
  patients: CohortPatient[];
  error?: string;
  executionMs: number;
  /** Generated SQL (the fhir4ds translator output) for the SQL viewer. */
  sql?: string;
}

export interface CohortCriterion {
  define: string;
  label: string;
  met: boolean;
  /** References of the records that satisfied the criterion. */
  references: string[];
}

/** One loaded patient's result for a cohort. */
export interface CohortPatient {
  patientId: string;
  member: boolean;
  criteria: CohortCriterion[];
}

/** A criterion is met when its list of matching records is not empty; a
 * boolean define counts as met when it is true. */
function criterionMet(cell: unknown): boolean {
  return Array.isArray(cell) ? cell.length > 0 : cell === true;
}

/**
 * Per-patient breakdown of a cohort's population rows. The SQL yields one
 * row per loaded patient: a list define comes back as the array of matching
 * record references (empty when nothing matched), membership as a boolean.
 */
export function cohortPatients(definition: CohortDefinition, columns: string[], rows: unknown[][]): CohortPatient[] {
  const patientIndex = columns.indexOf("patient_id");
  if (patientIndex < 0) {
    throw new Error(`Cohort "${definition.title}" result has no patient_id column`);
  }
  return rows.map((row) => ({
    patientId: String(row[patientIndex]),
    member: boolAt(row, columns, COHORT_MEMBERSHIP_DEFINE) === true,
    criteria: definition.criteria.map(({ define, label }) => {
      const cell = row[columns.indexOf(define)];
      return {
        define,
        label,
        met: criterionMet(cell),
        references: Array.isArray(cell) ? cell.map(String) : []
      };
    })
  }));
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
  const empty: CohortResult = {
    definition,
    columns: [],
    rows: [],
    patients: [],
    executionMs: 0
  };
  try {
    const sql = await translateCqlToSql(definition.cql);
    const result = (await engineQuery(sql)) as EngineQueryResult;
    const expected = [COHORT_MEMBERSHIP_DEFINE, ...definition.criteria.map((criterion) => criterion.define)];
    const missing = expected.filter((name) => !result.columns.includes(name));
    if (missing.length > 0) {
      throw new Error(
        `Cohort "${definition.title}" result is missing column(s): ${missing.join(", ")} — cannot determine membership`
      );
    }
    const memberRows = result.rows.filter(
      (row) => boolAt(row, result.columns, COHORT_MEMBERSHIP_DEFINE) === true
    );
    return {
      definition,
      columns: result.columns,
      rows: memberRows,
      patients: cohortPatients(definition, result.columns, result.rows),
      sql,
      executionMs: Math.round(performance.now() - started)
    };
  } catch (error) {
    return {
      ...empty,
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
