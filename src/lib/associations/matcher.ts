/**
 * Deterministic concept matcher — pure set intersection, no inference.
 *
 * Given the clicked group's resolution (concept key or lab part CIDs) and
 * every other group's resolution, returns related matches with relationship
 * types. Bucket members are resolved to concept keys so dual-coded records
 * (SNOMED + ICD-10 for the same condition) match regardless of which CID
 * the bucket carries.
 */

import type { AssociationBucket, AssociationBundle, MemberProvenance, MemberThreshold } from "./types";
import type { GroupConceptResolution } from "./resolve";

export interface AssociationCandidate {
  groupId: string;
  groupName: string;
  resourceTypes: string[];
  resolution: GroupConceptResolution;
}

export interface RelatedMatch {
  groupId: string;
  groupName: string;
  relationship: AssociationBucket;
  /** Patient-friendly name of the bucket member that produced the match. */
  matchedMemberName: string;
  /** Provenance of the matched member, when the bundle tags it. */
  provenance?: MemberProvenance;
  /** Hub concept the match came through, for "via …" attribution. */
  viaHubName?: string;
  /** v1.2+: inclusive patient-age bounds of the matched member (years). */
  matchedMemberAgeMin?: number;
  matchedMemberAgeMax?: number;
  /** C2 visibility (v2026-09-04.2055+): quantitative gate on the matched
   *  member, e.g. {serum triglycerides, >, 500, mg/dL}. Rendering aid. */
  matchedMemberThreshold?: MemberThreshold;

}

/**
 * Age gate for related-record matches (corpus v1.2 age_min/age_max).
 * Fails OPEN: without a patient age (missing birthDate) nothing is hidden,
 * and members without bounds are always shown.
 */
export function memberWithinAge(
  match: Pick<RelatedMatch, "matchedMemberAgeMin" | "matchedMemberAgeMax">,
  age: number | undefined | null
): boolean {
  if (age === undefined || age === null) return true;
  if (match.matchedMemberAgeMin !== undefined && age < match.matchedMemberAgeMin) return false;
  if (match.matchedMemberAgeMax !== undefined && age > match.matchedMemberAgeMax) return false;
  return true;
}

interface IndexedMember {
  name: string;
  provenance?: MemberProvenance;
  viaHub?: string;
  age_min?: number;
  age_max?: number;
  threshold?: MemberThreshold;
}

interface ConceptBucketIndex {
  /** bucket → member cid → member */
  membersByBucket: Map<AssociationBucket, Map<string, IndexedMember>>;
  /** bucket → concept keys of resolvable members (cond/med anchors) */
  memberConceptsByBucket: Map<AssociationBucket, Set<string>>;
}

const BUCKETS: AssociationBucket[] = [
  "lab",
  "vital",
  "procedure",
  "medication",
  "vaccine",
  "condition",
  "treats",
  // v1.4+ safety-signal buckets — iterated separately from treatment buckets
  // so adverse_effect members surface on their own card section, never pooled
  // with treats (opposite polarity per the Q4 relation-aware decision).
  "adverse_effect",
  "contraindicated_in",
  "interferes_with_test"
];

/**
 * Provenance tiers excluded from default matching, weakest rungs of the
 * v1.8 ladder: population_context ("indicated for use in this population
 * without treating it" — a statin under T2DM), comorbidity_section (pairs
 * from another condition's guideline comorbidity chapter), and
 * panel_cooccurrence (lab co-draw noise — creatinine on a statin because it
 * rides the same metabolic panel). All surface only in loose / discovery
 * mode. Untagged members are class-expansion ingredient CIDs inheriting
 * their drug-class tier, so they follow the class.
 */
const LOOSE_PROVENANCE: ReadonlySet<string> = new Set([
  "population_context",
  "comorbidity_section",
  "panel_cooccurrence"
]);

// v2.2 (2026-08-28): ancestor content is materialized into concept buckets
// at build time with {path: ancestor, parent_cid} attribution. The click-time
// PARENT_UNION_BUCKETS traversal is retired — parity gate verified 930/930
// materialized ⊆ click-union on live v2026-08-28.2224.

function indexConcept(bundle: AssociationBundle, conceptKey: string, includeLoose = false): ConceptBucketIndex | null {
  const concept = bundle.concepts[conceptKey];
  if (!concept) return null;
  const index: ConceptBucketIndex = {
    membersByBucket: new Map(),
    memberConceptsByBucket: new Map()
  };
  for (const bucket of BUCKETS) {
    const members = concept.buckets[bucket];
    if (!members?.length) continue;
    const cidToMember = new Map<string, IndexedMember>();
    const conceptKeys = new Set<string>();
    for (const member of members) {
      if (!includeLoose && member.provenance && LOOSE_PROVENANCE.has(member.provenance)) continue;
      const ancestorParent = member.derivations?.find((d) => d.path === "ancestor")?.parent_cid;
      cidToMember.set(member.cid, {
        name: member.name,
        provenance: member.provenance,
        age_min: member.age_min,
        age_max: member.age_max,
        threshold: member.threshold,
        viaHub: ancestorParent ? bundle.by_cid[ancestorParent] : undefined
      });
      const memberConcept = bundle.by_cid[member.cid];
      if (memberConcept) conceptKeys.add(memberConcept);
    }
    index.membersByBucket.set(bucket, cidToMember);
    index.memberConceptsByBucket.set(bucket, conceptKeys);
  }
  return index;
}

function candidateConceptKeys(resolution: GroupConceptResolution): string[] {
  if (resolution.conceptKeys?.length) return resolution.conceptKeys;
  return resolution.conceptKey ? [resolution.conceptKey] : [];
}

function matchAgainstConcept(
  bundle: AssociationBundle,
  conceptKey: string,
  candidate: AssociationCandidate,
  includeLoose = false
): RelatedMatch | null {
  const index = indexConcept(bundle, conceptKey, includeLoose);
  if (!index) return null;
  const candKeys = candidateConceptKeys(candidate.resolution);
  const candidateParts = candidate.resolution.labPartCids;

  for (const bucket of BUCKETS) {
    const members = index.membersByBucket.get(bucket);
    const memberConcepts = index.memberConceptsByBucket.get(bucket);
    if (!members) continue;

    const matchedConcept = candKeys.find((key) => memberConcepts?.has(key));
    if (matchedConcept) {
      const member = findMemberForConcept(bundle, members, matchedConcept);
      return {
        groupId: candidate.groupId,
        groupName: candidate.groupName,
        relationship: bucket,
        matchedMemberName: member?.name ?? candidate.groupName,
        provenance: member?.provenance,
        viaHubName: member?.viaHub,
        matchedMemberAgeMin: member?.age_min,
        matchedMemberAgeMax: member?.age_max,
        matchedMemberThreshold: member?.threshold
      };
    }
    if (candidateParts?.length && (bucket === "lab" || bucket === "vital")) {
      for (const part of candidateParts) {
        const member = members.get(part);
        if (member) {
          return {
            groupId: candidate.groupId,
            groupName: candidate.groupName,
            relationship: bucket,
            matchedMemberName: member.name,
            provenance: member.provenance,
            viaHubName: member.viaHub,
            matchedMemberAgeMin: member.age_min,
            matchedMemberAgeMax: member.age_max,
            matchedMemberThreshold: member.threshold
          };
        }
      }
    }
  }
  return null;
}

function findMemberForConcept(
  bundle: AssociationBundle,
  members: Map<string, IndexedMember>,
  conceptKey: string
): IndexedMember | undefined {
  for (const [cid, member] of members) {
    if (bundle.by_cid[cid] === conceptKey) return member;
  }
  return undefined;
}

/**
 * Find patient groups related to the clicked focus.
 *
 * Focus can be a concept (medication/condition/procedure/vaccine click) or a
 * lab (part CIDs from a lab click — matched against every candidate concept's
 * lab bucket).
 */
export async function findRelatedGroups(
  focus: { groupId: string; resolution: GroupConceptResolution },
  candidates: AssociationCandidate[],
  options: { includeLooseProvenance?: boolean } = {}
): Promise<RelatedMatch[]> {
  const { loadAssociationBundle } = await import("./bundle");
  const bundle = await loadAssociationBundle();
  const includeLoose = options.includeLooseProvenance === true;

  const matches: RelatedMatch[] = [];
  const focusKeys = candidateConceptKeys(focus.resolution);
  if (focusKeys.length > 0) {
    for (const candidate of candidates) {
      if (candidate.groupId === focus.groupId) continue;
      // Combos fan across every ingredient concept; the first ingredient
      // that yields a match wins (one badge per related item).
      for (const key of focusKeys) {
        const match = matchAgainstConcept(bundle, key, candidate, includeLoose);
        if (match) {
          matches.push(match);
          break;
        }
      }
    }
    return matches;
  }

  const focusParts = focus.resolution.labPartCids ?? [];
  if (focusParts.length === 0) return [];
  for (const candidate of candidates) {
    if (candidate.groupId === focus.groupId) continue;
    const candidateConcept = candidate.resolution.conceptKey;
    if (!candidateConcept) continue;
    const index = indexConcept(bundle, candidateConcept, includeLoose);
    for (const bucket of ["lab", "vital"] as const) {
      const members = index?.membersByBucket.get(bucket);
      if (!members) continue;
      for (const part of focusParts) {
        const member = members.get(part);
        if (member) {
          matches.push({
            groupId: candidate.groupId,
            groupName: candidate.groupName,
            relationship: bucket,
            matchedMemberName: member.name,
            provenance: member.provenance,
            viaHubName: member.viaHub
          });
          break;
        }
      }
      if (matches.some((m) => m.groupId === candidate.groupId)) break;
    }
  }
  return matches;
}

export function relationshipLabel(
  relationship: AssociationBucket,
  focusIsCondition: boolean,
  provenance?: MemberProvenance
): string {
  if (relationship === "lab") return "Lab to monitor";
  if (relationship === "vital") return "Vital to monitor";
  if (relationship === "treats" || relationship === "medication") {
    // v1.7 provenance tiers render honestly: event_prevention members are
    // prescribed to prevent complications, not to treat the condition.
    if (provenance === "event_prevention" || provenance === "preventive_indication") return "Helps prevent";
    if (provenance === "population_context") return "Used for";
    if (provenance === "comorbidity_section") return "Associated with";
    return focusIsCondition ? "Treats this" : "Treats";
  }
  if (relationship === "condition") return focusIsCondition ? "Related condition" : "Adverse event";
  if (relationship === "procedure") return "Related procedure";
  if (relationship === "vaccine") return "Related vaccine";
  // v1.4 safety-signal buckets: opposite polarity to treats, distinct
  // prefixes so patients can't misread a safety chip as a treatment.
  if (relationship === "adverse_effect") return "Caution: may cause";
  if (relationship === "contraindicated_in") return "Avoid with this";
  if (relationship === "interferes_with_test") return "May interfere with";
  return "Related";
}
