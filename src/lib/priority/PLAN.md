# Plan: Prioritization System + Summary Tab

> Source of truth for this feature. Originally drafted 2026-06-18 against the
> plan in `~/.claude/plans/compressed-splashing-shamir.md`. Update this file
> when the design evolves so future contributors (and the next iteration of
> this work) have the current picture.

## Context

The app currently renders everything chronologically/grouped, with no notion of clinical priority. Patients with 20+ conditions and 100+ labs have no way to tell what matters most. The WHO/IHME Global Burden of Disease (GBD) data ships disability weights (DW) per cause — a 0-1 severity score. We'll use DW as a priority base, layer boosters (recent appointments, out-of-range labs, multiple meds, hospitalizations) on top, and expose the result in a new Summary tab.

**Scoring formula** (confirmed): `total = 0.7 × base + 0.3 × booster_score`
- `base` = DW from GBD lookup (0 if condition has no ICD-10)
- `booster_score` = normalized 0-1 accumulating signals (capped)
- Conditions with no DW can still surface via boosters alone (max 0.30 from booster side)

**Summary tab** shows top N per section, deduped so a lab already shown on its condition card doesn't appear standalone.

## Approach

Three workstreams:
1. **Data asset** — pre-process GBD XLSX into a static JSON (`build-gbd-weights.mjs` script + `gbd_disability_weights.json`)
2. **Scoring engine** — `src/lib/priority/` modules that compute scores per group, using existing caches
3. **Summary page** — new `/summary` route + nav item, reads caches built by PatientExplorer

## Files

### Created
- `scripts/build-gbd-weights.mjs` — reads GBD ZIP, parses S9 + S13, joins via cause name, expands ICD-10 ranges, outputs `public/terminology/gbd_disability_weights.json`
- `public/terminology/gbd_disability_weights.json` — static lookup asset keyed by ICD-10 code
- `src/lib/priority/gbd-weights.ts` — runtime lookup (`loadGbdWeights`, `lookupDwForCodingKeys`)
- `src/lib/priority/scoring.ts` — core scoring engine
- `src/lib/priority/relationships.ts` — helpers for "what's related to this group"
- `src/lib/priority/dedup.ts` — claimed-labs computation
- `src/pages/Summary.tsx` — the new page
- `tests/unit/gbd-weights.test.ts`
- `tests/unit/priority-scoring.test.ts`

### Modified
- `src/app/routes.tsx` — add `/summary` route
- `src/components/layout/AppFrame.tsx` — add Summary nav entry (lucide `FileText` icon)
- `package.json` — add `xlsx` (SheetJS) as devDependency

## Output JSON shape

```json
{
  "version": 1,
  "source": "IHME GBD 2023 DIRF Appendix 1 Tables S9 + S13",
  "generatedAt": "...",
  "aggregation": "max DW across sequelae per GBD cause",
  "weights": {
    "E11": 0.21,
    "E11.9": 0.21,
    "I10": 0.07,
    "I21.4": 0.43,
    "N18.3": 0.20
  }
}
```

## Scoring engine API

```ts
export interface PriorityScore {
  total: number;        // 0.7 * base + 0.3 * boosterScore
  base: number;         // DW
  boosterScore: number; // 0-1 normalized
  reasons: PriorityReason[];
}

export interface PriorityReason {
  kind: "recent_encounter" | "upcoming_encounter" | "recent_hospitalization"
      | "out_of_range_lab" | "multiple_related_meds" | "high_monitoring_intensity";
  contribution: number;  // amount added to boosterScore
  detail?: string;
}

scoreConditionGroup(group, relatedLabs, relatedMeds, relatedEncounters, gbdTable): PriorityScore
scoreLabGroup(group, owningConditions, relatedMeds, outOfRangeFlag, gbdTable): PriorityScore
scoreMedicationGroup(group, treatedConditions, relatedEncounters, gbdTable): PriorityScore
scoreEncounter(encounter, owningConditions, gbdTable): PriorityScore
```

## Booster factors

Added to `boosterScore`, capped at 1.0:
- Recent encounter (periodStart within 90 days past): **+0.20**
- Upcoming encounter (periodStart within 30 days future): **+0.30**
- Recent hospitalization (inpatient/ER class, within 30 days): **+0.50**
- Out-of-range related lab (per lab, max 3 counted): **+0.15 each** (max +0.45)
- 2+ active related meds: **+0.20**
- 3+ active related meds: **+0.30** (replaces 2+ boost)

## Recency windows

- Labs/vitals claimed by condition: **6 months (180 days)** lookback
- Recent appointments (booster): **90 days past**
- Upcoming appointments (booster): **30 days future**
- Recent hospitalization (booster): **30 days**

## Summary page layout

```
[Patient header: name, age, top-line stat]

[Patient Overview section: top 5 cross-domain items]

[Conditions section: top 8 condition groups by score]
  Each card: name, impact chip (High/Moderate/Low based on score quartiles),
             most recent related lab value inline (if claimed),
             active med count chip,
             recent/upcoming appointment indicator

[Labs & Vitals section: top 8 lab/vital groups, excluding claimed]
  Each card: name, latest value, out-of-range flag (if any)

[Medications section: top 8 by treated-condition DW]
  Each card: name, condition it treats, recent monitoring labs (if any)

[Activity section: top 8 recent + upcoming encounters]

[Footer per section: "+N more" → links to /records?type=...]
```

## Data flow

No shared patient state in the app today — Summary recomputes like PatientExplorer does:
1. Read connected sources + datasets (same pattern as `LocalExport.tsx:157`)
2. Build summary via `buildReferralSummary(resources)` (normalize.ts:465)
3. Load grouping cache via `localVault` (already encrypted in IndexedDB by PatientExplorer)
4. If grouping cache empty: render prompt "Visit Records tab first to organize your data"
5. Load relationship cache + reference ranges
6. Compute priority scores
7. Slice top N per section
8. Render

## Key design decisions

1. **No shared patient state**. Summary reads the same encrypted caches PatientExplorer writes (grouping cache, relationship cache) via localVault. If empty, prompts user to visit Records first. Avoids duplicating the LLM pipeline in two places.

2. **Score visibility**. The score is internal only — never displayed. Impact chip (High/Moderate/Low) computed from score quartiles within each section.

3. **Dedup rule**. Labs claimed by a condition (relationship exists AND value within 180 days) are filtered from standalone labs section. Most recent claimed lab value shows inline on the condition card.

4. **Uncoded conditions**. DW base = 0; can still surface via boosters (max booster_score = 1.0 → max contribution 0.30). Future: LLM emits DW bucket for uncoded conditions (separate task).

5. **GBD aggregation**. Max DW across sequelae per cause (most severe presentation). Conservative for prioritization.

6. **Static asset, not API**. GBD data updates annually; we ship the JSON and rebuild on each major release. ~200-500 KB after range expansion.

7. **GBD join**. S9 sequelae names embed the cause as a `" - "`-separated prefix; we parse that, look up the cause in S13 (which carries ICD-10 code ranges), expand ranges to individual codes, and emit `code → max(DW across sequelae)`.

## Verification

1. `node scripts/build-gbd-weights.mjs` — produces `public/terminology/gbd_disability_weights.json`
2. Verify common ICD-10 codes resolve: E11 (T2DM), I10 (HTN), I21.4 (NSTEMI), N18.3 (CKD3), J45.909 (asthma) — all should have non-zero DW
3. `npx vitest run` — all unit tests pass (new + existing)
4. `npx tsc --noEmit` — clean
5. Manual test flow:
   - Load Sam Codes-Only in Records tab → let grouping + relationships complete
   - Navigate to Summary tab → expect top conditions (Diabetes, HTN) with associated labs inline, deduped lab section, scored medications
   - Load Jordan Linked → expect relationships to drive scoring (HbA1c claimed by Diabetes, BP claimed by HTN, Metformin treated-condition Diabetes)
   - Load Robin No-Codes → conditions without ICD-10 may still appear if boosters fire; otherwise empty sections with "+N more" links
6. Sanity check: scores are deterministic across reloads (caches persist)
