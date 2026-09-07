/**
 * Related-records display model — pure functions, no React.
 *
 * Takes a group's RelatedMatch[] and builds the sectioned display model:
 *
 *   Safety first —  Caution / Avoid / May interfere
 *   Monitoring —    Labs & vitals, Procedures
 *   Treats & prevention — Treats / Helps prevent / Used for
 *   Also relevant — conditions, vaccines, everything else
 *
 * Panel-family collapse: matches whose viaHub attribution names a shared
 * hub (e.g. three labs all "via Comprehensive Metabolic Panel") collapse
 * into one chip that expands on demand. Only monitoring buckets collapse —
 * safety chips never hide.
 */

import type { AssociationBucket } from "./types";
import type { RelatedMatch } from "./matcher";

/** Buckets that render with warning styling and always stay visible. */
export const SAFETY_BUCKETS: ReadonlySet<AssociationBucket> = new Set([
  "adverse_effect",
  "contraindicated_in",
  "interferes_with_test",
  // Wave-2 (v2026-09-07.0118): a drug that moves a lab/vital number is a
  // warning about that number, same family as adverse effects.
  "causes_abnormality"
]);

/** Buckets eligible for viaHub family collapse (never safety). */
const COLLAPSIBLE_BUCKETS: ReadonlySet<AssociationBucket> = new Set(["lab", "vital", "procedure"]);

export type RelatedSectionId = "safety" | "monitoring" | "treatment" | "also";

export interface RelatedSection {
  id: RelatedSectionId;
  label: string;
  matches: RelatedMatch[];
}

/** A single renderable chip: either a lone match or a collapsed family. */
export interface RelatedChip {
  /** Stable React key. */
  key: string;
  /** The match to render (family head when collapsed). */
  match: RelatedMatch;
  /** Extra matches hidden behind this chip (family members), if any. */
  hidden: RelatedMatch[];
}

/**
 * Patient-facing label for a collapsed family: keeps the first (head)
 * member's name and counts the rest — "Calcium +2 more via CMP".
 * Pure string builder so tests can pin exact copy.
 */
export function collapsedFamilyLabel(chip: RelatedChip): string {
  const hub = chip.match.viaHubName ?? "";
  if (chip.hidden.length === 0) return `via ${hub}`;
  return `+${chip.hidden.length} more via ${hub}`;
}

type SectionSpec = { id: RelatedSectionId; label: string; buckets: AssociationBucket[] };

/** Display order of sections; bucket order within each section's spec is the tiebreak. */
const SECTION_SPECS: SectionSpec[] = [
  { id: "safety", label: "Safety", buckets: ["adverse_effect", "contraindicated_in", "interferes_with_test", "causes_abnormality"] },
  { id: "monitoring", label: "Monitoring", buckets: ["lab", "vital", "procedure", "screens_before"] },
  { id: "treatment", label: "Treats & prevention", buckets: ["treats", "medication", "antidote_for"] },
  { id: "also", label: "Also relevant", buckets: ["condition", "vaccine"] }
];

const SECTION_BY_BUCKET = new Map<AssociationBucket, RelatedSectionId>([
  ["adverse_effect", "safety"],
  ["contraindicated_in", "safety"],
  ["interferes_with_test", "safety"],
  ["causes_abnormality", "safety"],
  ["lab", "monitoring"],
  ["vital", "monitoring"],
  ["procedure", "monitoring"],
  ["screens_before", "monitoring"],
  ["treats", "treatment"],
  ["medication", "treatment"],
  ["antidote_for", "treatment"],
  ["condition", "also"],
  ["vaccine", "also"]
]);

export function sectionIdForBucket(bucket: AssociationBucket): RelatedSectionId {
  return SECTION_BY_BUCKET.get(bucket) ?? "also";
}

/**
 * Group matches into ordered display sections. Empty sections are dropped.
 * Section order: safety → monitoring → treatment → also.
 */
export function groupRelatedSections(matches: RelatedMatch[]): RelatedSection[] {
  const sections = new Map<RelatedSectionId, RelatedMatch[]>(
    SECTION_SPECS.map((spec) => [spec.id, [] as RelatedMatch[]])
  );
  for (const match of matches) {
    sections.get(sectionIdForBucket(match.relationship))!.push(match);
  }
  return SECTION_SPECS.filter((spec) => {
    const sectionMatches = sections.get(spec.id)!;
    return sectionMatches.length > 0;
  }).map((spec) => ({
    id: spec.id,
    label: spec.label,
    matches: sections.get(spec.id)!
  }));
}

/**
 * Collapse viaHub families within one section's matches.
 *
 * Matches sharing a viaHubName in a collapsible bucket merge into the first
 * occurrence ("Calcium · via CMP" absorbs "Sodium · via CMP"). Returns chips
 * plus the set of hub names that actually hid members, so the UI can render
 * "+N via <hub>" affordances and expand state stays keyed on stable strings.
 */
export function collapseViaHubFamilies(
  matches: RelatedMatch[]
): { chips: RelatedChip[]; collapsedHubNames: Set<string> } {
  const chips: RelatedChip[] = [];
  const hubHolders = new Map<string, RelatedChip>();
  const collapsedHubNames = new Set<string>();

  for (const match of matches) {
    const collapsible =
      match.viaHubName !== undefined &&
      COLLAPSIBLE_BUCKETS.has(match.relationship);

    if (collapsible && match.viaHubName !== undefined) {
      const existing = hubHolders.get(match.viaHubName);
      if (existing) {
        existing.hidden.push(match);
        collapsedHubNames.add(match.viaHubName);
        continue;
      }
      const chip: RelatedChip = {
        key: `${match.groupId}:${match.relationship}:${match.viaHubName}`,
        match,
        hidden: []
      };
      hubHolders.set(match.viaHubName, chip);
      chips.push(chip);
      continue;
    }

    chips.push({ key: `${match.groupId}:${match.relationship}`, match, hidden: [] });
  }

  return { chips, collapsedHubNames };
}
