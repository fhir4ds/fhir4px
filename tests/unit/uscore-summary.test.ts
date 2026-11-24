import { describe, expect, it } from "vitest";
import type { UsCoreCheckResult } from "../../src/lib/fhir/uscore-checks";
import { summarizeUsCore, usCoreSummaryText } from "../../src/lib/fhir/uscore-summary";

function check(id: string, total: number, conforming: number, error?: string): UsCoreCheckResult {
  return {
    check: { id, name: id, resource: id, description: "" },
    total,
    conforming,
    ...(error ? { error } : {})
  };
}

describe("summarizeUsCore", () => {
  it("counts checks that pass, fall short, have no data, or errored", () => {
    expect(
      summarizeUsCore([
        check("Patient", 10, 10),
        check("Observation", 1012, 1002), // 99.0%: at the line, passes
        check("Condition", 67, 66), // 98.5%: falls short
        check("DiagnosticReport", 20, 17), // 85%: falls short
        check("DocumentReference", 0, 0), // nothing of that type
        check("Encounter", 0, 0, "view failed")
      ])
    ).toEqual({ passing: 2, failing: 3, noData: 1 });
  });

  it("counts a 99 percent share as passing and just under it as not", () => {
    expect(summarizeUsCore([check("a", 100, 99)])).toEqual({ passing: 1, failing: 0, noData: 0 });
    expect(summarizeUsCore([check("a", 1000, 989)])).toEqual({ passing: 0, failing: 1, noData: 0 });
  });
});

describe("usCoreSummaryText", () => {
  const text = (passing: number, failing: number, noData: number) =>
    usCoreSummaryText({ passing, failing, noData });

  it("reads '8 of 8 checks passed' when everything passes", () => {
    expect(text(8, 0, 0)).toBe("8 of 8 checks passed");
  });

  it("leaves checks with no data out of the fraction and names them", () => {
    expect(text(7, 0, 1)).toBe("7 of 7 checks passed · 1 with no data");
  });

  it("shows shortfalls in the fraction", () => {
    expect(text(6, 2, 0)).toBe("6 of 8 checks passed");
  });

  it("uses the singular for one check", () => {
    expect(text(1, 0, 3)).toBe("1 of 1 check passed · 3 with no data");
  });

  it("says so when there was nothing to check", () => {
    expect(text(0, 0, 2)).toBe("nothing to check yet · 2 with no data");
  });
});
