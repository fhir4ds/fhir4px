export type AssociationBucket = "lab" | "vital" | "procedure" | "medication" | "vaccine" | "condition" | "treats";

export type MemberProvenance =
  | "direct_indication"
  | "event_prevention"
  | "population_context"
  | "comorbidity_section"
  | "monitoring_recommendation"
  | "panel_cooccurrence";

export interface AssociationMember {
  cid: string;
  name: string;
  /** v1.5+: how the association was sourced. Untagged members are
   *  class-expansion ingredient CIDs that inherit their drug-class member's
   *  tier, so they match whenever the class would. */
  provenance?: MemberProvenance;
  /** v1.1+ candidate: derivation paths (direct / fanned / fanned_hub).
   *  Optional per member; absent = single direct path. Not consumed by
   *  matching — reserved for richer attribution. */
  derivations?: AssociationMemberDerivation[];
}

export interface AssociationConcept {
  name: string;
  buckets: Partial<Record<AssociationBucket, AssociationMember[]>>;
  /** v2.3.1+: parent (hub) CIDs — condition hierarchy for click-time union.
   *  Consumers union parent MONITOR-type buckets only (lab/vital/procedure)
   *  per the IS_A default-deny allowlist; treats/medication stay on the hub. */
  parent_cids?: string[];
}

export interface AssociationBundle {
  format: string;
  version: string;
  by_cid: Record<string, string>;
  /** v1.1+: combo products → all ingredient concept keys. */
  by_cid_multi?: Record<string, string[]>;
  by_name: Record<string, string>;
  concepts: Record<string, AssociationConcept>;
}

export interface AssociationMemberDerivation {
  path: "direct" | "fanned" | "fanned_hub";
  parent_cid?: string;
  child_cid?: string;
}

/** VAL-LAB-LOINC-{test code} → part CIDs (VAL-LAB-LOINC-LP…). */
export type LabPartCrosswalk = Record<string, string[]>;

/** VAL-COND-ICD10CM-{code} → VAL-COND-SNOMED-{code}. */
export type Icd10Crosswalk = Record<string, string>;
