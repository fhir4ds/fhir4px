import type { LabConditionAssociation, ConditionAssociationChoice, LabConditionConfidenceLabel } from "./types";
import { LAB_CONDITION_CONFIDENCE_LABELS } from "./types";

export function confidenceLabel(value: unknown): LabConditionConfidenceLabel | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase().trim();
  return (LAB_CONDITION_CONFIDENCE_LABELS as readonly string[]).includes(normalized)
    ? (normalized as LabConditionConfidenceLabel)
    : undefined;
}

export function confidenceScore(label: LabConditionConfidenceLabel | undefined): number {
  if (label === "high") return 0.9;
  if (label === "medium") return 0.6;
  if (label === "low") return 0.3;
  return 0;
}

export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Empty response from LLM");

  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to balanced-brace extraction
  }

  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (escape) { escape = false; continue; }
    if (char === "\\") { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (char === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          start = -1;
        }
      }
    }
  }

  throw new Error("No valid JSON object found in LLM response");
}

export interface ParsedAssociation {
  conditionName: string;
  confidence: LabConditionConfidenceLabel;
}

export function parseAssociations(value: unknown): ParsedAssociation[] {
  const parsed = value as { associations?: unknown[] } | undefined;
  const items = parsed?.associations;
  if (!Array.isArray(items)) return [];

  const results: ParsedAssociation[] = [];
  for (const item of items) {
    const entry = item as { conditionName?: unknown; confidence?: unknown } | undefined;
    const conditionName =
      typeof entry?.conditionName === "string" ? entry.conditionName.trim() : undefined;
    if (!conditionName) continue;
    const label = confidenceLabel(entry?.confidence);
    if (!label) continue;
    results.push({ conditionName, confidence: label });
  }
  return results.slice(0, 1);
}

export function mapAssociations(
  parsed: ParsedAssociation[],
  conditionChoices: ConditionAssociationChoice[]
): LabConditionAssociation[] {
  return parsed
    .filter((p) => conditionChoices.some((c) => c.name === p.conditionName))
    .map((p) => {
      const choice = conditionChoices.find((c) => c.name === p.conditionName)!;
      return {
        conditionGroupId: choice.conditionGroupId,
        relationship: "monitoring_marker" as const,
        confidence: confidenceScore(p.confidence),
        fallback: false
      };
    });
}
