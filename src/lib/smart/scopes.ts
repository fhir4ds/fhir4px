export const BASE_SMART_SCOPES = ["launch/patient", "openid", "fhirUser"].join(" ");

export const REFERRAL_SUMMARY_SCOPES = [
  "launch/patient",
  "openid",
  "fhirUser",
  "patient/Patient.read",
  "patient/MedicationRequest.read",
  "patient/AllergyIntolerance.read",
  "patient/Condition.read",
  "patient/Observation.read"
].join(" ");

export const EPIC_SANDBOX_SCOPES = [
  "openid",
  "fhirUser",
  "patient/Patient.read",
  "patient/Observation.read",
  "patient/Condition.read",
  "patient/MedicationRequest.read",
  "patient/Encounter.read",
  "patient/Procedure.read"
].join(" ");

export const CERNER_SANDBOX_SCOPES = [
  "launch/patient",
  "openid",
  "fhirUser",
  "patient/Patient.read",
  "patient/Observation.read",
  "patient/Condition.read",
  "patient/MedicationRequest.read",
  "patient/Encounter.read",
  "patient/Procedure.read"
].join(" ");

export const EXPANDED_CLINICAL_SCOPES = [
  "launch/patient",
  "openid",
  "fhirUser",
  "patient/Patient.read",
  "patient/MedicationRequest.read",
  "patient/Medication.read",
  "patient/MedicationStatement.read",
  "patient/AllergyIntolerance.read",
  "patient/Condition.read",
  "patient/Observation.read",
  "patient/DiagnosticReport.read",
  "patient/DocumentReference.read",
  "patient/Encounter.read",
  "patient/Procedure.read",
  "patient/Immunization.read"
].join(" ");

export const MVP_RESOURCE_TYPES = [
  "Patient",
  "MedicationRequest",
  "AllergyIntolerance",
  "Condition",
  "Observation",
  "DiagnosticReport",
  "DocumentReference",
  "Encounter",
  "Procedure",
  "Immunization"
] as const;

export type MvpResourceType = (typeof MVP_RESOURCE_TYPES)[number];

export function scopeAllowsResourceRead(
  scope: string | undefined,
  resourceType: string,
  options: { allowWhenUnknown?: boolean } = {}
): boolean {
  if (resourceType === "Patient") return true;

  const allowWhenUnknown = options.allowWhenUnknown ?? true;
  if (!scope?.trim()) return allowWhenUnknown;

  const scopes = scope.split(/\s+/).filter(Boolean);
  return scopes.some(
    (item) =>
      item === `patient/${resourceType}.read` ||
      item === `user/${resourceType}.read` ||
      item === `patient/*.read` ||
      item === `user/*.read` ||
      item === "*/*.read"
  );
}

export function filterResourceTypesForScope<T extends string>(
  resourceTypes: readonly T[],
  scope: string | undefined,
  options: { allowWhenUnknown?: boolean } = {}
): T[] {
  return resourceTypes.filter((resourceType) => scopeAllowsResourceRead(scope, resourceType, options));
}
