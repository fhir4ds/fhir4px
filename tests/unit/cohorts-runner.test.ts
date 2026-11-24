import { describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../../src/lib/engine/viewdef", () => ({
  translateCqlToSql: vi.fn(async () => "SELECT 1")
}));
vi.mock("../../src/lib/engine/engine-client", () => ({
  engineQuery: query,
  engineLoadResources: vi.fn(async () => undefined)
}));

import { cohortPatients, executeCohort } from "../../src/lib/fhir/cohorts-runner";
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

describe("executeCohort criterion columns", () => {
  it("fails loudly when a labeled criterion is missing from the result", async () => {
    query.mockResolvedValue({
      columns: ["patient_id", "T2DMConditions", "InInitialPopulation"],
      rows: [["p1", ["Condition/c1"], true]]
    });

    const result = await executeCohort(DEFINITION);

    expect(result.rows).toEqual([]);
    expect(result.error).toContain("MetforminRequests");
  });
});

describe("cohortPatients", () => {
  // The SQL returns each list criterion as the references that matched.
  const columns = ["patient_id", "MetforminRequests", "T2DMConditions", "InInitialPopulation"];

  it("marks a criterion met when its list of matching records is not empty", () => {
    const [patient] = cohortPatients(DEFINITION, columns, [
      ["p1", ["MedicationRequest/m1"], ["Condition/c1"], true]
    ]);

    expect(patient.patientId).toBe("p1");
    expect(patient.member).toBe(true);
    expect(patient.criteria).toEqual([
      { define: "T2DMConditions", label: "Type 2 diabetes", met: true, references: ["Condition/c1"] },
      { define: "MetforminRequests", label: "Metformin", met: true, references: ["MedicationRequest/m1"] }
    ]);
  });

  it("shows which criterion a non-member missed", () => {
    const [patient] = cohortPatients(DEFINITION, columns, [["p2", [], ["Condition/c1"], false]]);

    expect(patient.member).toBe(false);
    expect(patient.criteria.map((criterion) => [criterion.label, criterion.met])).toEqual([
      ["Type 2 diabetes", true],
      ["Metformin", false]
    ]);
    expect(patient.criteria[1].references).toEqual([]);
  });

  it("fails when the result has no patient_id column", () => {
    expect(() => cohortPatients(DEFINITION, ["InInitialPopulation"], [[true]])).toThrow(/patient_id/);
  });
});
