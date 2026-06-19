/**
 * Priority scoring engine for the Summary tab.
 *
 * Formula: total = BASE_WEIGHT × base + BOOSTER_WEIGHT × boosterScore
 *   - BASE_WEIGHT = 0.7 (DW dominates for coded conditions)
 *   - BOOSTER_WEIGHT = 0.3 (boosters can carry uncoded conditions to max 0.30)
 *   - boosterScore is clamped to [0, 1]
 *
 * Base is the disability weight from the GBD lookup (0 if no ICD-10). For
 * labs/vitals/medications/encounters, the base is inherited from the owning
 * condition's DW via the relationship cache.
 *
 * Boosters are additive within boosterScore:
 *   +0.20  recent encounter (within 90 days past)
 *   +0.30  upcoming encounter (within 30 days future)
 *   +0.50  recent hospitalization (inpatient/ER within 30 days)
 *   +0.15  out-of-range related lab (max 3 counted → +0.45 max)
 *   +0.20  2+ active related medications
 *   +0.30  3+ active related medications (replaces the 2+ boost)
 *
 * Recent windows (confirmed):
 *   - labs/vitals claimed by condition: 180 days lookback
 *   - recent encounter: 90 days past
 *   - upcoming encounter: 30 days future
 *   - recent hospitalization: 30 days
 */

import type { DisplayEncounter } from "../fhir/types";
import type { EncounterVisitClass } from "../fhir/local-classification";
import type { GbdWeightTable } from "./gbd-weights";

export const BASE_WEIGHT = 0.7;
export const BOOSTER_WEIGHT = 0.3;
export const BOOSTER_CAP = 1.0;

export const LAB_RECENCY_DAYS = 180;
export const RECENT_ENCOUNTER_DAYS = 90;
export const UPCOMING_ENCOUNTER_DAYS = 30;
export const RECENT_HOSPITALIZATION_DAYS = 30;

const RECENT_ENCOUNTER_BOOST = 0.20;
const UPCOMING_ENCOUNTER_BOOST = 0.30;
const RECENT_HOSPITALIZATION_BOOST = 0.50;
const OUT_OF_RANGE_LAB_BOOST_PER_LAB = 0.15;
const OUT_OF_RANGE_LAB_MAX_COUNTED = 3;
const MULTI_MED_BOOST = 0.20;
const HIGH_MULTI_MED_BOOST = 0.30;

export type PriorityReasonKind =
  | "recent_encounter"
  | "upcoming_encounter"
  | "recent_hospitalization"
  | "out_of_range_lab"
  | "multiple_related_meds"
  | "high_monitoring_intensity";

export interface PriorityReason {
  kind: PriorityReasonKind;
  contribution: number;
  detail?: string;
}

export interface PriorityScore {
  total: number;
  base: number;
  boosterScore: number;
  reasons: PriorityReason[];
}

export interface ScoredItem<GroupT> {
  group: GroupT;
  score: PriorityScore;
}

function composeScore(base: number, reasons: PriorityReason[]): PriorityScore {
  const rawBooster = reasons.reduce((sum, r) => sum + r.contribution, 0);
  const boosterScore = Math.max(0, Math.min(BOOSTER_CAP, rawBooster));
  const total = BASE_WEIGHT * base + BOOSTER_WEIGHT * boosterScore;
  return { total, base, boosterScore, reasons };
}

// ── Date helpers ─────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysSince(isoDate: string | undefined, now: Date = new Date()): number | null {
  if (!isoDate) return null;
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((now.getTime() - parsed.getTime()) / MS_PER_DAY);
}

export function daysUntil(isoDate: string | undefined, now: Date = new Date()): number | null {
  if (!isoDate) return null;
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor((parsed.getTime() - now.getTime()) / MS_PER_DAY);
}

export function isWithinDays(
  isoDate: string | undefined,
  maxDays: number,
  now: Date = new Date()
): boolean {
  const d = daysSince(isoDate, now);
  return d !== null && d >= 0 && d <= maxDays;
}

export function isWithinNextDays(
  isoDate: string | undefined,
  maxDays: number,
  now: Date = new Date()
): boolean {
  const d = daysUntil(isoDate, now);
  return d !== null && d >= 0 && d <= maxDays;
}

// ── Encounter classification ─────────────────────────────────────────────

const HOSPITALIZATION_CLASSES: ReadonlySet<EncounterVisitClass> = new Set([
  "inpatient",
  "emergency"
]);

export function isHospitalizationClass(visitClass: EncounterVisitClass | undefined): boolean {
  return visitClass ? HOSPITALIZATION_CLASSES.has(visitClass) : false;
}

// ── Scoring inputs ───────────────────────────────────────────────────────

export interface ConditionScoringInputs {
  /** DW from GBD lookup (0 if condition has no ICD-10). */
  baseDw: number;
  /** Related encounters (any visit class). */
  relatedEncounters: DisplayEncounter[];
  /** Visit class per encounter id (from classification cache or deterministic). */
  visitClassByEncounterId: Map<string, EncounterVisitClass>;
  /** Count of out-of-range related labs (already capped at OUT_OF_RANGE_LAB_MAX_COUNTED). */
  outOfRangeLabCount: number;
  /** Count of active medications related to this condition. */
  activeRelatedMedCount: number;
}

export interface LabScoringInputs {
  /** Max DW across conditions associated with this lab (0 if none). */
  baseDw: number;
  /** Whether the lab's most recent value is outside the reference range. */
  outOfRange: boolean;
  /** Count of active medications that monitor via this lab. */
  relatedMedCount: number;
}

export interface MedicationScoringInputs {
  /** Max DW across conditions this medication treats (0 if none). */
  baseDw: number;
  /** Related encounters (any visit class). */
  relatedEncounters: DisplayEncounter[];
  /** Visit class per encounter id. */
  visitClassByEncounterId: Map<string, EncounterVisitClass>;
}

export interface EncounterScoringInputs {
  /** Max DW across conditions associated with this encounter. */
  baseDw: number;
  /** This encounter's visit class. */
  visitClass: EncounterVisitClass | undefined;
}

// ── Scoring functions ────────────────────────────────────────────────────

export function scoreCondition(inputs: ConditionScoringInputs): PriorityScore {
  const reasons: PriorityReason[] = [];

  // Encounter timing boosters
  let hasRecent = false;
  let hasUpcoming = false;
  let hasRecentHospitalization = false;
  for (const enc of inputs.relatedEncounters) {
    if (isWithinNextDays(enc.periodStart, UPCOMING_ENCOUNTER_DAYS)) hasUpcoming = true;
    if (isWithinDays(enc.periodStart, RECENT_ENCOUNTER_DAYS)) hasRecent = true;
    if (isWithinDays(enc.periodStart, RECENT_HOSPITALIZATION_DAYS)) {
      const vc = inputs.visitClassByEncounterId.get(enc.id);
      if (isHospitalizationClass(vc)) hasRecentHospitalization = true;
    }
  }
  if (hasRecent) {
    reasons.push({ kind: "recent_encounter", contribution: RECENT_ENCOUNTER_BOOST });
  }
  if (hasUpcoming) {
    reasons.push({ kind: "upcoming_encounter", contribution: UPCOMING_ENCOUNTER_BOOST });
  }
  if (hasRecentHospitalization) {
    reasons.push({ kind: "recent_hospitalization", contribution: RECENT_HOSPITALIZATION_BOOST });
  }

  // Out-of-range lab booster (capped)
  if (inputs.outOfRangeLabCount > 0) {
    const counted = Math.min(inputs.outOfRangeLabCount, OUT_OF_RANGE_LAB_MAX_COUNTED);
    reasons.push({
      kind: "out_of_range_lab",
      contribution: counted * OUT_OF_RANGE_LAB_BOOST_PER_LAB,
      detail: `${counted} of ${inputs.outOfRangeLabCount} related labs flagged`
    });
  }

  // Multi-med booster (3+ replaces 2+)
  if (inputs.activeRelatedMedCount >= 3) {
    reasons.push({
      kind: "high_monitoring_intensity",
      contribution: HIGH_MULTI_MED_BOOST,
      detail: `${inputs.activeRelatedMedCount} active related medications`
    });
  } else if (inputs.activeRelatedMedCount >= 2) {
    reasons.push({
      kind: "multiple_related_meds",
      contribution: MULTI_MED_BOOST,
      detail: `${inputs.activeRelatedMedCount} active related medications`
    });
  }

  return composeScore(inputs.baseDw, reasons);
}

export function scoreLab(inputs: LabScoringInputs): PriorityScore {
  const reasons: PriorityReason[] = [];
  if (inputs.outOfRange) {
    reasons.push({
      kind: "out_of_range_lab",
      contribution: OUT_OF_RANGE_LAB_BOOST_PER_LAB,
      detail: "Most recent value outside reference range"
    });
  }
  if (inputs.relatedMedCount >= 2) {
    reasons.push({
      kind: "multiple_related_meds",
      contribution: inputs.relatedMedCount >= 3 ? HIGH_MULTI_MED_BOOST : MULTI_MED_BOOST,
      detail: `${inputs.relatedMedCount} medications monitor this lab`
    });
  }
  return composeScore(inputs.baseDw, reasons);
}

export function scoreMedication(inputs: MedicationScoringInputs): PriorityScore {
  const reasons: PriorityReason[] = [];
  let hasRecent = false;
  let hasUpcoming = false;
  for (const enc of inputs.relatedEncounters) {
    if (isWithinNextDays(enc.periodStart, UPCOMING_ENCOUNTER_DAYS)) hasUpcoming = true;
    if (isWithinDays(enc.periodStart, RECENT_ENCOUNTER_DAYS)) hasRecent = true;
  }
  if (hasRecent) reasons.push({ kind: "recent_encounter", contribution: RECENT_ENCOUNTER_BOOST });
  if (hasUpcoming) reasons.push({ kind: "upcoming_encounter", contribution: UPCOMING_ENCOUNTER_BOOST });
  return composeScore(inputs.baseDw, reasons);
}

export function scoreEncounter(inputs: EncounterScoringInputs): PriorityScore {
  const reasons: PriorityReason[] = [];
  // A single encounter's timing is implicit (we wouldn't score a non-recent encounter highly),
  // but the visit class signals severity.
  if (isHospitalizationClass(inputs.visitClass)) {
    reasons.push({ kind: "recent_hospitalization", contribution: RECENT_HOSPITALIZATION_BOOST });
  }
  return composeScore(inputs.baseDw, reasons);
}

// ── Sort helpers ─────────────────────────────────────────────────────────

export function sortByScoreDescending<GroupT>(items: ScoredItem<GroupT>[]): ScoredItem<GroupT>[] {
  return [...items].sort((a, b) => b.score.total - a.score.total);
}

/**
 * Bucket scores into impact labels for the UI chip. Quartiles within the
 * section's scored items: top 25% = "high", middle 50% = "moderate",
 * bottom 25% = "low". Items with score 0 are filtered out before computing
 * quartiles.
 */
export function impactBucket(score: number, sortedScores: number[]): "high" | "moderate" | "low" {
  const positive = sortedScores.filter((s) => s > 0).sort((a, b) => a - b);
  if (positive.length === 0) return "low";
  if (score <= 0) return "low";
  const q25 = positive[Math.floor(positive.length * 0.25)] ?? positive[0];
  const q75 = positive[Math.floor(positive.length * 0.75)] ?? positive[positive.length - 1];
  if (score >= q75) return "high";
  if (score >= q25) return "moderate";
  return "low";
}

/**
 * Resolve the base DW for a group from its codingKeys. Returns 0 if no ICD-10
 * code is present or the code isn't in the GBD table.
 */
export function resolveBaseDwFromCodingKeys(
  codingKeys: string[] | undefined,
  table: GbdWeightTable
): number {
  // Delegated to lookupDwForCodingKeys in gbd-weights.ts — re-exported here
  // for ergonomic single-import at call sites.
  return lookupDwForCodingKeysLocal(codingKeys, table);
}

// Local import to avoid a circular dependency at module load time
import { lookupDwForCodingKeys as lookupDwForCodingKeysLocal } from "./gbd-weights";
