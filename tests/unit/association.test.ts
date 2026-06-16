import { describe, expect, it } from "vitest";
import {
  extractJson,
  parseAssociations,
  mapAssociations,
  confidenceLabel,
  confidenceScore
} from "../../src/lib/llm/association/parse";
import type { ConditionAssociationChoice } from "../../src/lib/llm/association/types";

// ── JSON extraction ───────────────────────────────────────────────────────

describe("association extractJson", () => {
  it("parses plain JSON", () => {
    const result = extractJson('{"associations":[{"conditionName":"Diabetes Type 2","confidence":"high"}]}');
    expect((result as { associations: unknown[] }).associations).toHaveLength(1);
  });

  it("parses empty associations", () => {
    const result = extractJson('{"associations":[]}');
    expect((result as { associations: unknown[] }).associations).toHaveLength(0);
  });

  it("parses JSON with prose preamble", () => {
    const result = extractJson('Here is my answer:\n{"associations":[{"conditionName":"Diabetes Type 2","confidence":"high"}]}');
    expect((result as { associations: unknown[] }).associations).toHaveLength(1);
  });

  it("throws on empty string", () => {
    expect(() => extractJson("")).toThrow("Empty response");
  });

  it("throws on no JSON", () => {
    expect(() => extractJson("I cannot determine an association.")).toThrow("No valid JSON");
  });
});

// ── Confidence parsing ───────────────────────────────────────────────────

describe("confidenceLabel", () => {
  it.each([
    ["high", "high"],
    ["HIGH", "high"],
    ["medium", "medium"],
    ["low", "low"]
  ])("parses %s → %s", (input, expected) => {
    expect(confidenceLabel(input)).toBe(expected);
  });

  it("returns undefined for invalid values", () => {
    expect(confidenceLabel("very high")).toBeUndefined();
    expect(confidenceLabel(0.9)).toBeUndefined();
    expect(confidenceLabel(undefined)).toBeUndefined();
  });
});

describe("confidenceScore", () => {
  it.each([
    ["high", 0.9],
    ["medium", 0.6],
    ["low", 0.3],
    [undefined, 0]
  ])("maps %s → %s", (input, expected) => {
    expect(confidenceScore(input as never)).toBe(expected);
  });
});

// ── Association parsing ──────────────────────────────────────────────────

describe("parseAssociations", () => {
  it("parses a valid association", () => {
    const result = parseAssociations({
      associations: [{ conditionName: "Diabetes Type 2", confidence: "high" }]
    });
    expect(result).toEqual([{ conditionName: "Diabetes Type 2", confidence: "high" }]);
  });

  it("returns empty for empty associations array", () => {
    const result = parseAssociations({ associations: [] });
    expect(result).toEqual([]);
  });

  it("returns empty when associations is missing", () => {
    const result = parseAssociations({ foo: "bar" });
    expect(result).toEqual([]);
  });

  it("skips items with missing conditionName", () => {
    const result = parseAssociations({
      associations: [
        { confidence: "high" },
        { conditionName: "Diabetes Type 2", confidence: "high" }
      ]
    });
    expect(result).toHaveLength(1);
    expect(result[0].conditionName).toBe("Diabetes Type 2");
  });

  it("skips items with invalid confidence", () => {
    const result = parseAssociations({
      associations: [
        { conditionName: "X", confidence: "very high" },
        { conditionName: "Diabetes Type 2", confidence: "medium" }
      ]
    });
    expect(result).toHaveLength(1);
    expect(result[0].conditionName).toBe("Diabetes Type 2");
  });

  it("limits to 1 association (maxItems)", () => {
    const result = parseAssociations({
      associations: [
        { conditionName: "A", confidence: "high" },
        { conditionName: "B", confidence: "high" }
      ]
    });
    expect(result).toHaveLength(1);
  });
});

// ── Mapping to LabConditionAssociation ───────────────────────────────────

describe("mapAssociations", () => {
  const choices: ConditionAssociationChoice[] = [
    { conditionGroupId: "Condition:diabetes", name: "Diabetes Type 2" },
    { conditionGroupId: "Condition:htn", name: "High Blood Pressure" }
  ];

  it("maps valid association to LabConditionAssociation", () => {
    const result = mapAssociations(
      [{ conditionName: "Diabetes Type 2", confidence: "high" }],
      choices
    );
    expect(result).toEqual([{
      conditionGroupId: "Condition:diabetes",
      relationship: "monitoring_marker",
      confidence: 0.9,
      fallback: false
    }]);
  });

  it("filters out conditions not in choices", () => {
    const result = mapAssociations(
      [
        { conditionName: "Diabetes Type 2", confidence: "high" },
        { conditionName: "Unknown Condition", confidence: "high" }
      ],
      choices
    );
    expect(result).toHaveLength(1);
    expect(result[0].conditionGroupId).toBe("Condition:diabetes");
  });

  it("returns empty for empty input", () => {
    expect(mapAssociations([], choices)).toEqual([]);
  });

  it("returns empty for empty choices", () => {
    expect(mapAssociations(
      [{ conditionName: "Diabetes Type 2", confidence: "high" }],
      []
    )).toEqual([]);
  });

  it("maps medium confidence correctly", () => {
    const result = mapAssociations(
      [{ conditionName: "High Blood Pressure", confidence: "medium" }],
      choices
    );
    expect(result[0].confidence).toBe(0.6);
  });
});
