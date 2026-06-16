export interface LabConditionAssociation {
  conditionGroupId: string;
  relationship: "monitoring_marker" | "potentially_related";
  confidence: number;
  fallback: boolean;
}

export interface ConditionAssociationChoice {
  conditionGroupId: string;
  name: string;
}

export interface LabGroupContext {
  groupId: string;
  patientFriendlyName: string;
  resourceIds: string[];
  resourceTypes: string[];
}

export interface ExplicitRelatedContext {
  explicitRelatedContext: string[];
}

export type LabConditionConfidenceLabel = "high" | "medium" | "low";

export const LAB_CONDITION_CONFIDENCE_LABELS = ["high", "medium", "low"] as const;
export const LAB_CONDITION_TEMPERATURE = 0.3;
