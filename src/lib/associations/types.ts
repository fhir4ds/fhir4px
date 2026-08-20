export type AssociationBucket = "lab" | "vital" | "procedure" | "medication" | "vaccine" | "condition" | "treats";

export type MemberProvenance = "direct_indication" | "preventive_indication" | "disease_context";

export interface AssociationMember {
  cid: string;
  name: string;
  /** v1.5+: how the association was sourced. Untagged members are ATC
   *  classes and guideline-sourced pairs. */
  provenance?: MemberProvenance;
}

export interface AssociationConcept {
  name: string;
  buckets: Partial<Record<AssociationBucket, AssociationMember[]>>;
}

export interface AssociationBundle {
  format: string;
  version: string;
  by_cid: Record<string, string>;
  by_name: Record<string, string>;
  concepts: Record<string, AssociationConcept>;
}

/** VAL-LAB-LOINC-{test code} → part CIDs (VAL-LAB-LOINC-LP…). */
export type LabPartCrosswalk = Record<string, string[]>;

/** VAL-COND-ICD10CM-{code} → VAL-COND-SNOMED-{code}. */
export type Icd10Crosswalk = Record<string, string>;
