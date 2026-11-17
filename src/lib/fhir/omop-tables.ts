/**
 * OMOP CDM v5.5 table extraction — SQL over the engine's resources table,
 * joined to a flattened concept map (loaded as the `conceptmap` table).
 *
 * Shapes follow the fhir4ds OMOP ViewDefinition library
 * (fhir4ds/viewdef/resources/omop): surrogate ids from
 * hash(source_value) & max-bigint, concept_id from the conceptmap join
 * with 0 fallback (OMOP "No matching concept"), source values preserved.
 */

import { engineQuery, type EngineQueryResult } from "../engine/engine-client";

export interface OmopTable {
  name: string;
  description: string;
  sql: string;
}

const CONCEPT_JOIN = `
  LEFT JOIN conceptmap cm
         ON json_extract_string(r.resource, '$.code.coding[0].code') = cm.concept_code
        AND json_extract_string(r.resource, '$.code.coding[0].system') = cm.source_system`;

export const OMOP_TABLES: readonly OmopTable[] = [
  {
    name: "person",
    description: "One row per patient",
    sql: `
      SELECT
        CAST(hash(json_extract_string(r.resource, '$.id')) & 9223372036854775807 AS BIGINT) AS person_id,
        COALESCE(TRY_CAST(cm.concept_id AS BIGINT), 0) AS gender_concept_id,
        TRY_CAST(substr(json_extract_string(r.resource, '$.birthDate'), 1, 4) AS INT) AS year_of_birth,
        TRY_CAST(substr(json_extract_string(r.resource, '$.birthDate'), 6, 2) AS INT) AS month_of_birth,
        TRY_CAST(substr(json_extract_string(r.resource, '$.birthDate'), 9, 2) AS INT) AS day_of_birth,
        json_extract_string(r.resource, '$.id') AS person_source_value,
        json_extract_string(r.resource, '$.gender') AS gender_source_value
      FROM resources r
      LEFT JOIN conceptmap cm
             ON json_extract_string(r.resource, '$.gender') = cm.concept_code
            AND cm.source_system = 'http://hl7.org/fhir/administrative-gender'
      WHERE r.resourceType = 'Patient'`
  },
  {
    name: "condition_occurrence",
    description: "Conditions with concept mapping",
    sql: `
      SELECT
        CAST(hash(r.patient_ref || ':' || r.id) & 9223372036854775807 AS BIGINT) AS condition_occurrence_id,
        CAST(hash(r.patient_ref) & 9223372036854775807 AS BIGINT) AS person_id,
        COALESCE(TRY_CAST(cm.concept_id AS BIGINT), 0) AS condition_concept_id,
        TRY_CAST(coalesce(json_extract_string(r.resource, '$.onsetDateTime'),
                          json_extract_string(r.resource, '$.recordedDate')) AS TIMESTAMP) AS condition_start_date,
        json_extract_string(r.resource, '$.code.coding[0].code') AS condition_source_value,
        json_extract_string(r.resource, '$.code.coding[0].system') AS condition_source_concept_system
      FROM resources r ${CONCEPT_JOIN}
      WHERE r.resourceType = 'Condition' AND r.patient_ref IS NOT NULL`
  },
  {
    name: "drug_exposure",
    description: "Medication requests and immunizations",
    sql: `
      SELECT
        CAST(hash(r.patient_ref || ':' || r.id) & 9223372036854775807 AS BIGINT) AS drug_exposure_id,
        CAST(hash(r.patient_ref) & 9223372036854775807 AS BIGINT) AS person_id,
        COALESCE(TRY_CAST(cm.concept_id AS BIGINT), 0) AS drug_concept_id,
        TRY_CAST(coalesce(json_extract_string(r.resource, '$.occurrenceDateTime'),
                          json_extract_string(r.resource, '$.authoredOn')) AS TIMESTAMP) AS drug_exposure_start_date,
        json_extract_string(r.resource, '$.medicationCodeableConcept.coding[0].code') AS drug_source_value_med,
        json_extract_string(r.resource, '$.vaccineCode.coding[0].code') AS drug_source_value_vax,
        r.resourceType AS source_resource_type
      FROM resources r
      LEFT JOIN conceptmap cm
             ON coalesce(json_extract_string(r.resource, '$.medicationCodeableConcept.coding[0].code'),
                         json_extract_string(r.resource, '$.vaccineCode.coding[0].code')) = cm.concept_code
            AND coalesce(json_extract_string(r.resource, '$.medicationCodeableConcept.coding[0].system'),
                         json_extract_string(r.resource, '$.vaccineCode.coding[0].system')) = cm.source_system
      WHERE r.resourceType IN ('MedicationRequest', 'Immunization') AND r.patient_ref IS NOT NULL`
  },
  {
    name: "observation",
    description: "Observations (survey + non-measurement)",
    sql: `
      SELECT
        CAST(hash(r.patient_ref || ':' || r.id) & 9223372036854775807 AS BIGINT) AS observation_id,
        CAST(hash(r.patient_ref) & 9223372036854775807 AS BIGINT) AS person_id,
        COALESCE(TRY_CAST(cm.concept_id AS BIGINT), 0) AS observation_concept_id,
        TRY_CAST(coalesce(json_extract_string(r.resource, '$.effectiveDateTime'),
                          json_extract_string(r.resource, '$.issued')) AS TIMESTAMP) AS observation_date,
        CAST(json_extract_string(r.resource, '$.valueQuantity.value') AS DOUBLE) AS value_as_number,
        json_extract_string(r.resource, '$.valueQuantity.unit') AS unit_concept_value,
        json_extract_string(r.resource, '$.code.coding[0].code') AS observation_source_value
      FROM resources r ${CONCEPT_JOIN}
      WHERE r.resourceType = 'Observation' AND r.patient_ref IS NOT NULL
        AND json_extract_string(r.resource, '$.valueQuantity.value') IS NULL`
  },
  {
    name: "measurement",
    description: "Quantitative observations (labs, vitals)",
    sql: `
      SELECT
        CAST(hash(r.patient_ref || ':' || r.id) & 9223372036854775807 AS BIGINT) AS measurement_id,
        CAST(hash(r.patient_ref) & 9223372036854775807 AS BIGINT) AS person_id,
        COALESCE(TRY_CAST(cm.concept_id AS BIGINT), 0) AS measurement_concept_id,
        TRY_CAST(coalesce(json_extract_string(r.resource, '$.effectiveDateTime'),
                          json_extract_string(r.resource, '$.issued')) AS TIMESTAMP) AS measurement_date,
        CAST(json_extract_string(r.resource, '$.valueQuantity.value') AS DOUBLE) AS value_as_number,
        json_extract_string(r.resource, '$.valueQuantity.unit') AS unit_source_value,
        json_extract_string(r.resource, '$.code.coding[0].code') AS measurement_source_value
      FROM resources r ${CONCEPT_JOIN}
      WHERE r.resourceType = 'Observation' AND r.patient_ref IS NOT NULL
        AND json_extract_string(r.resource, '$.valueQuantity.value') IS NOT NULL`
  },
  {
    name: "procedure_occurrence",
    description: "Procedures",
    sql: `
      SELECT
        CAST(hash(r.patient_ref || ':' || r.id) & 9223372036854775807 AS BIGINT) AS procedure_occurrence_id,
        CAST(hash(r.patient_ref) & 9223372036854775807 AS BIGINT) AS person_id,
        COALESCE(TRY_CAST(cm.concept_id AS BIGINT), 0) AS procedure_concept_id,
        TRY_CAST(json_extract_string(r.resource, '$.performedDateTime') AS TIMESTAMP) AS procedure_date,
        json_extract_string(r.resource, '$.code.coding[0].code') AS procedure_source_value
      FROM resources r ${CONCEPT_JOIN}
      WHERE r.resourceType = 'Procedure' AND r.patient_ref IS NOT NULL`
  },
  {
    name: "visit_occurrence",
    description: "Encounters",
    sql: `
      SELECT
        CAST(hash(r.patient_ref || ':' || r.id) & 9223372036854775807 AS BIGINT) AS visit_occurrence_id,
        CAST(hash(r.patient_ref) & 9223372036854775807 AS BIGINT) AS person_id,
        0 AS visit_concept_id,
        TRY_CAST(json_extract_string(r.resource, '$.period.start') AS TIMESTAMP) AS visit_start_date,
        TRY_CAST(json_extract_string(r.resource, '$.period.end') AS TIMESTAMP) AS visit_end_date,
        json_extract_string(r.resource, '$.class.code') AS visit_source_value
      FROM resources r
      WHERE r.resourceType = 'Encounter' AND r.patient_ref IS NOT NULL`
  }
];

export interface OmopExportResult {
  table: OmopTable;
  result: EngineQueryResult;
  error?: string;
}

/**
 * Materialize the conceptmap table in the engine from resolved mappings,
 * then extract every OMOP table.
 */
export async function runOmopExport(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loadResources: (resources: any[]) => Promise<unknown>,
  conceptMappings: Map<string, string>
): Promise<OmopExportResult[]> {
  // Flatten the map into a resource the engine can ingest.
  const conceptRows: Array<{ source_system: string; concept_code: string; concept_id: string }> = [];
  for (const [key, conceptId] of conceptMappings) {
    const separator = key.indexOf("|");
    conceptRows.push({ source_system: key.slice(0, separator), concept_code: key.slice(separator + 1), concept_id: conceptId });
  }
  await engineQuery("CREATE OR REPLACE TABLE conceptmap (source_system VARCHAR, concept_code VARCHAR, concept_id VARCHAR)");
  if (conceptRows.length > 0) {
    // The engine RPC has no bind parameters; build VALUES rows instead.
    const values = conceptRows
      .map((row) => `('${row.source_system.replace(/'/g, "''")}', '${row.concept_code.replace(/'/g, "''")}', '${row.concept_id.replace(/'/g, "''")}')`)
      .join(", ");
    await engineQuery(`INSERT INTO conceptmap VALUES ${values}`);
  }

  const results: OmopExportResult[] = [];
  for (const table of OMOP_TABLES) {
    try {
      results.push({ table, result: await engineQuery(table.sql) });
    } catch (error) {
      results.push({ table, result: { columns: [], rows: [] }, error: error instanceof Error ? error.message : String(error) });
    }
  }
  void loadResources;
  return results;
}

/** CSV serialization of an engine result. */
export function omopResultToCsv(result: EngineQueryResult): string {
  const escapeCell = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [result.columns.join(",")];
  for (const row of result.rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  return lines.join("\n");
}
