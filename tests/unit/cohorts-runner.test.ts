import { describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../../src/lib/engine/viewdef", () => ({
  translateCqlToSql: vi.fn(async () => "SELECT 1")
}));
vi.mock("../../src/lib/engine/engine-client", () => ({
  engineQuery: query,
  engineLoadResources: vi.fn(async () => undefined)
}));

import { executeCohort } from "../../src/lib/fhir/cohorts-runner";
import { COHORT_DEFINITIONS } from "../../src/lib/fhir/cohorts";

const DEFINITION = COHORT_DEFINITIONS[0];

describe("executeCohort", () => {
  it("returns only the patients whose InInitialPopulation is true", async () => {
    // Population SQL yields one row per loaded patient, each carrying a
    // boolean per define — a row existing is NOT a cohort match.
    query.mockResolvedValue({
      columns: ["patient_id", "T2DMConditions", "MetforminRequests", "InInitialPopulation"],
      rows: [
        ["p1", true, true, true],
        ["p2", true, false, false],
        ["p3", false, false, false]
      ]
    });

    const result = await executeCohort(DEFINITION);

    expect(result.error).toBeUndefined();
    expect(result.rows).toEqual([["p1", true, true, true]]);
  });

  it("reports no matches when every patient is outside the cohort", async () => {
    query.mockResolvedValue({
      columns: ["patient_id", "T2DMConditions", "MetforminRequests", "InInitialPopulation"],
      rows: [
        ["p1", true, false, false],
        ["p2", false, false, false]
      ]
    });

    const result = await executeCohort(DEFINITION);

    expect(result.error).toBeUndefined();
    expect(result.rows).toEqual([]);
  });

  it("fails loudly when the library defines no InInitialPopulation", async () => {
    query.mockResolvedValue({
      columns: ["patient_id", "T2DMConditions"],
      rows: [["p1", true]]
    });

    const result = await executeCohort(DEFINITION);

    expect(result.rows).toEqual([]);
    expect(result.error).toContain("InInitialPopulation");
  });
});
