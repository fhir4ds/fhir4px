import { describe, expect, it } from "vitest";
import { normalizeObservationValue } from "../../src/lib/fhir/observation-values";

describe("Observation value normalization", () => {
  it("preserves original quantity display and adds conservative canonical units", () => {
    const value = normalizeObservationValue({
      resourceType: "Observation",
      id: "weight",
      valueQuantity: {
        value: 180,
        unit: "lb",
        code: "[lb_av]",
        system: "http://unitsofmeasure.org"
      }
    });

    expect(value).toMatchObject({
      kind: "quantity",
      display: "180 lb",
      numericValue: 180,
      displayUnit: "lb",
      ucumCode: "[lb_av]",
      canonicalUnit: "kg"
    });
    expect(value.canonicalValue).toBeCloseTo(81.6466);
  });

  it("handles non-quantity values without inventing numeric values", () => {
    const coded = normalizeObservationValue({
        resourceType: "Observation",
        id: "coded",
        valueCodeableConcept: { text: "Positive" }
      });

    expect(coded).toMatchObject({
      kind: "codeable-concept",
      display: "Positive"
    });
    expect(coded.numericValue).toBeUndefined();

    expect(
      normalizeObservationValue({
        resourceType: "Observation",
        id: "absent",
        dataAbsentReason: { coding: [{ display: "Not asked" }] }
      })
    ).toMatchObject({
      kind: "absent",
      display: "Not asked"
    });
  });
});
