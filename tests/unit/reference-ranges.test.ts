import { describe, expect, it, beforeEach } from "vitest";
import {
  resolveGroupReferenceRange,
  valueIsInRange,
  setReferenceRangeTableForTest,
  type GroupReferenceRange,
  type ReferenceRangeTable
} from "../../src/lib/fhir/reference-ranges";
import type { PatientFriendlyGroup } from "../../src/lib/fhir/patient-groups";
import type { DisplayObservation } from "../../src/lib/fhir/types";

const TEST_TABLE: ReferenceRangeTable = {
  version: 1,
  source: "test",
  adultOnlyAgeYears: 18,
  ranges: {
    "4548-4": {
      name: "Hemoglobin A1c",
      aliases: ["HbA1c", "A1C", "Hemoglobin A1c/Hemoglobin.Total"],
      canonicalUnit: "%",
      ranges: { default: { low: 4.0, high: 5.6 } }
    },
    "718-7": {
      name: "Hemoglobin",
      aliases: ["Hgb", "Hb"],
      canonicalUnit: "g/dL",
      ranges: {
        male: { low: 13.5, high: 17.5 },
        female: { low: 12.0, high: 15.5 }
      }
    },
    "2339-0": {
      name: "Glucose",
      aliases: ["Blood Sugar", "Blood Glucose"],
      canonicalUnit: "mg/dL",
      molecularWeight: 180.16,
      ranges: { default: { low: 70, high: 99 } }
    },
    "17861-6": {
      name: "Calcium",
      aliases: ["Total Calcium", "Ca"],
      alternateCodes: ["49765-1"],
      canonicalUnit: "mg/dL",
      molecularWeight: 40.08,
      ranges: { default: { low: 8.5, high: 10.5 } }
    },
    "8480-6": {
      name: "Systolic Blood Pressure",
      aliases: ["Systolic BP", "SBP"],
      alternateCodes: ["40743-1", "40744-9"],
      canonicalUnit: "mm[Hg]",
      ranges: { default: { low: 90, high: 120 } }
    }
  }
};

beforeEach(() => {
  setReferenceRangeTableForTest(TEST_TABLE);
});

function makeGroup(overrides: Partial<PatientFriendlyGroup> = {}): PatientFriendlyGroup {
  return {
    groupId: "g1",
    patientFriendlyName: "Hemoglobin A1c",
    resourceIds: ["o1"],
    resourceTypes: ["Observation"],
    observationBucket: "labs",
    confidence: 0.9,
    reason: "test",
    fallback: false,
    ...overrides
  };
}

function makeObservation(overrides: Partial<DisplayObservation> = {}): DisplayObservation {
  return {
    id: "o1",
    label: "HbA1c",
    value: "5.2 %",
    normalizedValue: {
      kind: "quantity",
      display: "5.2 %",
      numericValue: 5.2,
      displayUnit: "%",
      ucumCode: "%"
    },
    status: "final",
    effectiveDate: "2026-01-01",
    source: "provider",
    ...overrides
  };
}

describe("resolveGroupReferenceRange", () => {
  describe("resource-range priority", () => {
    it("uses resource range when present, even if ACP also has the lab", async () => {
      const group = makeGroup({ canonicalCode: { system: "loinc", code: "4548-4" } });
      const obs = makeObservation({
        referenceRange: { low: 4.5, high: 6.0, unit: "%", text: "4.5-6.0 %" }
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [obs],
        patientSex: "male",
        patientAgeYears: 40
      });
      expect(range).toEqual({
        low: 4.5,
        high: 6.0,
        unit: "%",
        source: "resource",
        text: "4.5-6.0 %"
      });
    });

    it("picks the most recent resource range when multiple observations have one", async () => {
      const group = makeGroup({ resourceIds: ["old", "recent"] });
      const older = makeObservation({
        id: "old",
        effectiveDate: "2025-01-01",
        referenceRange: { low: 4.0, high: 5.5, unit: "%" }
      });
      const recent = makeObservation({
        id: "recent",
        effectiveDate: "2026-06-01",
        referenceRange: { low: 4.5, high: 6.0, unit: "%" }
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [older, recent],
        patientSex: "female",
        patientAgeYears: 40
      });
      expect(range?.low).toBe(4.5);
      expect(range?.high).toBe(6.0);
    });

    it("falls back to ACP when no observation has a range", async () => {
      const group = makeGroup({ canonicalCode: { system: "loinc", code: "4548-4" } });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "male",
        patientAgeYears: 40
      });
      expect(range?.source).toBe("acp");
      expect(range?.low).toBe(4.0);
      expect(range?.high).toBe(5.6);
      expect(range?.unit).toBe("%");
    });
  });

  describe("ACP lookup", () => {
    it("finds by canonical LOINC code", async () => {
      const group = makeGroup({
        canonicalCode: { system: "loinc", code: "4548-4" },
        patientFriendlyName: "Something Weird"
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "male",
        patientAgeYears: 40
      });
      expect(range?.source).toBe("acp");
      expect(range?.unit).toBe("%");
    });

    it("falls back to patient-friendly name match when no LOINC code", async () => {
      const group = makeGroup({
        patientFriendlyName: "Hemoglobin A1c/Hemoglobin.Total"
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "male",
        patientAgeYears: 40
      });
      expect(range?.source).toBe("acp");
      expect(range?.low).toBe(4.0);
    });

    it("matches alias case-insensitively", async () => {
      const group = makeGroup({
        patientFriendlyName: "a1c"
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "male",
        patientAgeYears: 40
      });
      expect(range?.source).toBe("acp");
    });

    it("returns null when neither code nor name matches", async () => {
      const group = makeGroup({
        patientFriendlyName: "Some Novel Lab We Don't Know"
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "male",
        patientAgeYears: 40
      });
      expect(range).toBeNull();
    });
  });

  describe("sex-specific ranges", () => {
    it("uses male range for male patient", async () => {
      const group = makeGroup({
        canonicalCode: { system: "loinc", code: "718-7" },
        patientFriendlyName: "Hemoglobin"
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "male",
        patientAgeYears: 40
      });
      expect(range?.low).toBe(13.5);
      expect(range?.high).toBe(17.5);
    });

    it("uses female range for female patient", async () => {
      const group = makeGroup({
        canonicalCode: { system: "loinc", code: "718-7" },
        patientFriendlyName: "Hemoglobin"
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "female",
        patientAgeYears: 40
      });
      expect(range?.low).toBe(12.0);
      expect(range?.high).toBe(15.5);
    });

    it("returns null for sex-specific lab when sex is other", async () => {
      const group = makeGroup({
        canonicalCode: { system: "loinc", code: "718-7" },
        patientFriendlyName: "Hemoglobin"
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "other",
        patientAgeYears: 40
      });
      expect(range).toBeNull();
    });

    it("returns null for sex-specific lab when sex is unknown", async () => {
      const group = makeGroup({
        canonicalCode: { system: "loinc", code: "718-7" },
        patientFriendlyName: "Hemoglobin"
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "unknown",
        patientAgeYears: 40
      });
      expect(range).toBeNull();
    });

    it("uses default range when lab is sex-agnostic even if sex is unknown", async () => {
      const group = makeGroup({
        canonicalCode: { system: "loinc", code: "4548-4" },
        patientFriendlyName: "Hemoglobin A1c"
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "unknown",
        patientAgeYears: 40
      });
      expect(range?.low).toBe(4.0);
    });
  });

  describe("age filter", () => {
    it("returns null when patient is under 18", async () => {
      const group = makeGroup({ canonicalCode: { system: "loinc", code: "4548-4" } });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "male",
        patientAgeYears: 16
      });
      expect(range).toBeNull();
    });

    it("returns null when patient age is unknown", async () => {
      const group = makeGroup({ canonicalCode: { system: "loinc", code: "4548-4" } });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "male",
        patientAgeYears: null
      });
      expect(range).toBeNull();
    });

    it("resolves range at the boundary age of 18", async () => {
      const group = makeGroup({ canonicalCode: { system: "loinc", code: "4548-4" } });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "male",
        patientAgeYears: 18
      });
      expect(range?.source).toBe("acp");
    });
  });

  describe("missing data", () => {
    it("returns null for empty observations", async () => {
      const group = makeGroup({ canonicalCode: { system: "loinc", code: "4548-4" } });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [],
        patientSex: "male",
        patientAgeYears: 40
      });
      expect(range?.source).toBe("acp"); // falls through to ACP since no resource range
    });

    it("returns null when group has no LOINC code and name doesn't match", async () => {
      const group = makeGroup({
        patientFriendlyName: "Completely Unknown Lab"
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "male",
        patientAgeYears: 40
      });
      expect(range).toBeNull();
    });

    it("carries molecularWeight on ACP range for labs that need it", async () => {
      const group = makeGroup({
        canonicalCode: { system: "loinc", code: "2339-0" },
        patientFriendlyName: "Glucose"
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [makeObservation()],
        patientSex: "male",
        patientAgeYears: 40
      });
      expect(range?.molecularWeight).toBeCloseTo(180.16);
    });
  });

  describe("multi-code groups", () => {
    it("tries all LOINC codes from observations, not just the first", async () => {
      // Group's first record has a code NOT in the ACP table; second record
      // has a code that IS. Without the multi-code scan, no range would resolve.
      const group = makeGroup({
        patientFriendlyName: "Systolic Blood Pressure",
        resourceIds: ["with-panel-code", "with-direct-code"]
      });
      const panelObs = makeObservation({
        id: "with-panel-code",
        codingKeys: ["loinc:85354-9"]
      });
      const directObs = makeObservation({
        id: "with-direct-code",
        codingKeys: ["loinc:8480-6"]
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [panelObs, directObs],
        patientSex: "male",
        patientAgeYears: 40
      });
      expect(range?.source).toBe("acp");
      expect(range?.unit).toBe("mm[Hg]");
      expect(range?.low).toBe(90);
      expect(range?.high).toBe(120);
    });

    it("resolves via alternateCodes when primary code is missing", async () => {
      // Observation carries alternateCode 49765-1 (substance conc calcium);
      // ACP table primary key is 17861-6 (mass conc calcium).
      const group = makeGroup({
        patientFriendlyName: "Calcium"
      });
      const obs = makeObservation({
        codingKeys: ["loinc:49765-1"]
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [obs],
        patientSex: "male",
        patientAgeYears: 40
      });
      expect(range?.source).toBe("acp");
      expect(range?.low).toBe(8.5);
      expect(range?.high).toBe(10.5);
    });

    it("falls back to name match when no LOINC code in group hits the ACP table", async () => {
      const group = makeGroup({
        patientFriendlyName: "Hemoglobin A1c"
      });
      const obs = makeObservation({
        codingKeys: ["loinc:99999-9"] // unknown code
      });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [obs],
        patientSex: "male",
        patientAgeYears: 40
      });
      expect(range?.source).toBe("acp");
      expect(range?.low).toBe(4.0); // matched by name "Hemoglobin A1c"
    });

    it("dedupes codes when multiple observations carry the same one", async () => {
      const group = makeGroup({
        canonicalCode: { system: "loinc", code: "4548-4" },
        patientFriendlyName: "Hemoglobin A1c",
        resourceIds: ["a", "b"]
      });
      const obsA = makeObservation({ id: "a", codingKeys: ["loinc:4548-4"] });
      const obsB = makeObservation({ id: "b", codingKeys: ["loinc:4548-4"] });
      const range = await resolveGroupReferenceRange({
        group,
        observations: [obsA, obsB],
        patientSex: "male",
        patientAgeYears: 40
      });
      expect(range?.low).toBe(4.0);
    });
  });
});

describe("valueIsInRange", () => {
  const range: GroupReferenceRange = {
    low: 70,
    high: 99,
    unit: "mg/dL",
    source: "acp"
  };

  it("returns true when value is in range and units match", () => {
    expect(valueIsInRange(85, "mg/dL", range)).toBe(true);
  });

  it("returns false when value is below range", () => {
    expect(valueIsInRange(60, "mg/dL", range)).toBe(false);
  });

  it("returns false when value is above range", () => {
    expect(valueIsInRange(150, "mg/dL", range)).toBe(false);
  });

  it("returns null when units differ (defer to async)", () => {
    expect(valueIsInRange(5.0, "mmol/L", range)).toBeNull();
  });

  it("returns null when value unit is missing", () => {
    expect(valueIsInRange(85, undefined, range)).toBeNull();
  });

  it("compares case-insensitively", () => {
    expect(valueIsInRange(85, "MG/DL", range)).toBe(true);
    expect(valueIsInRange(85, "mg/dl", range)).toBe(true);
  });

  it("treats boundary values as in range", () => {
    expect(valueIsInRange(70, "mg/dL", range)).toBe(true);
    expect(valueIsInRange(99, "mg/dL", range)).toBe(true);
  });
});
