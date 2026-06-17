import { describe, expect, it, vi } from "vitest";
import {
  extractJson,
  parseNamingResponse,
  parseNamingBatchResponse,
  parseObservationBucket
} from "../../src/lib/llm/naming/parse";
import {
  fallbackNamingForRecord,
  validatedNamingResult,
  medicationNamingMatchesSource,
  meaningfulTokens
} from "../../src/lib/llm/naming/validate";
import { incrementalNamingBatchSize, canonicalName, slug } from "../../src/lib/llm/naming/shared-helpers";
import type { GroupableRecord } from "../../src/lib/fhir/patient-groups";

function record(overrides: Partial<GroupableRecord> & Pick<GroupableRecord, "id" | "resourceType" | "sourceLabel">): GroupableRecord {
  return { source: "provider", ...overrides } as GroupableRecord;
}

// ── JSON extraction ───────────────────────────────────────────────────────

describe("extractJson", () => {
  it("parses a plain JSON object", () => {
    const result = extractJson('{"patientFriendlyName":"Hemoglobin A1c","confidence":0.9}');
    expect(result).toEqual({ patientFriendlyName: "Hemoglobin A1c", confidence: 0.9 });
  });

  it("parses JSON wrapped in markdown fences", () => {
    const result = extractJson('```json\n{"patientFriendlyName":"Glucose","confidence":0.85}\n```');
    expect(result).toEqual({ patientFriendlyName: "Glucose", confidence: 0.85 });
  });

  it("parses JSON after prose preamble", () => {
    const result = extractJson('Here is the name:\n{"patientFriendlyName":"Cholesterol","confidence":0.8}');
    expect(result).toEqual({ patientFriendlyName: "Cholesterol", confidence: 0.8 });
  });

  it("parses JSON with trailing prose", () => {
    const result = extractJson('{"patientFriendlyName":"Creatinine","confidence":0.7} that should be it');
    expect((result as { patientFriendlyName: string }).patientFriendlyName).toBe("Creatinine");
  });

  it("parses batch response with nested objects", () => {
    const result = extractJson('{"items":[{"id":"a","patientFriendlyName":"A"},{"id":"b","patientFriendlyName":"B"}]}');
    expect((result as { items: unknown[] }).items).toHaveLength(2);
  });

  it("throws on empty string", () => {
    expect(() => extractJson("")).toThrow("Empty response");
  });

  it("throws on no JSON object", () => {
    expect(() => extractJson("I cannot help with that.")).toThrow("No valid JSON");
  });

  it("throws on unbalanced braces", () => {
    expect(() => extractJson('{"patientFriendlyName":"x"')).toThrow("No valid JSON");
  });
});

// ── Single-record parsing ─────────────────────────────────────────────────

describe("parseNamingResponse", () => {
  it("maps all fields correctly", () => {
    const result = parseNamingResponse({
      patientFriendlyName: "Hemoglobin A1c",
      observationBucket: "labs",
      confidence: 0.95,
      fallback: false
    });
    expect(result).toEqual({
      patientFriendlyName: "Hemoglobin A1c",
      observationBucket: "labs",
      confidence: 0.95,
      fallback: false
    });
  });

  it("defaults confidence to 0.5 when missing", () => {
    const result = parseNamingResponse({ patientFriendlyName: "X" });
    expect(result.confidence).toBe(0.5);
  });

  it("defaults fallback to false when missing", () => {
    const result = parseNamingResponse({ patientFriendlyName: "X" });
    expect(result.fallback).toBe(false);
  });

  it("clamps confidence > 1 to 1", () => {
    const result = parseNamingResponse({ patientFriendlyName: "X", confidence: 1.5 });
    expect(result.confidence).toBe(1);
  });

  it("clamps confidence < 0 to 0", () => {
    const result = parseNamingResponse({ patientFriendlyName: "X", confidence: -0.5 });
    expect(result.confidence).toBe(0);
  });

  it("truncates patientFriendlyName > 80 chars", () => {
    const longName = "A".repeat(100);
    const result = parseNamingResponse({ patientFriendlyName: longName });
    expect(result.patientFriendlyName).toHaveLength(80);
  });

  it("throws on missing patientFriendlyName", () => {
    expect(() => parseNamingResponse({ confidence: 0.9 })).toThrow("without patientFriendlyName");
  });

  it("throws on empty patientFriendlyName", () => {
    expect(() => parseNamingResponse({ patientFriendlyName: "  " })).toThrow("without patientFriendlyName");
  });
});

describe("parseObservationBucket", () => {
  it.each([
    ["lab", "labs"],
    ["labs", "labs"],
    ["laboratory", "labs"],
    ["LAB", "labs"],
    ["vital", "vitals"],
    ["vitals", "vitals"],
    ["vital-signs", "vitals"],
    ["Vital Signs", "vitals"],
    ["other", "other"]
  ])("normalizes %s → %s", (input, expected) => {
    expect(parseObservationBucket(input)).toBe(expected);
  });

  it("returns undefined for unrecognized values", () => {
    expect(parseObservationBucket("banana")).toBeUndefined();
  });

  it("returns undefined for non-string", () => {
    expect(parseObservationBucket(42)).toBeUndefined();
  });
});

// ── Batch parsing ─────────────────────────────────────────────────────────

describe("parseNamingBatchResponse", () => {
  const records = [
    record({ id: "a", resourceType: "Observation", sourceLabel: "HbA1c" }),
    record({ id: "b", resourceType: "Observation", sourceLabel: "Glucose" })
  ];

  it("parses items array", () => {
    const result = parseNamingBatchResponse({
      items: [
        { id: "a", patientFriendlyName: "Hemoglobin A1c", confidence: 0.9, fallback: false },
        { id: "b", patientFriendlyName: "Glucose", confidence: 0.85, fallback: false }
      ]
    }, records);
    expect(result).toHaveLength(2);
    expect(result[0].patientFriendlyName).toBe("Hemoglobin A1c");
    expect(result[1].patientFriendlyName).toBe("Glucose");
  });

  it("parses results key instead of items", () => {
    const result = parseNamingBatchResponse({
      results: [
        { id: "a", patientFriendlyName: "HbA1c", confidence: 0.9, fallback: false },
        { id: "b", patientFriendlyName: "Blood Sugar", confidence: 0.8, fallback: false }
      ]
    }, records);
    expect(result).toHaveLength(2);
  });

  it("handles raw array", () => {
    const result = parseNamingBatchResponse([
      { id: "a", patientFriendlyName: "HbA1c", confidence: 0.9 },
      { id: "b", patientFriendlyName: "Glucose", confidence: 0.85 }
    ], records);
    expect(result).toHaveLength(2);
  });

  it("handles single record without envelope", () => {
    const singleRecord = [record({ id: "x", resourceType: "Condition", sourceLabel: "Diabetes" })];
    const result = parseNamingBatchResponse({
      id: "x", patientFriendlyName: "Type 2 Diabetes", confidence: 0.9, fallback: false
    }, singleRecord);
    expect(result).toHaveLength(1);
    expect(result[0].patientFriendlyName).toBe("Type 2 Diabetes");
  });

  it("throws when input ids are missing", () => {
    expect(() => parseNamingBatchResponse({
      items: [{ id: "a", patientFriendlyName: "HbA1c", confidence: 0.9 }]
    }, records)).toThrow("missed input ids");
  });

  it("reorders results to match input records", () => {
    const result = parseNamingBatchResponse({
      items: [
        { id: "b", patientFriendlyName: "Glucose", confidence: 0.85 },
        { id: "a", patientFriendlyName: "HbA1c", confidence: 0.9 }
      ]
    }, records);
    expect(result[0].id).toBe("a");
    expect(result[1].id).toBe("b");
  });

  it("ignores unknown ids", () => {
    const result = parseNamingBatchResponse({
      items: [
        { id: "a", patientFriendlyName: "HbA1c", confidence: 0.9 },
        { id: "b", patientFriendlyName: "Glucose", confidence: 0.85 },
        { id: "unknown", patientFriendlyName: "Mystery", confidence: 0.5 }
      ]
    }, records);
    expect(result).toHaveLength(2);
  });

  it("first duplicate id wins", () => {
    const result = parseNamingBatchResponse({
      items: [
        { id: "a", patientFriendlyName: "First", confidence: 0.9 },
        { id: "a", patientFriendlyName: "Second", confidence: 0.8 },
        { id: "b", patientFriendlyName: "Glucose", confidence: 0.85 }
      ]
    }, records);
    expect(result[0].patientFriendlyName).toBe("First");
  });
});

// ── Validation ────────────────────────────────────────────────────────────

describe("meaningfulTokens", () => {
  it("extracts tokens >= 4 chars, excluding stop words", () => {
    const tokens = meaningfulTokens("Metformin 500 MG Oral Tablet");
    expect(tokens).toContain("metformin");
    expect(tokens).not.toContain("oral");
    expect(tokens).not.toContain("500");
  });
});

describe("medicationNamingMatchesSource", () => {
  it("returns true for non-MedicationRequest records", () => {
    const rec = record({ id: "obs-1", resourceType: "Observation", sourceLabel: "Glucose" });
    const naming = { id: "obs-1", patientFriendlyName: "Blood Sugar", confidence: 0.9, fallback: false };
    expect(medicationNamingMatchesSource(rec, naming)).toBe(true);
  });

  it("returns true when ingredient tokens match", () => {
    const rec = record({
      id: "med-1", resourceType: "MedicationRequest", sourceLabel: "Metformin",
      ingredients: ["metformin"]
    });
    const naming = { id: "med-1", patientFriendlyName: "Metformin", confidence: 0.9, fallback: false };
    expect(medicationNamingMatchesSource(rec, naming)).toBe(true);
  });

  it("returns false when no ingredient or source tokens match", () => {
    const rec = record({
      id: "med-1", resourceType: "MedicationRequest", sourceLabel: "Metformin",
      ingredients: ["metformin"]
    });
    const naming = { id: "med-1", patientFriendlyName: "Aspirin", confidence: 0.9, fallback: false };
    expect(medicationNamingMatchesSource(rec, naming)).toBe(false);
  });
});

describe("fallbackNamingForRecord", () => {
  it("uses sourceLabel as the name", () => {
    const rec = record({ id: "x", resourceType: "Condition", sourceLabel: "Diabetes" });
    const result = fallbackNamingForRecord(rec);
    expect(result.patientFriendlyName).toBe("Diabetes");
    expect(result.confidence).toBe(0.45);
    expect(result.fallback).toBe(true);
  });

  it("includes observationBucket for Observation records", () => {
    const rec = record({
      id: "x", resourceType: "Observation", sourceLabel: "Some Lab",
      observationBucket: "labs"
    });
    const result = fallbackNamingForRecord(rec);
    expect(result.observationBucket).toBe("labs");
  });

  it("does not include observationBucket for non-Observation records", () => {
    const rec = record({ id: "x", resourceType: "Condition", sourceLabel: "Flu" });
    const result = fallbackNamingForRecord(rec);
    expect(result.observationBucket).toBeUndefined();
  });
});

describe("validatedNamingResult", () => {
  it("passes through valid naming", () => {
    const rec = record({ id: "x", resourceType: "Condition", sourceLabel: "Diabetes" });
    const naming = { id: "x", patientFriendlyName: "Type 2 Diabetes", confidence: 0.9, fallback: false };
    const result = validatedNamingResult(rec, naming);
    expect(result).toEqual(naming);
  });

  it("falls back when medication name doesn't match source", () => {
    const rec = record({
      id: "x", resourceType: "MedicationRequest", sourceLabel: "Metformin",
      ingredients: ["metformin"]
    });
    const naming = { id: "x", patientFriendlyName: "Aspirin", confidence: 0.9, fallback: false };
    const result = validatedNamingResult(rec, naming);
    expect(result.fallback).toBe(true);
    expect(result.patientFriendlyName).toBe("Metformin");
  });
});

// ── Batch size ────────────────────────────────────────────────────────────

describe("incrementalNamingBatchSize", () => {
  it("defaults to 3", () => {
    expect(incrementalNamingBatchSize({})).toBe(3);
  });

  it("returns 1 for single mode", () => {
    expect(incrementalNamingBatchSize({ namingMode: "single" })).toBe(1);
  });

  it("clamps to max 8", () => {
    expect(incrementalNamingBatchSize({ namingBatchSize: 100 })).toBe(8);
  });

  it("clamps to min 1", () => {
    expect(incrementalNamingBatchSize({ namingBatchSize: 0 })).toBe(1);
  });

  it("clamps negative to 1", () => {
    expect(incrementalNamingBatchSize({ namingBatchSize: -5 })).toBe(1);
  });
});

// ── Canonical name / slug ─────────────────────────────────────────────────

describe("canonicalName", () => {
  it("lowercases and normalizes whitespace/punctuation", () => {
    expect(canonicalName("Hemoglobin A1c/Hemoglobin.Total")).toBe("hemoglobin a1c hemoglobin total");
  });
});

describe("slug", () => {
  it("creates a kebab-case slug", () => {
    expect(slug("Hemoglobin A1c")).toBe("hemoglobin-a1c");
  });

  it("truncates to 60 chars", () => {
    const long = "A".repeat(100);
    expect(slug(long)).toHaveLength(60);
  });
});
