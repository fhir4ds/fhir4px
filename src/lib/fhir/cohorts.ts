/**
 * Static cohort definitions — curated identification criteria evaluated as
 * SQL over the engine's resources table (id, resourceType, resource JSON,
 * patient_ref). Starter set is drug-study-shaped; a builder UI can later
 * author definitions against the same execution path.
 *
 * Conventions: every query returns one row per matching patient with a
 * `patient_id` column plus evidence columns for the results table.
 */

export interface CohortDefinition {
  id: string;
  title: string;
  description: string;
  category: "endocrinology" | "nephrology" | "cardiovascular";
  sql: string;
}

const T2DM_SNOMED = ("44054006,73211009" as const).toString();

export const COHORT_DEFINITIONS: readonly CohortDefinition[] = [
  {
    id: "t2dm-on-metformin",
    title: "Type 2 diabetes on metformin",
    description: "Active T2DM condition and a metformin medication request — classic oral-agent study base population",
    category: "endocrinology",
    sql: `
      WITH t2dm AS (
        SELECT DISTINCT r.patient_ref
        FROM resources r, json_each(r.resource, '$.code.coding') c
        WHERE r.resourceType = 'Condition' AND r.patient_ref IS NOT NULL
          AND json_extract_string(c.value, '$.system') = 'http://snomed.info/sct'
          AND json_extract_string(c.value, '$.code') IN (${T2DM_SNOMED.split(",").map((c) => `'${c}'`).join(",")})
      ),
      metformin AS (
        SELECT DISTINCT patient_ref,
               COUNT(*) AS metformin_requests
        FROM resources
        WHERE resourceType = 'MedicationRequest' AND patient_ref IS NOT NULL
          AND contains(lower(resource::VARCHAR), 'metformin')
        GROUP BY 1
      )
      SELECT t.patient_ref AS patient_id, m.metformin_requests
      FROM t2dm t JOIN metformin m ON m.patient_ref = t.patient_ref`
  },
  {
    id: "uncontrolled-t2dm-a1c",
    title: "Uncontrolled diabetes (HbA1c ≥ 8.0%)",
    description: "T2DM condition with most recent HbA1c at or above 8.0% — intensification-study population",
    category: "endocrinology",
    sql: `
      WITH t2dm AS (
        SELECT DISTINCT r.patient_ref
        FROM resources r, json_each(r.resource, '$.code.coding') c
        WHERE r.resourceType = 'Condition' AND r.patient_ref IS NOT NULL
          AND json_extract_string(c.value, '$.system') = 'http://snomed.info/sct'
          AND json_extract_string(c.value, '$.code') IN ('44054006', '73211009')
      ),
      latest_a1c AS (
        SELECT patient_ref,
               CAST(json_extract_string(resource, '$.valueQuantity.value') AS DOUBLE) AS a1c,
               coalesce(json_extract_string(resource, '$.effectiveDateTime'),
                        json_extract_string(resource, '$.issued')) AS measured_at,
               ROW_NUMBER() OVER (PARTITION BY patient_ref
                                  ORDER BY coalesce(json_extract_string(resource, '$.effectiveDateTime'),
                                                    json_extract_string(resource, '$.issued')) DESC) AS rn
        FROM resources
        WHERE resourceType = 'Observation' AND patient_ref IS NOT NULL
          AND json_extract_string(resource, '$.code.coding[0].system') = 'http://loinc.org'
          AND json_extract_string(resource, '$.code.coding[0].code') = '4548-4'
          AND json_extract_string(resource, '$.valueQuantity.value') IS NOT NULL
      )
      SELECT t.patient_ref AS patient_id, a.a1c, a.measured_at
      FROM t2dm t JOIN latest_a1c a ON a.patient_ref = t.patient_ref
      WHERE a.rn = 1 AND a.a1c >= 8.0`
  },
  {
    id: "ckd-stage3-egfr",
    title: "CKD stage 3+ (eGFR < 60)",
    description: "Most recent eGFR below 60 mL/min/1.73m2 — renal-outcome study population",
    category: "nephrology",
    sql: `
      WITH latest_egfr AS (
        SELECT patient_ref,
               CAST(json_extract_string(resource, '$.valueQuantity.value') AS DOUBLE) AS egfr,
               coalesce(json_extract_string(resource, '$.effectiveDateTime'),
                        json_extract_string(resource, '$.issued')) AS measured_at,
               ROW_NUMBER() OVER (PARTITION BY patient_ref
                                  ORDER BY coalesce(json_extract_string(resource, '$.effectiveDateTime'),
                                                    json_extract_string(resource, '$.issued')) DESC) AS rn
        FROM resources
        WHERE resourceType = 'Observation' AND patient_ref IS NOT NULL
          AND json_extract_string(resource, '$.code.coding[0].system') = 'http://loinc.org'
          AND json_extract_string(resource, '$.code.coding[0].code') IN ('2160-0', '98979-8', '62238-1', '50044-7', '70969-1')
          AND json_extract_string(resource, '$.valueQuantity.value') IS NOT NULL
      )
      SELECT patient_ref AS patient_id, egfr, measured_at
      FROM latest_egfr
      WHERE rn = 1 AND egfr < 60`
  },
  {
    id: "htn-on-raas",
    title: "Hypertension on ACE inhibitor or ARB",
    description: "Hypertension condition with an active RAAS-agent medication request",
    category: "cardiovascular",
    sql: `
      WITH htn AS (
        SELECT DISTINCT r.patient_ref
        FROM resources r, json_each(r.resource, '$.code.coding') c
        WHERE r.resourceType = 'Condition' AND r.patient_ref IS NOT NULL
          AND (
            (json_extract_string(c.value, '$.system') = 'http://snomed.info/sct'
             AND json_extract_string(c.value, '$.code') IN ('59621000', '38341003'))
            OR (json_extract_string(c.value, '$.system') = 'http://hl7.org/fhir/sid/icd-10-cm'
                AND json_extract_string(c.value, '$.code') = 'I10')
          )
      ),
      raas AS (
        SELECT DISTINCT patient_ref
        FROM resources
        WHERE resourceType = 'MedicationRequest' AND patient_ref IS NOT NULL
          AND regexp_matches(lower(resource::VARCHAR),
              'lisinopril|enalapril|ramipril|benazepril|quinapril|captopril|perindopril|losartan|valsartan|olmesartan|irbesartan|candesartan|telmisartan')
      )
      SELECT t.patient_ref AS patient_id
      FROM htn t JOIN raas r ON r.patient_ref = t.patient_ref`
  },
  {
    id: "statin-with-ldl",
    title: "Statin users with recent LDL",
    description: "Statin medication request and a recorded LDL cholesterol value — lipid-lowering study base",
    category: "cardiovascular",
    sql: `
      WITH statin AS (
        SELECT DISTINCT patient_ref
        FROM resources
        WHERE resourceType = 'MedicationRequest' AND patient_ref IS NOT NULL
          AND regexp_matches(lower(resource::VARCHAR),
              'atorvastatin|rosuvastatin|simvastatin|pravastatin|lovastatin|fluvastatin|pitavastatin')
      ),
      latest_ldl AS (
        SELECT patient_ref,
               CAST(json_extract_string(resource, '$.valueQuantity.value') AS DOUBLE) AS ldl,
               coalesce(json_extract_string(resource, '$.effectiveDateTime'),
                        json_extract_string(resource, '$.issued')) AS measured_at,
               ROW_NUMBER() OVER (PARTITION BY patient_ref
                                  ORDER BY coalesce(json_extract_string(resource, '$.effectiveDateTime'),
                                                    json_extract_string(resource, '$.issued')) DESC) AS rn
        FROM resources
        WHERE resourceType = 'Observation' AND patient_ref IS NOT NULL
          AND json_extract_string(resource, '$.code.coding[0].system') = 'http://loinc.org'
          AND json_extract_string(resource, '$.code.coding[0].code') IN ('13457-7', '2089-1')
          AND json_extract_string(resource, '$.valueQuantity.value') IS NOT NULL
      )
      SELECT s.patient_ref AS patient_id, l.ldl, l.measured_at
      FROM statin s JOIN latest_ldl l ON l.patient_ref = s.patient_ref
      WHERE l.rn = 1`
  }
];
