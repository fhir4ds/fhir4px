import { describe, expect, it, beforeEach } from "vitest";
import {
  lookupDwForCode,
  lookupDwForCodingKeys,
  setGbdWeightTableForTest,
  type GbdWeightTable
} from "../../src/lib/priority/gbd-weights";

const TEST_TABLE: GbdWeightTable = {
  version: 1,
  source: "test",
  generatedAt: "2026-06-18T00:00:00Z",
  aggregation: "max",
  causeCount: 3,
  codeCount: 5,
  unmatchedSequelaeCount: 0,
  weights: {
    E11: 0.21,
    "E11.9": 0.25,
    "J45": 0.13,
    "J45.9": 0.14,
    "F32": 0.49
  }
};

beforeEach(() => {
  setGbdWeightTableForTest(TEST_TABLE);
});

describe("lookupDwForCode", () => {
  it("returns DW on direct hit", () => {
    expect(lookupDwForCode("E11", TEST_TABLE)).toBe(0.21);
    expect(lookupDwForCode("E11.9", TEST_TABLE)).toBe(0.25);
  });

  it("falls back to shorter subcode when full code is missing", () => {
    // J45.909 missing → J45.90 missing → J45.9 = 0.14
    expect(lookupDwForCode("J45.909", TEST_TABLE)).toBe(0.14);
    expect(lookupDwForCode("J45.90", TEST_TABLE)).toBe(0.14);
  });

  it("falls back to 3-char base when no subcode matches", () => {
    // F32.42 missing → F32.4 missing → F32 missing → F32 = 0.49
    expect(lookupDwForCode("F32.42", TEST_TABLE)).toBe(0.49);
  });

  it("returns 0 when no code in chain matches", () => {
    expect(lookupDwForCode("I10", TEST_TABLE)).toBe(0);
    expect(lookupDwForCode("Z99.0", TEST_TABLE)).toBe(0);
  });

  it("normalizes case and whitespace", () => {
    expect(lookupDwForCode("e11", TEST_TABLE)).toBe(0.21);
    expect(lookupDwForCode(" E11 ", TEST_TABLE)).toBe(0.21);
  });

  it("handles base code without subcode", () => {
    expect(lookupDwForCode("I10", TEST_TABLE)).toBe(0);
    expect(lookupDwForCode("E11", TEST_TABLE)).toBe(0.21);
  });
});

describe("lookupDwForCodingKeys", () => {
  it("extracts DW from icd10cm: prefix", () => {
    expect(lookupDwForCodingKeys(["icd10cm:E11.9"], TEST_TABLE)).toBe(0.25);
  });

  it("extracts DW from icd10: prefix", () => {
    expect(lookupDwForCodingKeys(["icd10:F32"], TEST_TABLE)).toBe(0.49);
  });

  it("returns first ICD-10 hit when multiple codes present", () => {
    expect(
      lookupDwForCodingKeys(["loinc:4548-4", "snomed:44054006", "icd10cm:E11"], TEST_TABLE)
    ).toBe(0.21);
  });

  it("returns 0 when no ICD-10 code present", () => {
    expect(
      lookupDwForCodingKeys(["loinc:4548-4", "snomed:44054006"], TEST_TABLE)
    ).toBe(0);
  });

  it("returns 0 for empty or undefined input", () => {
    expect(lookupDwForCodingKeys(undefined, TEST_TABLE)).toBe(0);
    expect(lookupDwForCodingKeys([], TEST_TABLE)).toBe(0);
  });

  it("skips malformed keys gracefully", () => {
    expect(lookupDwForCodingKeys(["", "icd10cm:", "icd10cm", "E11"], TEST_TABLE)).toBe(0);
  });

  it("falls back through subcode chain for specific codes", () => {
    // J45.909 in patient-friendly lookup → fallback to J45.9 → 0.14
    expect(lookupDwForCodingKeys(["icd10cm:J45.909"], TEST_TABLE)).toBe(0.14);
  });
});
