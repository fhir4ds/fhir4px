/**
 * Observation value trend detection.
 *
 * Detects upward/downward trends from a series of numeric observation values.
 * A trend requires 2 consecutive comparisons moving in the same direction
 * among the most recent 3+ data points. Only numeric values in the same unit
 * (or convertible units) are compared.
 */

import type { NormalizedObservationValue } from "./observation-values";

export interface ObservationTrendPoint {
  value: number;
  unit?: string;
  date?: string;
}

export type TrendDirection = "up" | "down" | "none";

export interface TrendResult {
  direction: TrendDirection;
  pointCount: number;
  /** Most recent value in the series */
  latest?: number;
  /** Previous value before latest */
  previous?: number;
  /** Percent change from previous to latest (null if previous is 0 or undefined) */
  percentChange?: number;
  unit?: string;
}

/**
 * Extract numeric trend points from normalized observation values.
 * Filters to values that have a numericValue and comparable unit.
 */
export function extractTrendPoints(
  values: Array<{ normalizedValue: NormalizedObservationValue; effectiveDate?: string }>
): ObservationTrendPoint[] {
  const points: ObservationTrendPoint[] = [];
  for (const v of values) {
    const numeric = v.normalizedValue.numericValue;
    if (typeof numeric !== "number" || !Number.isFinite(numeric)) continue;
    points.push({
      value: numeric,
      unit: v.normalizedValue.ucumCode ?? v.normalizedValue.displayUnit,
      date: v.effectiveDate
    });
  }
  // Sort by date ascending (oldest first)
  points.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return points;
}

/**
 * Group trend points by unit. Only points in the same unit are compared.
 * Returns the largest group (most data points) — that's the one we trend.
 */
function largestUnitGroup(points: ObservationTrendPoint[]): ObservationTrendPoint[] {
  if (points.length <= 1) return points;

  const byUnit = new Map<string, ObservationTrendPoint[]>();
  for (const p of points) {
    const unit = p.unit ?? "";
    if (!byUnit.has(unit)) byUnit.set(unit, []);
    byUnit.get(unit)!.push(p);
  }

  let largest: ObservationTrendPoint[] = [];
  for (const group of byUnit.values()) {
    if (group.length > largest.length) largest = group;
  }
  return largest;
}

/**
 * Detect trend from a series of observation values.
 *
 * Rules:
 * - 3+ points: last 2 comparisons both same direction → trend
 * - 2 points: direction only (no trend chip)
 * - 0-1 points: no trend
 * - Values must be numeric and in the same unit
 */
export function detectTrend(
  values: Array<{ normalizedValue: NormalizedObservationValue; effectiveDate?: string }>
): TrendResult {
  const allPoints = extractTrendPoints(values);
  const points = largestUnitGroup(allPoints);

  if (points.length === 0) {
    return { direction: "none", pointCount: 0 };
  }

  if (points.length === 1) {
    return {
      direction: "none",
      pointCount: 1,
      latest: points[0].value,
      unit: points[0].unit
    };
  }

  if (points.length === 2) {
    // Two points: show direction but not a trend
    const [a, b] = points;
    const diff = b.value - a.value;
    const direction: TrendDirection = diff > 0 ? "up" : diff < 0 ? "down" : "none";
    return {
      direction: "none", // Not a trend yet — only 2 points
      pointCount: 2,
      latest: b.value,
      previous: a.value,
      percentChange: a.value !== 0 ? Math.round((diff / Math.abs(a.value)) * 100) : undefined,
      unit: b.unit
    };
  }

  // 3+ points: check if last 2 comparisons are same direction
  const n = points.length;
  const last = points[n - 1];
  const second = points[n - 2];
  const third = points[n - 3];

  const diff1 = second.value - third.value;
  const diff2 = last.value - second.value;

  let direction: TrendDirection = "none";
  if (diff1 > 0 && diff2 > 0) direction = "up";
  else if (diff1 < 0 && diff2 < 0) direction = "down";

  const percentChange = second.value !== 0
    ? Math.round(((last.value - second.value) / Math.abs(second.value)) * 100)
    : undefined;

  return {
    direction,
    pointCount: n,
    latest: last.value,
    previous: second.value,
    percentChange,
    unit: last.unit
  };
}
