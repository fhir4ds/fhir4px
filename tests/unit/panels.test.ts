import { describe, expect, it } from "vitest";
import { matchPanels, panelPartCids, PANEL_DEFINITIONS, type PanelCandidate } from "../../src/lib/fhir/panels";

const CROSSWALK: Record<string, string[]> = {
  "VAL-LAB-LOINC-51990-0": ["LP-CREAT", "LP-GLUC", "LP-K", "LP-NA"],
  "VAL-LAB-LOINC-24323-8": ["LP-GLUC", "LP-NA", "LP-ALT"],
  "VAL-VIT-LOINC-85354-9": ["LP-BP", "VIT-SYS", "VIT-DIA"]
};

function candidate(groupId: string, partsByDate: Record<string, string[]>): PanelCandidate {
  return {
    groupId,
    parts: Object.entries(partsByDate).flatMap(([date, cids]) => cids.map((cid) => ({ cid, date })))
  };
}

describe("panelPartCids", () => {
  it("reads parts for lab and vital panels", () => {
    expect(panelPartCids({ code: "51990-0", name: "BMP" }, CROSSWALK)).toHaveLength(4);
    expect(panelPartCids({ code: "85354-9", name: "BP" }, CROSSWALK)).toHaveLength(3);
    expect(panelPartCids({ code: "0000-0", name: "?" }, CROSSWALK)).toEqual([]);
  });
});

describe("matchPanels (draw dates)", () => {
  it("qualifies a date only when enough components were drawn together", () => {
    const candidates = [
      // 2026-01-05: glucose + sodium + creatinine together — BMP 3/4 = 75%.
      candidate("glucose", { "2026-01-05": ["LP-GLUC"], "2026-02-01": ["LP-GLUC"] }),
      candidate("sodium", { "2026-01-05": ["LP-NA"] }),
      candidate("creatinine", { "2026-01-05": ["LP-CREAT"] }),
      // 2026-02-01: glucose alone — 1/4 = 25%, below floors.
      candidate("alt", { "2026-02-01": ["LP-ALT"] })
    ];
    const panels = matchPanels(CROSSWALK, candidates);
    const bmp = panels.find((p) => p.code === "51990-0")!;
    expect(bmp.draws.map((d) => d.date)).toEqual(["2026-01-05"]);
    expect(bmp.draws[0].coveredPartCids.sort()).toEqual(["LP-CREAT", "LP-GLUC", "LP-NA"]);
    expect(bmp.draws[0].memberGroupIds.sort()).toEqual(["creatinine", "glucose", "sodium"]);
    expect(bmp.draws[0].coverage).toBeCloseTo(0.75);
    // CMP: 2026-01-05 glucose+sodium (2/3 = 67%) and 2026-02-01
    // glucose+alt (2/3 = 67%) both qualify; latest first.
    const cmp = panels.find((p) => p.code === "24323-8")!;
    expect(cmp.draws.map((d) => d.date)).toEqual(["2026-02-01", "2026-01-05"]);
  });

  it("drops dates below the coverage floor", () => {
    const candidates = [
      candidate("glucose", { "2026-01-05": ["LP-GLUC", "LP-NA", "LP-K"] }), // 3/4 = 75% ok
      candidate("glucose2", { "2026-03-01": ["LP-GLUC", "LP-NA"] }) // 2/4 = 50% no
    ];
    const panels = matchPanels(CROSSWALK, candidates, { definitions: [{ code: "51990-0", name: "BMP" }] });
    const bmp = panels.find((p) => p.code === "51990-0")!;
    expect(bmp.draws.map((d) => d.date)).toEqual(["2026-01-05"]);
  });

  it("requires two distinct parts on the same date even at full coverage", () => {
    // BP group providing all its parts across DIFFERENT dates never qualifies.
    const candidates = [candidate("bp", { "2026-01-01": ["VIT-SYS"], "2026-01-02": ["VIT-DIA"] })];
    const panels = matchPanels(CROSSWALK, candidates, { definitions: [{ code: "85354-9", name: "BP" }] });
    expect(panels).toEqual([]);
    // Same date: all three parts → qualifies with 100% coverage.
    const together = matchPanels(CROSSWALK, [candidate("bp", { "2026-01-01": ["VIT-SYS", "VIT-DIA", "LP-BP"] })], {
      definitions: [{ code: "85354-9", name: "BP" }]
    });
    expect(together[0].draws[0].coverage).toBe(1);
  });

  it("sorts draws latest first and skips definitions the crosswalk does not expand", () => {
    const candidates = [
      candidate("glucose", { "2026-01-05": ["LP-GLUC", "LP-NA", "LP-K", "LP-CREAT"], "2025-12-01": ["LP-GLUC", "LP-NA", "LP-K", "LP-CREAT"] })
    ];
    const panels = matchPanels(CROSSWALK, candidates);
    expect(panels.find((p) => p.code === "51990-0")!.draws.map((d) => d.date)).toEqual(["2026-01-05", "2025-12-01"]);
    expect(matchPanels({ "VAL-LAB-LOINC-58410-2": ["LP-ONLY"] }, [{ groupId: "g", parts: [{ cid: "LP-ONLY", date: "2026-01-01" }] }], { definitions: PANEL_DEFINITIONS })).toEqual([]);
  });
});
