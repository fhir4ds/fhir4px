import promptsData from "../prompts.json";
import type { ConditionAssociationChoice, LabGroupContext, ExplicitRelatedContext } from "./types";

const PROMPTS = promptsData as {
  version: string;
  tasks: Record<string, { system_prompt: string; output_shape: string }>;
};

export function labConditionSystemPrompt(): string {
  return PROMPTS.tasks.lab_condition_association.system_prompt;
}

export function labConditionUserPrompt(params: {
  labGroup: LabGroupContext;
  conditionChoices: ConditionAssociationChoice[];
  explicitRelatedContext?: string[];
}): string {
  return JSON.stringify({
    outputShape: PROMPTS.tasks.lab_condition_association.output_shape,
    measurement: {
      groupId: params.labGroup.groupId,
      name: params.labGroup.patientFriendlyName
    },
    referenceContext: params.explicitRelatedContext ?? [],
    conditionChoices: params.conditionChoices
  });
}

export function labConditionSchemaText(conditionChoices: ConditionAssociationChoice[] = []): string {
  const conditionChoiceNames = conditionChoices
    .map((c) => c.name.trim())
    .filter((n) => n.length > 0)
    .slice(0, 30);

  return JSON.stringify({
    type: "object",
    required: ["associations"],
    properties: {
      associations: {
        type: "array",
        items: {
          type: "object",
          required: ["conditionName", "confidence"],
          properties: {
            conditionName: { type: "string" },
            confidence: { type: "string" }
          }
        }
      }
    }
  });
}
