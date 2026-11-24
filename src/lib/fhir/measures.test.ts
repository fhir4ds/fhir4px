import { describe, expect, it } from "vitest";
import {
  evaluateMeasureGaps,
  evaluateMeasures,
  measureStatus,
  type MeasureEvaluation,
  type MeasureResult
} from "./measures";

const COLUMNS = ["patient_id", "Initial Population", "Denominator", "Denominator Exclusions", "Numerator"];

function measure(overrides: Partial<MeasureResult>): MeasureResult {
  return {
    id: "CMS124",
    title: "Cervical Cancer Screening",
    columns: COLUMNS,
    rows: [["patient-1", true, true, false, false]],
    executionMs: 10,
    ...overrides
  };
}

describe("evaluateMeasureGaps", () => {
  it("flags denominator-not-excluded-without-numerator as negative", () => {
    const [result] = evaluateMeasureGaps([measure({ rows: [["p1", true, true, false, false]] })]);
    expect(result.negative).toBe(true);
  });

  it("treats numerator membership as not negative for proportion measures", () => {
    const [result] = evaluateMeasureGaps([measure({ rows: [["p1", true, true, false, true]] })]);
    expect(result.negative).toBe(false);
  });

  it("treats denominator exclusion as not negative", () => {
    const [result] = evaluateMeasureGaps([measure({ rows: [["p1", true, true, true, false]] })]);
    expect(result.negative).toBe(false);
  });

  it("treats outside-denominator as not negative", () => {
    const [result] = evaluateMeasureGaps([measure({ rows: [["p1", true, false, false, false]] })]);
    expect(result.negative).toBe(false);
  });

  it("never flags errored or empty measures", () => {
    const results = evaluateMeasureGaps([
      measure({ error: "SQL unavailable (404)", rows: [] }),
      measure({ rows: [] })
    ]);
    expect(results.every((result) => !result.negative)).toBe(true);
  });

  it("handles string booleans from the engine", () => {
    const [result] = evaluateMeasureGaps([measure({ rows: [["p1", "true", "true", "false", "false"]] })]);
    expect(result.negative).toBe(true);
  });
});

describe("evaluateMeasures", () => {
  it("exposes the full population pathway for evidence display", () => {
    const [evaluation] = evaluateMeasures([
      measure({ rows: [["p1", true, true, false, false]] })
    ]);
    expect(evaluation).toMatchObject({
      initialPopulation: true,
      denominator: true,
      excluded: false,
      numerator: false,
      negative: true
    });
  });

  it("evaluates errored measures to all-false without a gap", () => {
    const [evaluation] = evaluateMeasures([measure({ error: "boom", rows: [] })]);
    expect(evaluation).toMatchObject({
      initialPopulation: false,
      denominator: false,
      negative: false
    });
  });

  it("inverse measures flag numerator membership as the gap", () => {
    const [evaluation] = evaluateMeasures([
      measure({ polarity: "inverse", rows: [["p1", true, true, false, true]] })
    ]);
    expect(evaluation.negative).toBe(true);
    const [controlled] = evaluateMeasures([
      measure({ polarity: "inverse", rows: [["p1", true, true, false, false]] })
    ]);
    expect(controlled.negative).toBe(false);
  });
});

describe("measureStatus", () => {
  // A patient who is in the initial population.
  const inPopulation = (overrides: Partial<MeasureEvaluation>): MeasureEvaluation => ({
    id: "CMS124",
    title: "Cervical Cancer Screening",
    initialPopulation: true,
    denominator: true,
    excluded: false,
    numerator: false,
    negative: true,
    polarity: "proportion",
    ...overrides
  });

  it("calls a negative measure a care gap", () => {
    expect(measureStatus(inPopulation({}))).toBe("care-gap");
  });

  it("calls a documented numerator met", () => {
    expect(measureStatus(inPopulation({ numerator: true, negative: false }))).toBe("met");
  });

  it("reports an exclusion inside the denominator as excluded, not met", () => {
    expect(measureStatus(inPopulation({ excluded: true, negative: false }))).toBe("excluded");
  });

  it("does not call a measure met for a patient outside the denominator", () => {
    expect(measureStatus(inPopulation({ denominator: false, negative: false }))).toBe("not-in-denominator");
  });
});
