export type AssociationBucket =
  | "lab"
  | "vital"
  | "procedure"
  | "medication"
  | "vaccine"
  | "condition"
  | "treats"
  // v1.4+ safety-signal buckets — OPPOSITE polarity to treats; never pooled
  | "adverse_effect"
  | "contraindicated_in"
  | "interferes_with_test";

export type MemberProvenance =
  | "direct_indication"
  | "event_prevention"
  | "preventive_indication"
  | "population_context"
  | "comorbidity_section"
  | "panel_cooccurrence"
  | "monitoring_recommendation"
  // v1.4+ safety-signal tiers
  | "boxed_warning"
  | "warning_section"
  | "contraindication_section"
  | "interference_section";

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
  /** v1.2+: inclusive patient-age bounds in years, snake_case on the wire
   *  like parent_cids. Both absent = unrestricted. Class-expansion
   *  ingredient CIDs inherit the class member's bounds, same rule as
   *  provenance tiers. */
  age_min?: number;
  age_max?: number;
  /** v2026-09-04.2055+ (C2 visibility): quantitative gate on the
   *  relationship — e.g. contraindicated_in when serum triglycerides > 500
   *  mg/dL, adverse_effect when absolute neutrophil count < 1000. Rendering
   *  aid only; matching semantics unchanged. */
  threshold?: MemberThreshold;
}

/** Lab gate carried by threshold-bearing members (1,210 on the wire). */
export interface MemberThreshold {
  lab_name: string;
  comparator: ">" | "<" | ">=" | "<=";
  value: number;
  unit: string;
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
  path: "direct" | "fanned" | "fanned_hub" | "ancestor";
  parent_cid?: string;
  child_cid?: string;
  /** Tier carried by the specific derivation path. */
  provenance?: MemberProvenance;
}

/** VAL-LAB-LOINC-{test code} → part CIDs (VAL-LAB-LOINC-LP…). */
export type LabPartCrosswalk = Record<string, string[]>;

/** VAL-COND-ICD10CM-{code} → VAL-COND-SNOMED-{code}. */
export type Icd10Crosswalk = Record<string, string>;
