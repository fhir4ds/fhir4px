/**
 * Deterministic concept matcher — pure set intersection, no inference.
 *
 * Given the clicked group's resolution (concept key or lab part CIDs) and
 * every other group's resolution, returns related matches with relationship
 * types. Bucket members are resolved to concept keys so dual-coded records
 * (SNOMED + ICD-10 for the same condition) match regardless of which CID
 * the bucket carries.
 */

import type { AssociationBucket, AssociationBundle, MemberProvenance } from "./types";
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
}

interface IndexedMember {
  name: string;
  provenance?: MemberProvenance;
  viaHub?: string;
}

interface ConceptBucketIndex {
  /** bucket → member cid → member */
  membersByBucket: Map<AssociationBucket, Map<string, IndexedMember>>;
  /** bucket → concept keys of resolvable members (cond/med anchors) */
  memberConceptsByBucket: Map<AssociationBucket, Set<string>>;
}

const BUCKETS: AssociationBucket[] = ["lab", "vital", "procedure", "medication", "vaccine", "condition", "treats"];

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

/**
 * Buckets unioned from parent (hub) concepts at click time. Monitor types
 * only, per the IS_A default-deny allowlist — hub treats/medication members
 * (e.g. the DM hub's insulins) must not badge on a subtype click because
 * treats edges are not truth-preserving downward.
 */
const PARENT_UNION_BUCKETS: ReadonlySet<AssociationBucket> = new Set(["lab", "vital", "procedure"]);

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
      cidToMember.set(member.cid, { name: member.name, provenance: member.provenance });
      const memberConcept = bundle.by_cid[member.cid];
      if (memberConcept) conceptKeys.add(memberConcept);
    }
    index.membersByBucket.set(bucket, cidToMember);
    index.memberConceptsByBucket.set(bucket, conceptKeys);
  }

  for (const parentCid of concept.parent_cids ?? []) {
    const parentKey = bundle.by_cid[parentCid];
    const parent = parentKey ? bundle.concepts[parentKey] : undefined;
    if (!parent) continue;
    for (const bucket of PARENT_UNION_BUCKETS) {
      const members = parent.buckets[bucket];
      if (!members?.length) continue;
      let cidToMember = index.membersByBucket.get(bucket);
      let conceptKeys = index.memberConceptsByBucket.get(bucket);
      if (!cidToMember || !conceptKeys) {
        cidToMember = new Map();
        conceptKeys = new Set();
        index.membersByBucket.set(bucket, cidToMember);
        index.memberConceptsByBucket.set(bucket, conceptKeys);
      }
      for (const member of members) {
        if (!includeLoose && member.provenance && LOOSE_PROVENANCE.has(member.provenance)) continue;
        // Direct evidence wins — never overwrite an own-bucket member with
        // the hub's copy of the same concept.
        if (cidToMember.has(member.cid)) continue;
        cidToMember.set(member.cid, { name: member.name, provenance: member.provenance, viaHub: parent.name });
        const memberConcept = bundle.by_cid[member.cid];
        if (memberConcept) conceptKeys.add(memberConcept);
      }
    }
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
      const member = findMemberForConcept(bundle, members, candidateConcept);
      return {
        groupId: candidate.groupId,
        groupName: candidate.groupName,
        relationship: bucket,
        matchedMemberName: member?.name ?? candidate.groupName,
        provenance: member?.provenance,
        viaHubName: member?.viaHub
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
            viaHubName: member.viaHub
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
    if (provenance === "event_prevention") return "Helps prevent";
    if (provenance === "population_context") return "Used for";
    if (provenance === "comorbidity_section") return "Associated with";
    return focusIsCondition ? "Treats this" : "Treats";
  }
  if (relationship === "condition") return focusIsCondition ? "Related condition" : "Adverse event";
  if (relationship === "procedure") return "Related procedure";
  if (relationship === "vaccine") return "Related vaccine";
  return "Related";
}
