import { describe, expect, it } from "vitest";
import {
  applyAssociation,
  automaticAnchors,
  clearAssociations,
  emptyPatientIdentityRecord,
  groupMatchMismatch,
  resolvePatientIdentities,
  withSelectedSourceId,
  type PatientIdentityOverride,
  type PatientIdentityRecord
} from "../../src/lib/fhir/patient-identity";
import type { PatientProfileLike } from "../../src/lib/fhir/patient-header";
import type { FhirResource } from "../../src/lib/smart/data";

function profile(sourceId: string, given: string[], family: string, birthDate = "1987-09-12"): PatientProfileLike {
  return {
    sourceId,
    portalName: `Portal ${sourceId}`,
    patient: {
      resourceType: "Patient",
      id: `patient-${sourceId}`,
      name: [{ family, given }],
      birthDate
    } as unknown as FhirResource
  };
}

const short = profile("a", ["Camila", "M"], "Lopez");
const full = profile("b", ["Camila", "Maria"], "Lopez");
const omar = profile("c", ["Omar"], "Haddad", "1980-05-30");

function record(overrides: PatientIdentityOverride[]): PatientIdentityRecord {
  return { ...emptyPatientIdentityRecord(), overrides };
}

function byOverrides(overrides: PatientIdentityOverride[]) {
  return new Map(overrides.map((entry) => [entry.sourceId, entry] as const));
}

const connected = new Set(["a", "b", "c"]);

describe("automaticAnchors", () => {
  it("names a matched pair after the more complete name", () => {
    const anchors = automaticAnchors([short, full], () => true);

    expect(anchors.get("a")).toBe("b");
    expect(anchors.get("b")).toBe("b");
  });

  it("lets every portal name itself when matching keeps them apart", () => {
    const anchors = automaticAnchors([short, full], () => false);

    expect(anchors.get("a")).toBe("a");
    expect(anchors.get("b")).toBe("b");
  });
});

describe("resolvePatientIdentities", () => {
  it("groups by name and birth date on its own", () => {
    const identities = resolvePatientIdentities([short, omar]);

    expect(identities.map((identity) => identity.profiles.map((entry) => entry.sourceId))).toEqual([["a"], ["c"]]);
  });

  it("groups portals that fhir4ds matched", () => {
    const identities = resolvePatientIdentities([short, full], {
      matchedByFhir4ds: (left, right) => left.sourceId !== right.sourceId
    });

    expect(identities).toHaveLength(1);
    expect(identities[0].profiles.map((entry) => entry.sourceId)).toEqual(["a", "b"]);
    expect(identities[0].name).toBe("Camila Maria Lopez");
    expect(identities[0].key).toBe("b");
  });

  it("puts a portal with the portal it points at", () => {
    const identities = resolvePatientIdentities([short, omar], {
      matchedByFhir4ds: () => false,
      overrides: byOverrides([{ sourceId: "c", sameAs: "a" }])
    });

    expect(identities).toHaveLength(1);
    expect(identities[0].profiles.map((entry) => entry.sourceId)).toEqual(["a", "c"]);
    expect(identities[0].name).toBe("Camila M Lopez");
  });

  it("takes a portal out of a matched pair when it names itself", () => {
    const identities = resolvePatientIdentities([short, full], {
      matchedByFhir4ds: () => true,
      overrides: byOverrides([{ sourceId: "a", sameAs: null }])
    });

    expect(identities.map((identity) => identity.profiles.map((entry) => entry.sourceId))).toEqual([["a"], ["b"]]);
  });

  it("follows a pointer even when the portal it names does not name itself", () => {
    const identities = resolvePatientIdentities([short, full, omar], {
      matchedByFhir4ds: () => false,
      overrides: byOverrides([
        { sourceId: "a", sameAs: "b" },
        { sourceId: "b", sameAs: "c" }
      ])
    });

    expect(identities.map((identity) => identity.profiles.map((entry) => entry.sourceId))).toEqual([["a", "b", "c"]]);
    expect(identities[0].name).toBe("Omar Haddad");
  });

  it("survives a cycle without losing a portal", () => {
    const identities = resolvePatientIdentities([short, full], {
      matchedByFhir4ds: () => false,
      overrides: byOverrides([
        { sourceId: "a", sameAs: "b" },
        { sourceId: "b", sameAs: "a" }
      ])
    });

    expect(identities.flatMap((identity) => identity.profiles.map((entry) => entry.sourceId)).sort()).toEqual(["a", "b"]);
  });
});

describe("applyAssociation", () => {
  it("does not store a choice that agrees with matching", () => {
    const anchors = automaticAnchors([short, full], () => true);

    // a already belongs with b by matching, so pointing it at b changes nothing.
    const next = applyAssociation(record([]), {
      sourceId: "a",
      sameAs: "b",
      connected,
      automaticAnchorBySourceId: anchors
    });

    expect(next.overrides).toEqual([]);
  });

  it("hands the name to the portal that is chosen", () => {
    const anchors = automaticAnchors([short, full], () => true);
    // b names the person by matching; a chooses "same as b" — no change.
    // Now b chooses a instead: the name moves to a.
    const next = applyAssociation(record([]), {
      sourceId: "b",
      sameAs: "a",
      connected,
      automaticAnchorBySourceId: anchors
    });

    expect(next.overrides).toEqual([
      { sourceId: "a", sameAs: null },
      { sourceId: "b", sameAs: "a" }
    ]);

    const identities = resolvePatientIdentities([short, full], {
      matchedByFhir4ds: () => true,
      overrides: byOverrides(next.overrides)
    });
    expect(identities).toHaveLength(1);
    expect(identities[0].name).toBe("Camila M Lopez");
  });

  it("moves the portals that pointed at a portal along with it", () => {
    const anchors = automaticAnchors([short, full, omar], () => false);
    const before = record([
      { sourceId: "a", sameAs: null },
      { sourceId: "c", sameAs: "a" }
    ]);

    const next = applyAssociation(before, {
      sourceId: "a",
      sameAs: "b",
      connected,
      automaticAnchorBySourceId: anchors
    });

    // b names itself by the automatic decision, so it needs no entry.
    expect(new Map(next.overrides.map((entry) => [entry.sourceId, entry.sameAs]))).toEqual(
      new Map([
        ["a", "b"],
        ["c", "b"]
      ])
    );

    const identities = resolvePatientIdentities([short, full, omar], {
      matchedByFhir4ds: () => false,
      overrides: byOverrides(next.overrides)
    });
    expect(identities).toHaveLength(1);
    expect(identities[0].name).toBe("Camila Maria Lopez");
  });

  it("lets a portal name itself again", () => {
    const anchors = automaticAnchors([short, full], () => true);
    const before = record([{ sourceId: "a", sameAs: "b" }]);

    const next = applyAssociation(before, {
      sourceId: "a",
      sameAs: "a",
      connected,
      automaticAnchorBySourceId: anchors
    });

    expect(next.overrides).toEqual([{ sourceId: "a", sameAs: null }]);
  });

  it("forgets portals that are no longer connected", () => {
    // Matching puts a with b, so a naming itself has to be stored.
    const anchors = automaticAnchors([short, full], () => true);
    const before = record([
      { sourceId: "gone", sameAs: null },
      { sourceId: "a", sameAs: "gone" }
    ]);

    const next = applyAssociation(before, {
      sourceId: "a",
      sameAs: "a",
      connected: new Set(["a", "b"]),
      automaticAnchorBySourceId: anchors
    });

    expect(next.overrides).toEqual([{ sourceId: "a", sameAs: null }]);
  });
});

describe("clearAssociations", () => {
  it("leaves only the shown portal", () => {
    const next = clearAssociations(withSelectedSourceId(record([{ sourceId: "a", sameAs: null }]), "a"));

    expect(next.overrides).toEqual([]);
    expect(next.selectedSourceId).toBe("a");
  });
});

describe("groupMatchMismatch", () => {
  const indexBySourceId = new Map([
    ["a", 0],
    ["b", 1],
    ["c", 2]
  ]);
  const pair = { first: 0, second: 1 };

  it("flags a person whose portals the matching calls different people", () => {
    expect(
      groupMatchMismatch({
        sourceIds: ["a", "b"],
        indexBySourceId,
        overridden: new Set(),
        verdict: "different",
        pairs: [pair]
      })
    ).toEqual({ portalCount: 2, verdict: "different" });
  });

  it("flags an undecided pair as unconfirmed", () => {
    expect(
      groupMatchMismatch({
        sourceIds: ["a", "b"],
        indexBySourceId,
        overridden: new Set(),
        verdict: "unconfirmed",
        pairs: [pair]
      })
    ).toEqual({ portalCount: 2, verdict: "unconfirmed" });
  });

  it("says nothing about a single portal, or a pair outside the group", () => {
    expect(
      groupMatchMismatch({ sourceIds: ["a"], indexBySourceId, overridden: new Set(), verdict: "different", pairs: [pair] })
    ).toBeNull();
    expect(
      groupMatchMismatch({
        sourceIds: ["a", "c"],
        indexBySourceId,
        overridden: new Set(),
        verdict: "different",
        pairs: [pair]
      })
    ).toBeNull();
  });

  it("stays quiet once the user has chosen by hand", () => {
    expect(
      groupMatchMismatch({
        sourceIds: ["a", "b"],
        indexBySourceId,
        overridden: new Set(["b"]),
        verdict: "different",
        pairs: [pair]
      })
    ).toBeNull();
  });
});
