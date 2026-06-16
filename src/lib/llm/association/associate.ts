import type { LabConditionAssociation, ConditionAssociationChoice, LabGroupContext } from "./types";
import { LAB_CONDITION_TEMPERATURE } from "./types";
import { labConditionSystemPrompt, labConditionUserPrompt } from "./prompt";
import { extractJson, parseAssociations, mapAssociations } from "./parse";
import { generate } from "../transformers-llm";

export async function associateLabGroupWithConditions(
  labGroup: LabGroupContext,
  conditionChoices: ConditionAssociationChoice[],
  options?: {
    explicitRelatedContext?: string[];
    onProgress?: (message: string) => void;
  }
): Promise<LabConditionAssociation[]> {
  if (conditionChoices.length === 0) return [];

  options?.onProgress?.(`Associating ${labGroup.patientFriendlyName}...`);

  const { content } = await generate({
    systemPrompt: labConditionSystemPrompt(),
    userPayload: labConditionUserPrompt({
      labGroup,
      conditionChoices,
      explicitRelatedContext: options?.explicitRelatedContext
    }),
    maxTokens: 180,
    temperature: LAB_CONDITION_TEMPERATURE
  });

  const parsed = extractJson(content);
  const associations = parseAssociations(parsed);
  return mapAssociations(associations, conditionChoices);
}
