/**
 * Deterministic concept matcher — pure set intersection, no inference.
 *
 * Given the clicked group's resolution (concept key or lab part CIDs) and
 * every other group's resolution, returns related matches with relationship
 * types. Bucket members are resolved to concept keys so dual-coded records
 * (SNOMED + ICD-10 for the same condition) match regardless of which CID
 * the bucket carries.
 */

import type { AssociationBucket, AssociationBundle } from "./types";
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
}

interface ConceptBucketIndex {
  /** bucket → member cid → member name */
  membersByBucket: Map<AssociationBucket, Map<string, string>>;
  /** bucket → concept keys of resolvable members (cond/med anchors) */
  memberConceptsByBucket: Map<AssociationBucket, Set<string>>;
}

const BUCKETS: AssociationBucket[] = ["lab", "vital", "procedure", "medication", "vaccine", "condition", "treats"];

/**
 * Provenance tiers excluded from default matching: disease_context is
 * comorbidity co-occurrence (a statin listed under a condition it doesn't
 * treat), panel_cooccurrence is lab co-draw noise (creatinine on a statin
 * because it rides the same metabolic panel). Both surface only in loose /
 * discovery mode.
 */
const LOOSE_PROVENANCE: ReadonlySet<string> = new Set(["disease_context", "panel_cooccurrence"]);

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
    const cidToName = new Map<string, string>();
    const conceptKeys = new Set<string>();
    for (const member of members) {
      if (!includeLoose && member.provenance && LOOSE_PROVENANCE.has(member.provenance)) continue;
      cidToName.set(member.cid, member.name);
      const memberConcept = bundle.by_cid[member.cid];
      if (memberConcept) conceptKeys.add(memberConcept);
    }
    index.membersByBucket.set(bucket, cidToName);
    index.memberConceptsByBucket.set(bucket, conceptKeys);
  }
  return index;
}

function matchAgainstConcept(
  bundle: AssociationBundle,
  conceptKey: string,
  candidate: AssociationCandidate,
  includeLoose = false
): RelatedMatch | null {
  const index = indexConcept(bundle, conceptKey, includeLoose);
  if (!index) return null;
  const candidateConcept = candidate.resolution.conceptKey;
  const candidateParts = candidate.resolution.labPartCids;

  for (const bucket of BUCKETS) {
    const members = index.membersByBucket.get(bucket);
    const memberConcepts = index.memberConceptsByBucket.get(bucket);
    if (!members) continue;

    if (candidateConcept && memberConcepts?.has(candidateConcept)) {
      const memberName = findMemberNameForConcept(bundle, members, candidateConcept) ?? candidate.groupName;
      return {
        groupId: candidate.groupId,
        groupName: candidate.groupName,
        relationship: bucket,
        matchedMemberName: memberName
      };
    }
    if (candidateParts?.length && (bucket === "lab" || bucket === "vital")) {
      for (const part of candidateParts) {
        if (members.has(part)) {
          return {
            groupId: candidate.groupId,
            groupName: candidate.groupName,
            relationship: bucket,
            matchedMemberName: members.get(part) ?? candidate.groupName
          };
        }
      }
    }
  }
  return null;
}

function findMemberNameForConcept(
  bundle: AssociationBundle,
  members: Map<string, string>,
  conceptKey: string
): string | undefined {
  for (const [cid, name] of members) {
    if (bundle.by_cid[cid] === conceptKey) return name;
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
  if (focus.resolution.conceptKey) {
    for (const candidate of candidates) {
      if (candidate.groupId === focus.groupId) continue;
      const match = matchAgainstConcept(bundle, focus.resolution.conceptKey, candidate, includeLoose);
      if (match) matches.push(match);
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
        if (members.has(part)) {
          matches.push({
            groupId: candidate.groupId,
            groupName: candidate.groupName,
            relationship: bucket,
            matchedMemberName: members.get(part) ?? candidate.groupName
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
  focusIsCondition: boolean
): string {
  if (relationship === "lab") return "Lab to monitor";
  if (relationship === "vital") return "Vital to monitor";
  if (relationship === "treats") return "Treats";
  if (relationship === "medication") return "Treats this";
  if (relationship === "condition") return focusIsCondition ? "Related condition" : "Adverse event";
  if (relationship === "procedure") return "Related procedure";
  if (relationship === "vaccine") return "Related vaccine";
  return "Related";
}
