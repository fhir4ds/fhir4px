/**
 * Panel view model — pure functions, no React.
 *
 * A panel is a LOINC code the associations lab-part crosswalk expands into
 * multiple component parts (CMP, BMP, CBC, lipid, liver, urinalysis, the
 * blood-pressure panel). A panel only exists as a draw event: a date on
 * which the patient's labs covered enough of the expected components.
 *
 *   - explicit: a panel observation exists (e.g. LOINC 85354-9 Blood
 *     Pressure with systolic/diastolic components) — the observation's own
 *     components cover the parts on its date
 *   - virtual: the panel was never transmitted as one resource; a draw is
 *     reconstructed from the member labs recorded on the same date
 *
 * A panel qualifies when, on a single date, at least `minMembers` (2)
 * distinct component parts are present AND coverage of the expected
 * components is at least `minCoverage` (66%).
 */

export interface PanelDefinition {
  /** Panel LOINC code (the crosswalk key). */
  code: string;
  name: string;
  /** Explicit expected component parts. When set, overrides the crosswalk
   * expansion — used where the crosswalk's member set outgrows the parts
   * real transmissions carry (e.g. Blood Pressure also lists mean arterial
   * pressure and a LOINC panel term, which would require ≥3 of 4 parts
   * under the 66% coverage floor and reject ordinary systolic+diastolic
   * draws). */
  parts?: string[];
}

/**
 * Curated common panels, all verified to expand into ≥2 component parts in
 * the associations crosswalk. Vitals panels (blood pressure) live in the
 * same crosswalk table via their VAL-VIT identity CIDs.
 */
export const PANEL_DEFINITIONS: readonly PanelDefinition[] = [
  { code: "24323-8", name: "Comprehensive Metabolic Panel" },
  { code: "51990-0", name: "Basic Metabolic Panel" },
  { code: "58410-2", name: "Complete Blood Count" },
  { code: "57698-3", name: "Lipid Panel" },
  { code: "24325-3", name: "Liver Panel" },
  { code: "24357-6", name: "Urinalysis" },
  {
    code: "85354-9",
    name: "Blood Pressure",
    // Systolic + diastolic are the parts ordinary BP transmissions carry;
    // the crosswalk's extra members (mean arterial pressure, panel term)
    // must not gate draw qualification.
    parts: ["VAL-VIT-LOINC-8480-6", "VAL-VIT-LOINC-8462-4"]
  }
];

/** One part occurrence: the part was produced by a group on this date. */
export interface PanelCandidatePart {
  cid: string;
  /** ISO calendar date (YYYY-MM-DD). */
  date: string;
}

export interface PanelCandidate {
  groupId: string;
  /** Part occurrences from this group, with the date each was recorded. */
  parts: PanelCandidatePart[];
}

/** One qualifying draw date for a panel. */
export interface PanelDraw {
  /** ISO calendar date (YYYY-MM-DD). */
  date: string;
  /** Component parts covered on this date (subset of the panel's parts). */
  coveredPartCids: string[];
  /** Groups contributing at least one part on this date. */
  memberGroupIds: string[];
  /** coveredPartCids.length / expected parts, 0..1. */
  coverage: number;
}

export interface MatchedPanel {
  code: string;
  name: string;
  /** Expected component part CIDs from the crosswalk. */
  partCids: string[];
  /** Qualifying draw dates, latest first. */
  draws: PanelDraw[];
}

export function panelPartCids(
  definition: PanelDefinition,
  crosswalk: Record<string, string[]>
): string[] {
  if (definition.parts && definition.parts.length > 0) return definition.parts;
  return crosswalk[`VAL-LAB-LOINC-${definition.code}`] ?? crosswalk[`VAL-VIT-LOINC-${definition.code}`] ?? [];
}

/**
 * Match panels against the patient's dated part occurrences. For each
 * panel, every date is scored by the distinct expected parts recorded that
 * day; dates meeting the member and coverage floors become draws.
 */
export function matchPanels(
  crosswalk: Record<string, string[]>,
  candidates: PanelCandidate[],
  options: {
    definitions?: readonly PanelDefinition[];
    /** Minimum distinct component parts on the draw date. Default 2. */
    minMembers?: number;
    /** Minimum share of expected parts covered on the draw date. Default 0.66. */
    minCoverage?: number;
  } = {}
): MatchedPanel[] {
  const definitions = options.definitions ?? PANEL_DEFINITIONS;
  const minMembers = options.minMembers ?? 2;
  const minCoverage = options.minCoverage ?? 0.66;
  const panels: MatchedPanel[] = [];

  for (const definition of definitions) {
    const partCids = panelPartCids(definition, crosswalk);
    if (partCids.length < 2) continue;
    const partSet = new Set(partCids);

    // date → { covered parts, contributing groups }
    const byDate = new Map<string, { parts: Set<string>; groups: Set<string> }>();
    for (const candidate of candidates) {
      for (const part of candidate.parts) {
        if (!partSet.has(part.cid)) continue;
        const entry = byDate.get(part.date) ?? { parts: new Set<string>(), groups: new Set<string>() };
        entry.parts.add(part.cid);
        entry.groups.add(candidate.groupId);
        byDate.set(part.date, entry);
      }
    }

    const draws: PanelDraw[] = [];
    for (const [date, { parts, groups }] of byDate) {
      const coverage = parts.size / partCids.length;
      if (parts.size >= minMembers && coverage >= minCoverage) {
        draws.push({
          date,
          coveredPartCids: [...parts],
          memberGroupIds: [...groups],
          coverage
        });
      }
    }
    draws.sort((left, right) => (left.date < right.date ? 1 : -1));
    if (draws.length > 0) {
      panels.push({ ...definition, partCids, draws });
    }
  }
  return panels;
}
