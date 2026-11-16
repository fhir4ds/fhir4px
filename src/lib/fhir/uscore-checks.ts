/**
 * US Core data-presence conformance checks — SQL evaluated against the
 * engine's resources table (id, resourceType, resource JSON, patient_ref).
 *
 * Profile *enforcement* is intentionally OFF (decision 2026-11-16): these
 * checks report whether required elements are present and populated, not
 * full profile validation. Each check returns one row per patient with the
 * number of resources of the type and how many satisfy the element
 * requirement.
 */

export interface UsCoreCheck {
  id: string;
  title: string;
  description: string;
  resourceType: string;
  /** SQL returning (patient_id, total, conforming) rows. */
  sql: string;
}

const REQUIRED_ELEMENT_CHECKS: Array<{
  id: string;
  title: string;
  description: string;
  resourceType: string;
  element: string;
}> = [
  { id: "patient-identity", title: "Patient identity", description: "name, gender, and birthDate present", resourceType: "Patient", element: "name, gender, birthDate" },
  { id: "condition-status", title: "Condition status", description: "clinicalStatus and verificationStatus present", resourceType: "Condition", element: "clinicalStatus, verificationStatus" },
  { id: "medication-request-core", title: "MedicationRequest core", description: "status, intent, medication, and authoredOn present", resourceType: "MedicationRequest", element: "status, intent, medication[x], authoredOn" },
  { id: "allergy-core", title: "Allergy core", description: "clinicalStatus and code present", resourceType: "AllergyIntolerance", element: "clinicalStatus, code" },
  { id: "immunization-core", title: "Immunization core", description: "status, vaccineCode, and occurrence present", resourceType: "Immunization", element: "status, vaccineCode, occurrence[x]" },
  { id: "procedure-core", title: "Procedure core", description: "status, code, and subject present", resourceType: "Procedure", element: "status, code, subject" },
  { id: "document-core", title: "DocumentReference core", description: "status, type, and content present", resourceType: "DocumentReference", element: "status, type, content" }
];

export const US_CORE_CHECKS: readonly UsCoreCheck[] = [
  {
    id: "patient-identity",
    title: "Patient identity",
    description: "name, gender, and birthDate present",
    resourceType: "Patient",
    sql: `
      SELECT id AS patient_id,
             COUNT(*) OVER () AS total,
             COUNT(*) FILTER (WHERE json_type(resource, '$.name') IS NOT NULL
                              AND json_type(resource, '$.gender') IS NOT NULL
                              AND json_type(resource, '$.birthDate') IS NOT NULL) OVER () AS conforming
      FROM resources
      WHERE resourceType = 'Patient'`
  },
  ...REQUIRED_ELEMENT_CHECKS.filter((check) => check.id !== "patient-identity").map((check) => ({
    ...check,
    sql: `
      SELECT patient_ref AS patient_id,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE ${requiredElementsPredicate(check.element, check.resourceType)}) AS conforming
      FROM resources
      WHERE resourceType = '${check.resourceType}' AND patient_ref IS NOT NULL
      GROUP BY 1`
  })),
  {
    id: "observation-coded",
    title: "Observations coded",
    description: "code with at least one system+code coding present (labs, vitals, results)",
    resourceType: "Observation",
    sql: `
      SELECT patient_ref AS patient_id,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE json_array_length(json_extract(resource, '$.code.coding')) > 0
                              AND json_extract_string(resource, '$.code.coding[0].system') IS NOT NULL
                              AND json_extract_string(resource, '$.code.coding[0].code') IS NOT NULL) AS conforming
      FROM resources
      WHERE resourceType = 'Observation' AND patient_ref IS NOT NULL
      GROUP BY 1`
  }
];

function requiredElementsPredicate(element: string, _resourceType: string): string {
  const parts = element.split(", ").map((raw) => raw.trim());
  const conditions = parts.map((part) => {
    if (part.endsWith("[x]")) {
      const base = part.slice(0, -3);
      // any[x]-style choice: any property starting with the base name
      return `(EXISTS (SELECT 1 FROM json_each(json_extract(resource, '$')) AS _props WHERE starts_with(_props.key, '${base}')))`;
    }
    return `json_type(resource, '$.${part}') IS NOT NULL`;
  });
  return conditions.join(" AND ");
}
