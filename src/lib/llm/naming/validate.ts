import type { GroupableRecord } from "../../fhir/patient-groups";
import type { NamingResult } from "./types";
import { observationBucketFromRecord, truncateText, canonicalName } from "./shared-helpers";

export { canonicalName, observationBucketFromRecord };

export function meaningfulTokens(value: string): string[] {
  const stopWords = new Set(["and", "or", "the", "with", "without", "tablet", "capsule", "solution", "suspension", "oral"]);
  return canonicalName(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !stopWords.has(token));
}

export function medicationNamingMatchesSource(record: GroupableRecord, naming: NamingResult): boolean {
  if (record.resourceType !== "MedicationRequest") return true;
  const nameTokens = new Set(meaningfulTokens(naming.patientFriendlyName));
  const ingredientTokens = (record.ingredients ?? []).flatMap(meaningfulTokens);
  if (ingredientTokens.length > 0) return ingredientTokens.some((token) => nameTokens.has(token));

  const sourceTokens = [
    ...meaningfulTokens(record.sourceLabel),
    ...(record.codeTexts ?? []).flatMap(meaningfulTokens),
    ...(record.codeCodings ?? []).flatMap((coding) => meaningfulTokens(coding.display ?? ""))
  ];
  if (sourceTokens.length === 0) return true;
  return sourceTokens.some((token) => nameTokens.has(token));
}

export function validatedNamingResult(record: GroupableRecord, naming: NamingResult): NamingResult {
  if (medicationNamingMatchesSource(record, naming)) return naming;
  return fallbackNamingForRecord(record);
}

export function fallbackNamingForRecord(record: GroupableRecord): NamingResult {
  return {
    id: record.id,
    patientFriendlyName: truncateText(record.sourceLabel, 80) || record.resourceType,
    observationBucket: record.resourceType === "Observation" ? observationBucketFromRecord(record) : undefined,
    confidence: 0.45,
    fallback: true
  };
}
