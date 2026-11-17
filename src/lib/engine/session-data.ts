/**
 * Shared loader that pulls the current session's FHIR dataset for engine
 * consumption (Quality checks, Cohort runs). Reads the active SMART session
 * from the vault and fetches the full analytic resource set.
 */

import { DEFAULT_FHIR_PAGE_LIMIT, fetchPatientDataset, type FhirResource } from "../smart/data";
import type { MvpResourceType } from "../smart/scopes";
import type { SmartSessionInfo, SmartToken } from "../smart/types";
import { getOrCreateSessionVaultKey } from "../vault/keys";
import { localVault } from "../vault/store";

export const ANALYTIC_RESOURCE_TYPES: readonly MvpResourceType[] = [
  "Patient",
  "MedicationRequest",
  "AllergyIntolerance",
  "Condition",
  "Observation",
  "Immunization",
  "Procedure",
  "Encounter",
  "DiagnosticReport",
  "DocumentReference"
];

export async function loadSessionResources(): Promise<FhirResource[]> {
  const key = await getOrCreateSessionVaultKey();
  const token = await localVault.getJson<SmartToken>(key, { type: "smart-token", id: "current" });
  const session = await localVault.getJson<SmartSessionInfo>(key, { type: "smart-session", id: "current" });
  if (!token || !session) {
    throw new Error("No local SMART connection is available — connect a source first");
  }
  const dataset = await fetchPatientDataset(session, token, {
    resourceTypes: ANALYTIC_RESOURCE_TYPES,
    maxPages: DEFAULT_FHIR_PAGE_LIMIT
  });
  return dataset.resources;
}
