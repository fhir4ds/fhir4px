import { describe, expect, it } from "vitest";
import { TASK_CONFIDENCE_THRESHOLDS, embeddingResultIsReliable } from "../../src/lib/embeddings/classify";

describe("embedding confidence thresholds", () => {
  it("defines thresholds only for tasks with measurable confidence separation", () => {
    expect(Object.keys(TASK_CONFIDENCE_THRESHOLDS).sort()).toEqual([
      "allergy_type",
      "encounter_class",
      "encounter_type"
    ]);
    // observation_category intentionally absent: correct/incorrect confidence
    // distributions overlap (0.351 vs 0.345 on the chronic cohort), so a
    // threshold there discards correct predictions without filtering errors.
    expect(TASK_CONFIDENCE_THRESHOLDS.observation_category).toBeUndefined();
  });

  it("treats unthresholded tasks as always reliable", () => {
    expect(embeddingResultIsReliable("observation_category", 0.05)).toBe(true);
    expect(embeddingResultIsReliable("some_unknown_task", 0)).toBe(true);
  });

  it("enforces the boundary inclusively per task", () => {
    expect(embeddingResultIsReliable("encounter_type", 0.75)).toBe(true);
    expect(embeddingResultIsReliable("encounter_type", 0.749)).toBe(false);
    expect(embeddingResultIsReliable("encounter_class", 0.5)).toBe(true);
    expect(embeddingResultIsReliable("encounter_class", 0.42)).toBe(false);
    expect(embeddingResultIsReliable("allergy_type", 0.4)).toBe(true);
    expect(embeddingResultIsReliable("allergy_type", 0.33)).toBe(false);
  });
});
