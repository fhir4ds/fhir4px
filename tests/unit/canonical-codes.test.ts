import { describe, expect, it, beforeEach } from "vitest";
import {
  loadCanonicalCodes,
  lookupCanonicalCode,
  lookupCanonicalCodeInFile,
  normalizeCanonicalName,
  categoryForResourceType,
  setCanonicalCodesFileForTest,
  type CanonicalCodeFile
} from "../../src/lib/fhir/canonical-codes";

const CONDITIONS_FILE: CanonicalCodeFile = {
  version: 1,
  generatedAt: "2026-06-18T00:00:00Z",
  source: "test",
  system: "icd10",
  count: 3,
  codes: {
    "diabetes type 2": "E11",
    "essential hypertension": "I10",
    "asthma": "J45"
  }
};

const LABS_FILE: CanonicalCodeFile = {
  version: 1,
  generatedAt: "2026-06-18T00:00:00Z",
  source: "test",
  system: "loinc",
  count: 2,
  codes: {
    "hemoglobin a1c": "4548-4",
    "glucose": "2339-0"
  }
};

beforeEach(() => {
  setCanonicalCodesFileForTest("condition", CONDITIONS_FILE);
  setCanonicalCodesFileForTest("lab", LABS_FILE);
  setCanonicalCodesFileForTest("medication", null);
});

describe("normalizeCanonicalName", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeCanonicalName("Diabetes  Type  2")).toBe("diabetes type 2");
    expect(normalizeCanonicalName("  Asthma  ")).toBe("asthma");
  });

  it("handles empty input", () => {
    expect(normalizeCanonicalName("")).toBe("");
    expect(normalizeCanonicalName("   ")).toBe("");
  });
});

describe("lookupCanonicalCodeInFile", () => {
  it("returns hit on exact match", () => {
    expect(lookupCanonicalCodeInFile("Diabetes Type 2", CONDITIONS_FILE)).toEqual({
      system: "icd10",
      code: "E11"
    });
  });

  it("returns hit on case-insensitive match", () => {
    expect(lookupCanonicalCodeInFile("ASTHMA", CONDITIONS_FILE)?.code).toBe("J45");
    expect(lookupCanonicalCodeInFile("asthma", CONDITIONS_FILE)?.code).toBe("J45");
  });

  it("returns null on miss", () => {
    expect(lookupCanonicalCodeInFile("Unknown Condition", CONDITIONS_FILE)).toBeNull();
  });

  it("returns null for empty name", () => {
    expect(lookupCanonicalCodeInFile("", CONDITIONS_FILE)).toBeNull();
    expect(lookupCanonicalCodeInFile("   ", CONDITIONS_FILE)).toBeNull();
  });
});

describe("lookupCanonicalCode (async)", () => {
  it("returns condition codes with icd10 system", async () => {
    const result = await lookupCanonicalCode("Essential Hypertension", "condition");
    expect(result).toEqual({ system: "icd10", code: "I10" });
  });

  it("returns lab codes with loinc system", async () => {
    const result = await lookupCanonicalCode("Hemoglobin A1c", "lab");
    expect(result).toEqual({ system: "loinc", code: "4548-4" });
  });

  it("returns null for unknown name", async () => {
    expect(await lookupCanonicalCode("Unknown", "condition")).toBeNull();
  });

  it("returns null for empty name", async () => {
    expect(await lookupCanonicalCode("", "condition")).toBeNull();
  });
});

describe("loadCanonicalCodes (memoization)", () => {
  it("returns the same promise on subsequent calls", async () => {
    const p1 = loadCanonicalCodes("condition");
    const p2 = loadCanonicalCodes("condition");
    expect(p1).toBe(p2);
  });
});

describe("categoryForResourceType", () => {
  it("maps Condition to condition category", () => {
    expect(categoryForResourceType(["Condition"])).toBe("condition");
  });

  it("maps Observation to lab category", () => {
    expect(categoryForResourceType(["Observation"])).toBe("lab");
  });

  it("maps MedicationRequest to medication category", () => {
    expect(categoryForResourceType(["MedicationRequest"])).toBe("medication");
  });

  it("returns null for resource types without a canonical system", () => {
    expect(categoryForResourceType(["Encounter"])).toBeNull();
    expect(categoryForResourceType(["Procedure"])).toBeNull();
    expect(categoryForResourceType(["DiagnosticReport"])).toBeNull();
  });

  it("prioritizes Condition when a group spans multiple types", () => {
    expect(categoryForResourceType(["Condition", "Observation"])).toBe("condition");
  });
});
