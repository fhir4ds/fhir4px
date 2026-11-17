import { describe, expect, it } from "vitest";
import { COHORT_DEFINITIONS } from "../../src/lib/fhir/cohorts";

describe("cohort definitions", () => {
  it("ships a curated starter set of drug-study-shaped cohorts", () => {
    const ids = COHORT_DEFINITIONS.map((definition) => definition.id);
    expect(ids).toEqual(expect.arrayContaining([
      "t2dm-on-metformin",
      "uncontrolled-t2dm-a1c",
      "ckd-stage3-egfr",
      "htn-on-raas",
      "statin-with-ldl"
    ]));
  });

  it("every definition is executable SQL returning patient_id", () => {
    for (const definition of COHORT_DEFINITIONS) {
      expect(definition.sql).toMatch(/FROM resources/);
      expect(definition.sql).toMatch(/AS patient_id/);
      // latest-value cohorts must rank within patient, not across
      if (/ROW_NUMBER\(\)/.test(definition.sql)) {
        expect(definition.sql).toMatch(/PARTITION BY patient_ref/);
      }
    }
  });

  it("codes use standard systems", () => {
    const t2dm = COHORT_DEFINITIONS.find((d) => d.id === "t2dm-on-metformin")!;
    expect(t2dm.sql).toContain("http://snomed.info/sct");
    const a1c = COHORT_DEFINITIONS.find((d) => d.id === "uncontrolled-t2dm-a1c")!;
    expect(a1c.sql).toContain("http://loinc.org");
  });
});
