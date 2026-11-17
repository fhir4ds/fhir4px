import { describe, expect, it } from "vitest";
import { COHORT_DEFINITIONS } from "../../src/lib/fhir/cohorts";

describe("cohort definitions", () => {
  it("ships a curated starter set of drug-study-shaped cohorts", () => {
    const ids = COHORT_DEFINITIONS.map((definition) => definition.id);
    expect(ids).toEqual(
      expect.arrayContaining(["t2dm-on-metformin", "uncontrolled-t2dm-a1c", "ckd-stage3-egfr", "htn-on-raas", "statin-with-ldl"])
    );
  });

  it("every definition is authored CQL with a library header and population define", () => {
    for (const definition of COHORT_DEFINITIONS) {
      expect(definition.cql).toMatch(/^library \w+\s*$/m);
      expect(definition.cql).toMatch(/using FHIR version '4\.0\.1'/);
      expect(definition.cql).toMatch(/context Patient/);
      expect(definition.cql).toMatch(/define InInitialPopulation:/);
    }
  });

  it("codes reference standard systems", () => {
    const t2dm = COHORT_DEFINITIONS.find((d) => d.id === "t2dm-on-metformin")!;
    expect(t2dm.cql).toContain("http://snomed.info/sct");
    const a1c = COHORT_DEFINITIONS.find((d) => d.id === "uncontrolled-t2dm-a1c")!;
    expect(a1c.cql).toContain("http://loinc.org");
  });
});
