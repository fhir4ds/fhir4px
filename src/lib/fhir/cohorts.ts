/**
 * Static cohort definitions — authored as CQL (the declarative surface),
 * translated to SQL by the fhir4ds CQL translator (Pyodide-hosted wheel),
 * executed verbatim on the engine's DuckDB-WASM over the `resources`
 * table. No hand-written SQL anywhere in this module.
 *
 * Note: these are authored CQL population definitions in the same style
 * as the CMS measure libraries; the translate + execute pipeline is 100%
 * fhir4ds. Valuesets are inlined as CODE literals (the in-browser path
 * has no terminology server at translate time).
 */

export interface CohortDefinition {
  id: string;
  title: string;
  description: string;
  category: "endocrinology" | "nephrology" | "cardiovascular";
  cql: string;
}

export const COHORT_DEFINITIONS: readonly CohortDefinition[] = [
  {
    id: "t2dm-on-metformin",
    title: "Type 2 diabetes on metformin",
    description: "Active T2DM condition and a metformin medication request",
    category: "endocrinology",
    cql: `
library T2dmOnMetformin

using FHIR version '4.0.1'

context Patient

define T2DMConditions:
  [Condition] C
    where exists (C.code.coding coding
      where coding.system = 'http://snomed.info/sct'
        and coding.code in { '44054006', '73211009' })

define MetforminRequests:
  [MedicationRequest] M
    where exists (M.medication.coding coding
      where coding.code in { '860975', '860976', '860977' })

define InInitialPopulation:
  exists T2DMConditions and exists MetforminRequests`
  },
  {
    id: "uncontrolled-t2dm-a1c",
    title: "Uncontrolled diabetes (latest HbA1c ≥ 8.0%)",
    description: "T2DM condition with any HbA1c at or above 8.0%",
    category: "endocrinology",
    cql: `
library UncontrolledT2dmA1c

using FHIR version '4.0.1'

context Patient

define T2DMConditions:
  [Condition] C
    where exists (C.code.coding coding
      where coding.system = 'http://snomed.info/sct'
        and coding.code in { '44054006', '73211009' })

define ElevatedA1cObservations:
  [Observation] O
    where exists (O.code.coding coding
      where coding.system = 'http://loinc.org' and coding.code = '4548-4')
      and (O.value as Quantity).value >= 8.0

define InInitialPopulation:
  exists T2DMConditions
    and exists ElevatedA1cObservations`
  },
  {
    id: "ckd-stage3-egfr",
    title: "CKD stage 3+ (eGFR < 60)",
    description: "Any eGFR below 60 mL/min/1.73m2",
    category: "nephrology",
    cql: `
library CkdStage3Egfr

using FHIR version '4.0.1'

context Patient

define LowEgfrObservations:
  [Observation] O
    where exists (O.code.coding coding
      where coding.system = 'http://loinc.org'
        and coding.code in { '2160-0', '98979-8', '62238-1', '50044-7', '70969-1' })
      and (O.value as Quantity).value < 60

define InInitialPopulation:
  exists LowEgfrObservations`
  },
  {
    id: "htn-on-raas",
    title: "Hypertension on ACE inhibitor or ARB",
    description: "Hypertension condition with a RAAS-agent medication request",
    category: "cardiovascular",
    cql: `
library HtnOnRaas

using FHIR version '4.0.1'

context Patient

define HtnConditions:
  [Condition] C
    where exists (C.code.coding coding
      where (coding.system = 'http://snomed.info/sct' and coding.code in { '59621000', '38341003' })
         or (coding.system = 'http://hl7.org/fhir/sid/icd-10-cm' and coding.code = 'I10'))

define RaasRequests:
  [MedicationRequest] M
    where exists (M.medication.coding coding
      where coding.code in { '310798', '310799', '310800', '310802', '314076', '197884', '197885', '197896', '197897', '197898', '197899', '310129', '830975' })

define InInitialPopulation:
  exists HtnConditions and exists RaasRequests`
  },
  {
    id: "statin-with-ldl",
    title: "Statin users with recent LDL",
    description: "Statin medication request and a recorded LDL cholesterol value",
    category: "cardiovascular",
    cql: `
library StatinWithLdl

using FHIR version '4.0.1'

context Patient

define StatinRequests:
  [MedicationRequest] M
    where exists (M.medication.coding coding
      where coding.code in { '866246', '896579', '315050', '315051', '315053', '352267', '352268', '896680' })

define LdlObservations:
  [Observation] O
    where exists (O.code.coding coding
      where coding.system = 'http://loinc.org' and coding.code in { '13457-7', '2089-1' })

define InInitialPopulation:
  exists StatinRequests and exists LdlObservations`
  }
];
