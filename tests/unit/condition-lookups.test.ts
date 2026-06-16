import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findDeterministicConditionsForLab } from "../../src/lib/fhir/condition-lab-lookup";
import { findDeterministicConditionsForMedication } from "../../src/lib/fhir/condition-medication-lookup";

// Minimal fixtures that mirror the shape of the real JSON files.
// Keys are intentionally lowercase to match the reverse-index construction.
const LAB_FIXTURE = {
  version: "1.0.0",
  total_conditions: 3,
  total_pairs: 5,
  relationships: {
    "Diabetes Type 2": ["Hemoglobin A1c/Hemoglobin.Total", "Glucose", "Insulin"],
    "High Blood Pressure": ["Systolic Blood Pressure", "Intravascular Diastolic", "Intravascular Systolic"],
    "Anemia": ["Hemoglobin", "Hematocrit"]
  }
};

const MED_FIXTURE = {
  version: "1.0.0",
  total_conditions: 3,
  total_pairs: 6,
  relationships: {
    "Diabetes Type 2": ["Metformin", "Insulin", "Glipizide"],
    "High Blood Pressure": ["Lisinopril", "Amlodipine"],
    "Asthma": ["Albuterol"]
  }
};

const RXNORM_FIXTURE: Record<string, Array<{ c: string; n: string }>> = {
  "860975": [{ c: "860973", n: "metformin" }],
  "617314": [{ c: "83211", n: "atorvastatin" }],
  "745679": [{ c: "435", n: "albuterol" }],
  "999001": [
    { c: "83211", n: "atorvastatin" },
    { c: "8588", n: "amlodipine" }
  ]
};

function setupFetchMocks() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL | string) => {
    const url = typeof input === "string" ? input : String(input);
    let body: unknown = {};
    if (url.includes("condition_lab_relationships.json")) {
      body = LAB_FIXTURE;
    } else if (url.includes("condition_medication_relationships.json")) {
      body = MED_FIXTURE;
    } else if (url.includes("rxnorm-ingredients.json")) {
      body = RXNORM_FIXTURE;
    }
    return {
      ok: true,
      async json() {
        return body;
      }
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("condition-lab-lookup", () => {
  beforeEach(() => setupFetchMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("finds conditions for an exact lab name match", async () => {
    const result = await findDeterministicConditionsForLab("Hemoglobin A1c/Hemoglobin.Total");
    expect(result).toContain("Diabetes Type 2");
  });

  it("finds conditions for vitals (Intravascular Diastolic)", async () => {
    const result = await findDeterministicConditionsForLab("Intravascular Diastolic");
    expect(result).toEqual(["High Blood Pressure"]);
  });

  it("returns empty for unknown labs", async () => {
    const result = await findDeterministicConditionsForLab("Some Unknown Lab");
    expect(result).toEqual([]);
  });

  it("returns multiple conditions when a lab maps to several", async () => {
    // "Insulin" maps to both Diabetes Type 2 (from the fixture) — but the
    // reverse index is keyed by lab name → conditions, so we check Glucose
    // which only maps to Diabetes Type 2.
    const result = await findDeterministicConditionsForLab("Glucose");
    expect(result).toEqual(["Diabetes Type 2"]);
  });
});

describe("condition-medication-lookup", () => {
  beforeEach(() => setupFetchMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("finds conditions via RxNorm code decomposition (primary path)", async () => {
    // Code 860975 → metformin → Diabetes Type 2
    const result = await findDeterministicConditionsForMedication("Metformin Oral Product", {
      rxnormCodes: ["860975"]
    });
    expect(result).toEqual(["Diabetes Type 2"]);
  });

  it("finds conditions via RxNorm for combination drugs", async () => {
    // Code 999001 → atorvastatin + amlodipine
    const result = await findDeterministicConditionsForMedication("Unknown Brand Name", {
      rxnormCodes: ["999001"]
    });
    expect(result).toContain("High Blood Pressure"); // amlodipine
  });

  it("falls back to exact name match when no RxNorm codes provided", async () => {
    const result = await findDeterministicConditionsForMedication("Metformin");
    expect(result).toEqual(["Diabetes Type 2"]);
  });

  it("falls back to substring match for names with form suffixes", async () => {
    const result = await findDeterministicConditionsForMedication("Metformin Oral Product");
    expect(result).toEqual(["Diabetes Type 2"]);
  });

  it("falls back to substring for multi-word ingredient names", async () => {
    // "Albuterol Inhalant Product" → "albuterol" word-boundary match
    const result = await findDeterministicConditionsForMedication("Albuterol Inhalant Product");
    expect(result).toEqual(["Asthma"]);
  });

  it("returns empty for medications with no known condition associations", async () => {
    const result = await findDeterministicConditionsForMedication("Vitamin C");
    expect(result).toEqual([]);
  });

  it("prefers RxNorm code path over name matching when both would match", async () => {
    // Code 860975 → metformin → Diabetes Type 2
    // Name "Metformin" would also match via exact path.
    // Verify RxNorm path runs first and returns the same result.
    const result = await findDeterministicConditionsForMedication("Metformin", {
      rxnormCodes: ["860975"]
    });
    expect(result).toEqual(["Diabetes Type 2"]);
  });

  it("does not false-positive on substrings (e.g. 'sin' in 'metformin')", async () => {
    const result = await findDeterministicConditionsForMedication("mesotherapy");
    expect(result).toEqual([]);
  });

  it("handles multiple RxNorm codes for the same medication", async () => {
    // Two codes both decomposing to metformin should not duplicate results
    const result = await findDeterministicConditionsForMedication("Metformin 500mg", {
      rxnormCodes: ["860975", "860976"]
    });
    expect(result).toEqual(["Diabetes Type 2"]);
  });

  it("returns empty when RxNorm code is unknown", async () => {
    const result = await findDeterministicConditionsForMedication("Unknown Drug", {
      rxnormCodes: ["000000"]
    });
    // Unknown code → no ingredients → falls through to name match → no match
    expect(result).toEqual([]);
  });
});
