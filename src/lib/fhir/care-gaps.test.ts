import { describe, expect, it } from "vitest";
import { buildImmunizationGaps, buildMeasureGaps, rankCareGaps, type CareGap } from "./care-gaps";
import type { ImmunizationForecastItem } from "./immunization-forecast";
import type { MeasureGapResult } from "./measures";

function forecastItem(overrides: Partial<ImmunizationForecastItem>): ImmunizationForecastItem {
  return {
    vaccineCodes: ["207"],
    vaccineLabel: "Shingles vaccine",
    status: "due",
    ...overrides
  };
}

const NOW = new Date("2026-11-18T00:00:00Z");

describe("buildImmunizationGaps", () => {
  it("marks past-due status as high severity", () => {
    const gaps = buildImmunizationGaps([forecastItem({ status: "pastDue", pastDueDate: "2026-06-01" })], NOW);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].severity).toBe("high");
    expect(gaps[0].targetTab).toBe("Immunization");
    expect(gaps[0].summary).toContain("Past due since");
  });

  it("treats a passed past-due date as overdue even when status is due", () => {
    const gaps = buildImmunizationGaps(
      [forecastItem({ status: "due", recommendedDate: "2026-05-01", pastDueDate: "2026-08-01" })],
      NOW
    );
    expect(gaps[0].severity).toBe("high");
  });

  it("keeps upcoming due items at moderate severity", () => {
    const gaps = buildImmunizationGaps(
      [forecastItem({ status: "notComplete", recommendedDate: "2027-02-01" })],
      NOW
    );
    expect(gaps[0].severity).toBe("moderate");
    expect(gaps[0].summary).toContain("recommended by");
  });

  it("drops complete, immune, contraindicated, and aged-out statuses", () => {
    const gaps = buildImmunizationGaps(
      [
        forecastItem({ status: "complete" }),
        forecastItem({ status: "immune" }),
        forecastItem({ status: "contraindicated" }),
        forecastItem({ status: "agedOut" })
      ],
      NOW
    );
    expect(gaps).toHaveLength(0);
  });
});

describe("buildMeasureGaps", () => {
  it("includes only negative results, at high severity", () => {
    const results: MeasureGapResult[] = [
      { id: "CMS124", title: "Cervical Cancer Screening", negative: true, polarity: "proportion" },
      { id: "CMS349", title: "HIV Screening", negative: false, polarity: "proportion" }
    ];
    const gaps = buildMeasureGaps(results);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].id).toBe("measure:CMS124");
    expect(gaps[0].severity).toBe("high");
    expect(gaps[0].title).toContain("CMS124");
    expect(gaps[0].targetTab).toBeUndefined();
  });
});

describe("rankCareGaps", () => {
  const high = (id: string, date?: string): CareGap => ({
    id,
    source: "measure",
    severity: "high",
    title: id,
    summary: "",
    details: [],
    date
  });
  const moderate = (id: string, date?: string): CareGap => ({
    ...high(id, date),
    source: "immunization",
    severity: "moderate",
    targetTab: "Immunization"
  });

  it("orders overdue by most-recent date, upcoming by soonest, severity first", () => {
    const ranked = rankCareGaps([
      moderate("due-later", "2027-01-01"),
      high("overdue-newer", "2026-10-01"),
      high("overdue-ancient", "1975-06-01"),
      moderate("due-sooner", "2026-12-01")
    ]);
    expect(ranked.map((gap) => gap.id)).toEqual([
      "overdue-newer",
      "overdue-ancient",
      "due-sooner",
      "due-later"
    ]);
  });

  it("caps the result at the given limit", () => {
    const many = Array.from({ length: 8 }, (_, index) => high(`gap-${index}`));
    expect(rankCareGaps(many)).toHaveLength(5);
    expect(rankCareGaps(many, 2)).toHaveLength(2);
  });
});
