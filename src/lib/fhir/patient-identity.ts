/**
 * Which portal belongs to which person, when the automatic decision is wrong.
 *
 * fhir4ds matching groups the portals that look like one person; the patient
 * selector lists those groups. A user who knows better says, for one portal,
 * "this is the same person as that portal" or "this one stands alone". The
 * choice is stored per session, next to the rest of the local data, and the
 * portal that was last shown is stored with it.
 */


import {
  groupProfilesByKeys,
  groupProfilesByPatient,
  patientIdentityKey,
  type PatientIdentity,
  type PatientProfileLike
} from "./patient-header";

export const PATIENT_IDENTITY_ID = "patient-identity";

/**
 * Whether the shown person's portals contradict fhir4ds matching. Only when
 * they are all left to the automatic decision: a placement is the user's
 * answer, and the hint must not argue with it.
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

/** What the user says about one portal's patient. */
export type PatientIdentityPlacement =
  | { kind: "auto" }
  | { kind: "alone" }
  | { kind: "sameAs"; sourceId: string };

export interface PatientIdentityOverride {
  /** The portal whose patient is being placed. */
  sourceId: string;
  /** The portal it belongs with; null means it stands alone. */
  sameAs: string | null;
}

export interface PatientIdentityRecord {
  id: string;
  overrides: PatientIdentityOverride[];
  /** The portal whose person was shown last. */
  selectedSourceId?: string | null;
}

/**
 * The people behind the connected portals. The automatic decision is "same
 * name and birth date", plus any pair fhir4ds reported as one person; the
 * user's placements are applied last, one portal at a time.
 */
export function resolvePatientIdentities<T extends PatientProfileLike>(
  profiles: T[],
  options: {
    matchedByFhir4ds?: (left: T, right: T) => boolean;
    overrides?: ReadonlyMap<string, PatientIdentityOverride>;
  } = {}
): PatientIdentity<T>[] {
  const automatic = groupProfilesByPatient(
    profiles,
    (left, right) =>
      patientIdentityKey(left.patient) === patientIdentityKey(right.patient) ||
      options.matchedByFhir4ds?.(left, right) === true
  );
  const overrides = options.overrides ?? new Map<string, PatientIdentityOverride>();
  if (overrides.size === 0) return automatic;

  const automaticKeyBySourceId = new Map<string, string>();
  for (const identity of automatic) {
    for (const profile of identity.profiles) automaticKeyBySourceId.set(profile.sourceId, identity.key);
  }

  const finalKeyBySourceId = new Map<string, string>();
  for (const [sourceId, automaticKey] of automaticKeyBySourceId) {
    const override = overrides.get(sourceId);
    if (!override) {
      finalKeyBySourceId.set(sourceId, automaticKey);
      continue;
    }
    if (override.sameAs === null) {
      finalKeyBySourceId.set(sourceId, `alone:${sourceId}`);
      continue;
    }
    const targetOverride = overrides.get(override.sameAs);
    const targetKey =
      targetOverride?.sameAs === null
        ? `alone:${override.sameAs}`
        : automaticKeyBySourceId.get(targetOverride?.sameAs ?? override.sameAs) ?? automaticKey;
    finalKeyBySourceId.set(sourceId, targetKey);
  }
  return groupProfilesByKeys(profiles, finalKeyBySourceId);
}

export function emptyPatientIdentityRecord(): PatientIdentityRecord {
  return { id: PATIENT_IDENTITY_ID, overrides: [], selectedSourceId: null };
}

/** The stored record's overrides, by the portal they place. */
export function overridesBySourceId(record: PatientIdentityRecord | null): Map<string, PatientIdentityOverride> {
  const map = new Map<string, PatientIdentityOverride>();
  for (const override of record?.overrides ?? []) map.set(override.sourceId, override);
  return map;
}

/**
 * Set one portal's placement and drop overrides that point at portals which
 * are gone, so a stale record cannot keep two people apart.
 */
export function withIdentityOverride(
  record: PatientIdentityRecord,
  override: PatientIdentityOverride,
  connectedSourceIds: ReadonlySet<string>
): PatientIdentityRecord {
  const overrides = record.overrides.filter(
    (entry) => entry.sourceId !== override.sourceId && connectedSourceIds.has(entry.sourceId)
  );
  if (override.sameAs !== null && !connectedSourceIds.has(override.sameAs)) return { ...record, overrides };
  overrides.push(override);
  return { ...record, overrides };
}

export function withSelectedSourceId(
  record: PatientIdentityRecord,
  selectedSourceId: string | null
): PatientIdentityRecord {
  return { ...record, selectedSourceId };
}
