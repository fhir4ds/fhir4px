export type PatchTargetResource =
  | "MedicationRequest"
  | "MedicationStatement"
  | "AllergyIntolerance"
  | "Condition"
  | "Observation"
  | "Immunization"
  | "Encounter"
  | "Procedure"
  | "DiagnosticReport"
  | "DocumentReference";

export type PatientAuthoredResourceType = "MedicationRequest" | "Immunization" | "AllergyIntolerance" | "Condition";

export interface PatientAuthoredCoding {
  system: string;
  code: string;
  display?: string;
}

export interface PatientAuthoredCodeableConcept {
  text: string;
  coding?: PatientAuthoredCoding[];
}

export interface PatientAuthoredMedicationRequestResource {
  resourceType: "MedicationRequest";
  id?: string;
  status: "active" | "completed" | "stopped" | "on-hold" | "unknown";
  medicationCodeableConcept: PatientAuthoredCodeableConcept;
  authoredOn?: string;
  dosageInstruction?: Array<{ text: string }>;
}

export interface PatientAuthoredImmunizationResource {
  resourceType: "Immunization";
  id?: string;
  status: "completed" | "not-done";
  vaccineCode: PatientAuthoredCodeableConcept;
  occurrenceDateTime?: string;
}

export interface PatientAuthoredAllergyIntoleranceResource {
  resourceType: "AllergyIntolerance";
  id?: string;
  clinicalStatus: PatientAuthoredCodeableConcept;
  code: PatientAuthoredCodeableConcept;
  criticality?: "low" | "high" | "unable-to-assess";
  reaction?: Array<{ description: string }>;
  recordedDate?: string;
}

export type PatientAuthoredLocalResource =
  | PatientAuthoredMedicationRequestResource
  | PatientAuthoredImmunizationResource
  | PatientAuthoredAllergyIntoleranceResource;

export interface PatientPatch {
  id: string;
  targetResourceType: PatchTargetResource;
  targetResourceId: string;
  field: string;
  value: string;
  note?: string;
  authoredAt: string;
}

export interface PatientAuthoredRecord {
  id: string;
  resourceType: PatientAuthoredResourceType;
  resource?: PatientAuthoredLocalResource;
  /**
   * Legacy fields remain for existing local vault records created before
   * patient-authored records stored type-specific local resource payloads.
   */
  label: string;
  status?: string;
  note?: string;
  authoredAt: string;
}

export function createPatientPatch(input: Omit<PatientPatch, "id" | "authoredAt">): PatientPatch {
  return {
    ...input,
    id: crypto.randomUUID(),
    authoredAt: new Date().toISOString()
  };
}

export function createPatientAuthoredRecord(
  input: Omit<PatientAuthoredRecord, "id" | "authoredAt">
): PatientAuthoredRecord {
  const id = crypto.randomUUID();
  return {
    ...input,
    id,
    resource: input.resource ? { ...input.resource, id } : undefined,
    authoredAt: new Date().toISOString()
  };
}
