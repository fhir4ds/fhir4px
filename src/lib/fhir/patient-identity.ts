/**
 * Which portal belongs to which person, when the automatic decision is wrong.
 *
 * Every person is named by exactly one of its portals — the one that selects
 * its own patient name. The others select "same as" that portal, so the graph
 * is one level deep: pointers always point at a naming portal, never at
 * another pointer. fhir4ds matching (plus name and birth date) decides the
 * defaults; the user can hand the name to another portal, take it back, or
 * point a portal at a name. The choices are stored per session, with the
 * portal that was shown last.
 */

import {
  groupProfilesByPatient,
  patientDisplayName,
  patientIdentityKey,
  type PatientIdentity,
  type PatientProfileLike
} from "./patient-header";

export const PATIENT_IDENTITY_ID = "patient-identity";

/**
 * Whether the shown person's portals contradict fhir4ds matching. Only when
 * they are all left to the automatic decision: a choice of person is the
 * user's answer, and the hint must not argue with it.
 */
export function groupMatchMismatch(options: {
  /** The portals grouped under the person. */
  sourceIds: string[];
  /** Profile index of each portal, as fhir4ds matching numbered them. */
  indexBySourceId: ReadonlyMap<string, number>;
  /** Portals the user placed by hand. */
  overridden: ReadonlySet<string>;
  verdict: "same" | "different" | "unconfirmed" | null;
  /** The pairs matching reported as not the same person. */
  pairs: ReadonlyArray<{ first: number; second: number }>;
}): { portalCount: number; verdict: "different" | "unconfirmed" } | null {
  if (options.sourceIds.length < 2) return null;
  if (options.sourceIds.some((sourceId) => options.overridden.has(sourceId))) return null;
  if (options.verdict !== "different" && options.verdict !== "unconfirmed") return null;
  const inside = new Set(
    options.sourceIds
      .map((sourceId) => options.indexBySourceId.get(sourceId))
      .filter((index): index is number => index !== undefined)
  );
  const disagrees = options.pairs.some((pair) => inside.has(pair.first) && inside.has(pair.second));
  return disagrees ? { portalCount: options.sourceIds.length, verdict: options.verdict } : null;
}

export interface PatientIdentityOverride {
  /** The portal this entry decides. */
  sourceId: string;
  /** The portal that names the person this one belongs to; null means this
   * portal names the person itself. */
  sameAs: string | null;
}

export interface PatientIdentityRecord {
  id: string;
  overrides: PatientIdentityOverride[];
  /** The portal whose person was shown last. */
  selectedSourceId?: string | null;
}

export function emptyPatientIdentityRecord(): PatientIdentityRecord {
  return { id: PATIENT_IDENTITY_ID, overrides: [], selectedSourceId: null };
}

/** The stored record's overrides, by the portal they decide. */
export function overridesBySourceId(record: PatientIdentityRecord | null): Map<string, PatientIdentityOverride> {
  const map = new Map<string, PatientIdentityOverride>();
  for (const override of record?.overrides ?? []) map.set(override.sourceId, override);
  return map;
}

/**
 * The portals the automatic decision groups together, and the naming portal
 * of each group: the portal with the most complete name, because a person's
 * name has to be one of its portals' own names.
 */
function automaticAnchorMap<T extends PatientProfileLike>(
  profiles: T[],
  matchedByFhir4ds?: (left: T, right: T) => boolean
): Map<string, string> {
  const identities = groupProfilesByPatient(
    profiles,
    (left, right) =>
      patientIdentityKey(left.patient) === patientIdentityKey(right.patient) ||
      matchedByFhir4ds?.(left, right) === true
  );
  const anchorBySourceId = new Map<string, string>();
  for (const identity of identities) {
    const anchor = [...identity.profiles].sort(
      (left, right) =>
        patientDisplayName(right.patient).length - patientDisplayName(left.patient).length ||
        left.sourceId.localeCompare(right.sourceId)
    )[0];
    for (const profile of identity.profiles) anchorBySourceId.set(profile.sourceId, anchor.sourceId);
  }
  return anchorBySourceId;
}

/** The naming portal of each portal, by the automatic decision alone. */
export function automaticAnchors<T extends PatientProfileLike>(
  profiles: T[],
  matchedByFhir4ds?: (left: T, right: T) => boolean
): Map<string, string> {
  return automaticAnchorMap(profiles, matchedByFhir4ds);
}

/**
 * The people behind the connected portals. Automatic groups first, then the
 * stored choices: a portal names its person, or points at the portal that
 * does. A pointer that would form a cycle falls back to the automatic answer
 * for the portal that closes it.
 */
export function resolvePatientIdentities<T extends PatientProfileLike>(
  profiles: T[],
  options: {
    matchedByFhir4ds?: (left: T, right: T) => boolean;
    overrides?: ReadonlyMap<string, PatientIdentityOverride>;
  } = {}
): PatientIdentity<T>[] {
  const anchorBySourceId = automaticAnchorMap(profiles, options.matchedByFhir4ds);
  const overrides = options.overrides ?? new Map<string, PatientIdentityOverride>();
  const bySourceId = new Map(profiles.map((profile) => [profile.sourceId, profile] as const));

  // Where a portal points: itself, another portal, or the automatic answer.
  const pointerOf = (sourceId: string): string => {
    const automatic = anchorBySourceId.get(sourceId) ?? sourceId;
    const override = overrides.get(sourceId);
    if (!override) return automatic;
    if (override.sameAs === null) return sourceId;
    return bySourceId.has(override.sameAs) ? override.sameAs : automatic;
  };
  const anchorOf = (sourceId: string): string => {
    let current = sourceId;
    const seen = new Set<string>();
    while (!seen.has(current)) {
      seen.add(current);
      const next = pointerOf(current);
      if (next === current) return current;
      current = next;
    }
    // A cycle: the automatic answer of the portal that closed it wins.
    return anchorBySourceId.get(sourceId) ?? sourceId;
  };

  const groups = new Map<string, T[]>();
  for (const profile of profiles) {
    const anchor = anchorOf(profile.sourceId);
    const members = groups.get(anchor) ?? [];
    members.push(profile);
    groups.set(anchor, members);
  }

  return [...groups.entries()].map(([anchor, members]) => ({
    key: anchor,
    name: patientDisplayName(bySourceId.get(anchor)?.patient ?? members[0].patient),
    profiles: members
  }));
}

/**
 * Record a choice made on one row: `sameAs` names the portal that should name
 * the person. Choosing the row's own portal means "this one names it".
 *
 * The portals that pointed at this one move with it, and the portal that is
 * about to name the person stops pointing at anyone, so no chain is left
 * behind. Choices that agree with the automatic answer are not stored.
 */
export function applyAssociation(
  record: PatientIdentityRecord,
  options: {
    sourceId: string;
    sameAs: string;
    /** The connected portals. */
    connected: ReadonlySet<string>;
    /** The naming portal of each portal, by the automatic decision. */
    automaticAnchorBySourceId: ReadonlyMap<string, string>;
  }
): PatientIdentityRecord {
  const { sourceId, sameAs, connected, automaticAnchorBySourceId } = options;
  const overrides = new Map(
    record.overrides.filter((entry) => connected.has(entry.sourceId)).map((entry) => [entry.sourceId, entry] as const)
  );
  const dependsOn = (anchor: string) =>
    [...overrides.values()].filter((entry) => entry.sameAs === anchor).map((entry) => entry.sourceId);

  const nameItself = (portal: string) => {
    if (automaticAnchorBySourceId.get(portal) === portal) overrides.delete(portal);
    else overrides.set(portal, { sourceId: portal, sameAs: null });
  };

  if (sameAs === sourceId) {
    // This portal names its person; everyone who pointed at it stays.
    nameItself(sourceId);
  } else {
    // Hand the name to the other portal, and move this portal's group with it.
    const dependents = dependsOn(sourceId).filter((dependent) => dependent !== sameAs);
    nameItself(sameAs);
    for (const dependent of dependents) overrides.set(dependent, { sourceId: dependent, sameAs });
    if (automaticAnchorBySourceId.get(sourceId) === sameAs) overrides.delete(sourceId);
    else overrides.set(sourceId, { sourceId, sameAs });
  }

  return { ...record, overrides: [...overrides.values()] };
}

/** Forget every hand-made choice: the matching decides again. */
export function clearAssociations(record: PatientIdentityRecord): PatientIdentityRecord {
  return { ...record, overrides: [] };
}

export function withSelectedSourceId(
  record: PatientIdentityRecord,
  selectedSourceId: string | null
): PatientIdentityRecord {
  return { ...record, selectedSourceId };
}
