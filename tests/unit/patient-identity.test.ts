import { describe, expect, it } from "vitest";
import { resolvePatientIdentities, withIdentityOverride, emptyPatientIdentityRecord } from "../../src/lib/fhir/patient-identity";
import type { PatientProfileLike } from "../../src/lib/fhir/patient-header";
import type { FhirResource } from "../../src/lib/smart/data";

function profile(sourceId: string, name: string, birthDate: string): PatientProfileLike {
  return {
    sourceId,
    portalName: `Portal ${sourceId}`,
    patient: {
      resourceType: "Patient",
      id: `patient-${sourceId}`,
      name: [{ family: name }],
      birthDate
    } as unknown as FhirResource
  };
}

const camila = profile("a", "Lopez", "1987-09-12");
const camilaVariant = profile("b", "Lopes", "1987-09-12");
const omar = profile("c", "Haddad", "1980-05-30");

describe("resolvePatientIdentities", () => {
  it("groups by name and birth date on its own", () => {
    const identities = resolvePatientIdentities([camila, camilaVariant, omar]);

    expect(identities.map((identity) => identity.profiles.map((entry) => entry.sourceId))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("groups portals that fhir4ds matched, whatever the names say", () => {
    const identities = resolvePatientIdentities([camila, camilaVariant], {
      matchedByFhir4ds: (left, right) => left.sourceId === "a" && right.sourceId === "b"
    });

    expect(identities).toHaveLength(1);
    expect(identities[0].profiles.map((entry) => entry.sourceId)).toEqual(["a", "b"]);
  });

  it("joins a portal to another person when the user says so", () => {
    const identities = resolvePatientIdentities([camila, omar], {
      overrides: new Map([["c", { sourceId: "c", sameAs: "a" }]])
    });

    expect(identities.map((identity) => identity.profiles.map((entry) => entry.sourceId))).toEqual([["a", "c"]]);
    expect(identities[0].name).toBe("Lopez");
  });

  it("splits a portal off when the user says it is someone else", () => {
    const identical = profile("d", "Lopez", "1987-09-12");
    const identities = resolvePatientIdentities([camila, identical], {
      overrides: new Map([["d", { sourceId: "d", sameAs: null }]])
    });

    expect(identities.map((identity) => identity.profiles.map((entry) => entry.sourceId))).toEqual([["a"], ["d"]]);
  });

  it("leaves everything alone while the background match has not reported", () => {
    const identities = resolvePatientIdentities([camila, camilaVariant], { matchedByFhir4ds: () => false });

    expect(identities).toHaveLength(2);
  });
});

describe("withIdentityOverride", () => {
  it("replaces a portal's placement and drops ones that point at a gone portal", () => {
    const connected = new Set(["a", "b"]);
    const start = emptyPatientIdentityRecord();
    const withStale = withIdentityOverride(start, { sourceId: "b", sameAs: "gone" }, connected);
    expect(withStale.overrides).toEqual([]);

    const first = withIdentityOverride(start, { sourceId: "b", sameAs: "a" }, connected);
    const second = withIdentityOverride(first, { sourceId: "b", sameAs: null }, connected);

    expect(second.overrides).toEqual([{ sourceId: "b", sameAs: null }]);
  });

  it("forgets placements for portals that are no longer connected", () => {
    const connected = new Set(["a"]);
    const record = emptyPatientIdentityRecord();
    record.overrides = [
      { sourceId: "a", sameAs: null },
      { sourceId: "gone", sameAs: null }
    ];

    const next = withIdentityOverride(record, { sourceId: "a", sameAs: null }, connected);

    expect(next.overrides).toEqual([{ sourceId: "a", sameAs: null }]);
  });
});
