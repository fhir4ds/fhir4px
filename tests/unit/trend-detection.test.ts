import { describe, expect, it } from "vitest";
import { detectTrend } from "../../src/lib/fhir/trend-detection";
import type { NormalizedObservationValue } from "../../src/lib/fhir/observation-values";

function makeValue(numeric: number, unit = "mg/dL"): NormalizedObservationValue {
  return {
    kind: "quantity",
    display: `${numeric} ${unit}`,
    numericValue: numeric,
    displayUnit: unit,
    ucumCode: unit
  };
}

function makeSeries(values: number[], unit = "mg/dL") {
  return values.map((v, i) => ({
    normalizedValue: makeValue(v, unit),
    effectiveDate: `2026-01-${String(i + 1).padStart(2, "0")}`
  }));
}

describe("detectTrend", () => {
  it("returns none for empty values", () => {
    const result = detectTrend([]);
    expect(result.direction).toBe("none");
    expect(result.pointCount).toBe(0);
  });

  it("returns none for single value", () => {
    const result = detectTrend(makeSeries([5]));
    expect(result.direction).toBe("none");
    expect(result.pointCount).toBe(1);
    expect(result.latest).toBe(5);
  });

  it("returns none for two values (not enough for trend)", () => {
    const result = detectTrend(makeSeries([4, 7]));
    expect(result.direction).toBe("none");
    expect(result.pointCount).toBe(2);
    expect(result.latest).toBe(7);
    expect(result.previous).toBe(4);
    expect(result.percentChange).toBe(75);
  });

  it("detects upward trend with 3 points", () => {
    const result = detectTrend(makeSeries([4, 6, 7]));
    expect(result.direction).toBe("up");
    expect(result.pointCount).toBe(3);
    expect(result.latest).toBe(7);
    expect(result.percentChange).toBe(17);
  });

  it("detects downward trend with 3 points", () => {
    const result = detectTrend(makeSeries([10, 7, 5]));
    expect(result.direction).toBe("down");
    expect(result.pointCount).toBe(3);
    expect(result.latest).toBe(5);
    expect(result.percentChange).toBe(-29);
  });

  it("returns none for zigzag pattern", () => {
    const result = detectTrend(makeSeries([4, 3, 7]));
    expect(result.direction).toBe("none");
    expect(result.pointCount).toBe(3);
    expect(result.latest).toBe(7);
  });

  it("returns none for flat values", () => {
    const result = detectTrend(makeSeries([5, 5, 5]));
    expect(result.direction).toBe("none");
  });

  it("only looks at most recent trend direction", () => {
    // Old trend was down, last 3 are up
    const result = detectTrend(makeSeries([10, 8, 6, 7, 8, 9]));
    expect(result.direction).toBe("up");
  });

  it("handles 5+ points correctly", () => {
    const result = detectTrend(makeSeries([1, 2, 3, 4, 5]));
    expect(result.direction).toBe("up");
    expect(result.latest).toBe(5);
  });

  it("filters non-numeric values", () => {
    const values = [
      { normalizedValue: { kind: "string", display: "trace" }, effectiveDate: "2026-01-01" },
      { normalizedValue: makeValue(4), effectiveDate: "2026-01-02" },
      { normalizedValue: makeValue(6), effectiveDate: "2026-01-03" },
      { normalizedValue: makeValue(7), effectiveDate: "2026-01-04" }
    ];
    const result = detectTrend(values);
    expect(result.direction).toBe("up");
    expect(result.pointCount).toBe(3);
  });

  it("groups by unit and uses largest group", () => {
    const values = [
      { normalizedValue: makeValue(4, "mg/dL"), effectiveDate: "2026-01-01" },
      { normalizedValue: makeValue(6, "mg/dL"), effectiveDate: "2026-01-02" },
      { normalizedValue: makeValue(7, "mg/dL"), effectiveDate: "2026-01-03" },
      { normalizedValue: makeValue(3.5, "mmol/L"), effectiveDate: "2026-01-04" }
    ];
    const result = detectTrend(values);
    expect(result.direction).toBe("up");
    expect(result.pointCount).toBe(3);
    expect(result.unit).toBe("mg/dL");
  });

  it("handles negative values", () => {
    const result = detectTrend(makeSeries([-5, -3, -1]));
    expect(result.direction).toBe("up");
  });

  it("sorts by date before analyzing", () => {
    const values = [
      { normalizedValue: makeValue(7), effectiveDate: "2026-01-03" },
      { normalizedValue: makeValue(4), effectiveDate: "2026-01-01" },
      { normalizedValue: makeValue(6), effectiveDate: "2026-01-02" }
    ];
    const result = detectTrend(values);
    expect(result.direction).toBe("up");
    expect(result.latest).toBe(7);
  });
});
