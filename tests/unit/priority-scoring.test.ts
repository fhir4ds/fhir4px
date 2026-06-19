import { describe, expect, it } from "vitest";
import {
  scoreCondition,
  scoreLab,
  scoreMedication,
  scoreEncounter,
  impactBucket,
  sortByScoreDescending,
  BASE_WEIGHT,
  BOOSTER_WEIGHT,
  isWithinDays,
  isWithinNextDays,
  isHospitalizationClass
} from "../../src/lib/priority/scoring";
import type { DisplayEncounter } from "../../src/lib/fhir/types";

function makeEncounter(overrides: Partial<DisplayEncounter> = {}): DisplayEncounter {
  return {
    id: "e1",
    label: "Office visit",
    source: "provider",
    ...overrides
  };
}

describe("scoreCondition", () => {
  it("returns just base when no boosters fire", () => {
    const s = scoreCondition({
      baseDw: 0.4,
      relatedEncounters: [],
      visitClassByEncounterId: new Map(),
      outOfRangeLabCount: 0,
      activeRelatedMedCount: 0
    });
    expect(s.base).toBe(0.4);
    expect(s.boosterScore).toBe(0);
    expect(s.total).toBeCloseTo(BASE_WEIGHT * 0.4, 5);
    expect(s.reasons).toHaveLength(0);
  });

  it("returns 0 for uncoded condition with no boosters", () => {
    const s = scoreCondition({
      baseDw: 0,
      relatedEncounters: [],
      visitClassByEncounterId: new Map(),
      outOfRangeLabCount: 0,
      activeRelatedMedCount: 0
    });
    expect(s.total).toBe(0);
  });

  it("applies recent encounter booster", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 30);
    const s = scoreCondition({
      baseDw: 0.4,
      relatedEncounters: [makeEncounter({ id: "e1", periodStart: recent.toISOString() })],
      visitClassByEncounterId: new Map([["e1", "outpatient"]]),
      outOfRangeLabCount: 0,
      activeRelatedMedCount: 0
    });
    expect(s.boosterScore).toBeCloseTo(0.20, 5);
    expect(s.total).toBeCloseTo(BASE_WEIGHT * 0.4 + BOOSTER_WEIGHT * 0.20, 5);
  });

  it("applies upcoming encounter booster", () => {
    const upcoming = new Date();
    upcoming.setDate(upcoming.getDate() + 10);
    const s = scoreCondition({
      baseDw: 0.4,
      relatedEncounters: [makeEncounter({ id: "e1", periodStart: upcoming.toISOString() })],
      visitClassByEncounterId: new Map([["e1", "outpatient"]]),
      outOfRangeLabCount: 0,
      activeRelatedMedCount: 0
    });
    expect(s.boosterScore).toBeCloseTo(0.30, 5);
  });

  it("ignores encounters outside the recency window", () => {
    const stale = new Date();
    stale.setDate(stale.getDate() - 200);
    const s = scoreCondition({
      baseDw: 0.4,
      relatedEncounters: [makeEncounter({ id: "e1", periodStart: stale.toISOString() })],
      visitClassByEncounterId: new Map([["e1", "outpatient"]]),
      outOfRangeLabCount: 0,
      activeRelatedMedCount: 0
    });
    expect(s.boosterScore).toBe(0);
  });

  it("applies recent hospitalization booster when class is inpatient and within 30d", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 10);
    const s = scoreCondition({
      baseDw: 0.4,
      relatedEncounters: [makeEncounter({ id: "e1", periodStart: recent.toISOString() })],
      visitClassByEncounterId: new Map([["e1", "inpatient"]]),
      outOfRangeLabCount: 0,
      activeRelatedMedCount: 0
    });
    // Hospitalization also fires recent_encounter
    expect(s.boosterScore).toBeCloseTo(0.20 + 0.50, 5);
  });

  it("applies recent hospitalization booster when class is emergency", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 5);
    const s = scoreCondition({
      baseDw: 0.4,
      relatedEncounters: [makeEncounter({ id: "e1", periodStart: recent.toISOString() })],
      visitClassByEncounterId: new Map([["e1", "emergency"]]),
      outOfRangeLabCount: 0,
      activeRelatedMedCount: 0
    });
    expect(s.boosterScore).toBeCloseTo(0.20 + 0.50, 5);
  });

  it("does not apply hospitalization booster for outpatient class", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 5);
    const s = scoreCondition({
      baseDw: 0.4,
      relatedEncounters: [makeEncounter({ id: "e1", periodStart: recent.toISOString() })],
      visitClassByEncounterId: new Map([["e1", "outpatient"]]),
      outOfRangeLabCount: 0,
      activeRelatedMedCount: 0
    });
    expect(s.boosterScore).toBeCloseTo(0.20, 5);
  });

  it("applies out-of-range lab booster capped at 3 labs", () => {
    const s = scoreCondition({
      baseDw: 0.4,
      relatedEncounters: [],
      visitClassByEncounterId: new Map(),
      outOfRangeLabCount: 5,
      activeRelatedMedCount: 0
    });
    // 3 labs × 0.15 = 0.45
    expect(s.boosterScore).toBeCloseTo(0.45, 5);
  });

  it("applies 2+ meds booster", () => {
    const s = scoreCondition({
      baseDw: 0.4,
      relatedEncounters: [],
      visitClassByEncounterId: new Map(),
      outOfRangeLabCount: 0,
      activeRelatedMedCount: 2
    });
    expect(s.boosterScore).toBeCloseTo(0.20, 5);
  });

  it("applies 3+ meds booster (replaces 2+)", () => {
    const s = scoreCondition({
      baseDw: 0.4,
      relatedEncounters: [],
      visitClassByEncounterId: new Map(),
      outOfRangeLabCount: 0,
      activeRelatedMedCount: 4
    });
    expect(s.boosterScore).toBeCloseTo(0.30, 5);
  });

  it("caps boosterScore at 1.0 when all boosters fire", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 5);
    const upcoming = new Date();
    upcoming.setDate(upcoming.getDate() + 5);
    const s = scoreCondition({
      baseDw: 0.5,
      relatedEncounters: [
        makeEncounter({ id: "e1", periodStart: recent.toISOString() }),
        makeEncounter({ id: "e2", periodStart: upcoming.toISOString() })
      ],
      visitClassByEncounterId: new Map([["e1", "inpatient"]]),
      outOfRangeLabCount: 10,
      activeRelatedMedCount: 5
    });
    expect(s.boosterScore).toBe(1.0);
    expect(s.total).toBeCloseTo(BASE_WEIGHT * 0.5 + BOOSTER_WEIGHT * 1.0, 5);
  });

  it("reasons list explains each contribution", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 30);
    const s = scoreCondition({
      baseDw: 0.4,
      relatedEncounters: [makeEncounter({ id: "e1", periodStart: recent.toISOString() })],
      visitClassByEncounterId: new Map([["e1", "outpatient"]]),
      outOfRangeLabCount: 2,
      activeRelatedMedCount: 2
    });
    const kinds = s.reasons.map((r) => r.kind).sort();
    expect(kinds).toEqual(["multiple_related_meds", "out_of_range_lab", "recent_encounter"]);
  });
});

describe("scoreLab", () => {
  it("returns just base when no boosters", () => {
    const s = scoreLab({ baseDw: 0.3, outOfRange: false, relatedMedCount: 0 });
    expect(s.total).toBeCloseTo(BASE_WEIGHT * 0.3, 5);
    expect(s.reasons).toHaveLength(0);
  });

  it("applies out-of-range booster", () => {
    const s = scoreLab({ baseDw: 0.3, outOfRange: true, relatedMedCount: 0 });
    expect(s.boosterScore).toBeCloseTo(0.15, 5);
  });

  it("applies multi-med booster for 2+ monitoring meds", () => {
    const s = scoreLab({ baseDw: 0.3, outOfRange: false, relatedMedCount: 2 });
    expect(s.boosterScore).toBeCloseTo(0.20, 5);
  });

  it("uses higher booster for 3+ monitoring meds", () => {
    const s = scoreLab({ baseDw: 0.3, outOfRange: false, relatedMedCount: 3 });
    expect(s.boosterScore).toBeCloseTo(0.30, 5);
  });
});

describe("scoreMedication", () => {
  it("returns just base when no encounters", () => {
    const s = scoreMedication({
      baseDw: 0.4,
      relatedEncounters: [],
      visitClassByEncounterId: new Map()
    });
    expect(s.total).toBeCloseTo(BASE_WEIGHT * 0.4, 5);
  });

  it("applies recent + upcoming boosters", () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 30);
    const upcoming = new Date();
    upcoming.setDate(upcoming.getDate() + 10);
    const s = scoreMedication({
      baseDw: 0.4,
      relatedEncounters: [
        makeEncounter({ id: "r", periodStart: recent.toISOString() }),
        makeEncounter({ id: "u", periodStart: upcoming.toISOString() })
      ],
      visitClassByEncounterId: new Map()
    });
    expect(s.boosterScore).toBeCloseTo(0.20 + 0.30, 5);
  });
});

describe("scoreEncounter", () => {
  it("applies hospitalization booster for inpatient", () => {
    const s = scoreEncounter({ baseDw: 0.4, visitClass: "inpatient" });
    expect(s.boosterScore).toBeCloseTo(0.50, 5);
  });

  it("does not apply booster for outpatient", () => {
    const s = scoreEncounter({ baseDw: 0.4, visitClass: "outpatient" });
    expect(s.boosterScore).toBe(0);
  });
});

describe("date helpers", () => {
  it("isWithinDays handles past dates", () => {
    const d = new Date();
    d.setDate(d.getDate() - 5);
    expect(isWithinDays(d.toISOString(), 10)).toBe(true);
    expect(isWithinDays(d.toISOString(), 3)).toBe(false);
  });

  it("isWithinDays returns false for future dates", () => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    expect(isWithinDays(d.toISOString(), 10)).toBe(false);
  });

  it("isWithinNextDays handles future dates", () => {
    const d = new Date();
    d.setDate(d.getDate() + 5);
    expect(isWithinNextDays(d.toISOString(), 10)).toBe(true);
    expect(isWithinNextDays(d.toISOString(), 3)).toBe(false);
  });

  it("isHospitalizationClass returns true only for inpatient/emergency", () => {
    expect(isHospitalizationClass("inpatient")).toBe(true);
    expect(isHospitalizationClass("emergency")).toBe(true);
    expect(isHospitalizationClass("outpatient")).toBe(false);
    expect(isHospitalizationClass("telehealth")).toBe(false);
    expect(isHospitalizationClass(undefined)).toBe(false);
  });
});

describe("impactBucket", () => {
  it("assigns high/moderate/low by quartile", () => {
    const scores = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    // Top 25% (>= 0.7) = high; 50-75% = moderate; bottom 25% = low
    expect(impactBucket(0.8, scores)).toBe("high");
    expect(impactBucket(0.7, scores)).toBe("high");
    expect(impactBucket(0.5, scores)).toBe("moderate");
    expect(impactBucket(0.3, scores)).toBe("moderate");
    expect(impactBucket(0.1, scores)).toBe("low");
  });

  it("treats 0 as low", () => {
    expect(impactBucket(0, [0.5, 0.4, 0.3])).toBe("low");
  });

  it("returns low when no positive scores exist", () => {
    expect(impactBucket(0.5, [0, 0, 0])).toBe("low");
  });
});

describe("sortByScoreDescending", () => {
  it("sorts items highest total first", () => {
    const items = [
      { group: "a", score: { total: 0.1, base: 0, boosterScore: 0.1, reasons: [] } },
      { group: "b", score: { total: 0.9, base: 0.9, boosterScore: 0, reasons: [] } },
      { group: "c", score: { total: 0.5, base: 0.5, boosterScore: 0, reasons: [] } }
    ];
    const sorted = sortByScoreDescending(items);
    expect(sorted.map((i) => i.group)).toEqual(["b", "c", "a"]);
  });
});
