import { describe, expect, it } from "vitest";
import { groupProfilesByPatient, headerPatientFor, patientIdentityKey, patientHeaderInfo } from "../../src/lib/fhir/patient-header";
import type { FhirResource } from "../../src/lib/smart/data";

/** A local-calendar birth date that makes the patient an exact number of
 * years old today (the age is computed on local dates). */
function birthDateYearsAgo(years: number): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function patient(overrides: Partial<FhirResource> & Record<string, unknown>): FhirResource {
  return {
    resourceType: "Patient",
    id: "p1",
    name: [{ family: "Mensah", given: ["Grace"], use: "official" }],
    gender: "female",
    birthDate: birthDateYearsAgo(68),
    address: [{ line: ["912 Highway 14"], city: "Cadillac", state: "MI", postalCode: "49601" }],
    telecom: [
      { system: "phone", use: "mobile", value: "+1 231-666-6666" },
      { system: "email", value: "grace@example.org" }
    ],
    ...overrides
  } as FhirResource;
}

describe("patientHeaderInfo", () => {
  it("collects the identity and contact chips the header shows", () => {
    expect(patientHeaderInfo(patient({}))).toEqual({
      name: "Grace Mensah",
      birthDate: `${birthDateYearsAgo(68)} (68)`,
      gender: "female",
      address: "912 Highway 14 · Cadillac, MI, 49601",
      telecoms: ["phone: mobile: +1 231-666-6666", "email: grace@example.org"],
      profileCount: 1,
      otherPatients: 0
    });
  });

  it("leaves out what the record does not carry", () => {
    const info = patientHeaderInfo(patient({ name: [{ family: "Longitudinal" }], gender: undefined }));

    expect(info).toMatchObject({
      name: "Longitudinal",
      gender: undefined,
      telecoms: ["phone: mobile: +1 231-666-6666", "email: grace@example.org"]
    });
  });

  it("is null without a patient", () => {
    expect(patientHeaderInfo(null)).toBeNull();
  });
});

describe("headerPatientFor", () => {
  const birthDate = birthDateYearsAgo(68);

  it("is null when no portal has produced a patient", () => {
    expect(headerPatientFor([])).toBeNull();
  });

  it("shows one portal's patient", () => {
    expect(headerPatientFor([patient({ birthDate })])).toMatchObject({
      name: "Grace Mensah",
      profileCount: 1,
      otherPatients: 0
    });
  });

  it("treats portals that resolve to the same person as one patient", () => {
    const otherPortalCopy = patient({ id: "p2", name: [{ family: "mensah", given: ["Grace"] }], birthDate });

    expect(headerPatientFor([patient({ birthDate }), otherPortalCopy])).toMatchObject({
      name: "Grace Mensah",
      profileCount: 2,
      otherPatients: 0
    });
  });

  it("counts portals that belong to someone else", () => {
    const someoneElse = patient({ id: "p2", name: [{ family: "Ross", given: ["Linda"] }], birthDate: "1969-04-27" });

    expect(headerPatientFor([patient({ birthDate }), someoneElse])).toMatchObject({
      name: "Grace Mensah",
      profileCount: 2,
      otherPatients: 1
    });
  });
});

describe("patientIdentityKey", () => {
  it("ignores name case and keeps the birth date apart", () => {
    const left = patient({ id: "p1", name: [{ family: "Mensah", given: ["Grace"] }], birthDate: "1958-03-02" });
    const same = patient({ id: "p2", name: [{ family: "mensah", given: ["GRACE"] }], birthDate: "1958-03-02" });
    const otherBirthDate = patient({ id: "p3", name: [{ family: "Mensah", given: ["Grace"] }], birthDate: "1958-03-03" });

    expect(patientIdentityKey(left)).toBe(patientIdentityKey(same));
    expect(patientIdentityKey(left)).not.toBe(patientIdentityKey(otherBirthDate));
  });
});

describe("groupProfilesByPatient", () => {
  const grace = patient({ id: "p1", name: [{ family: "Mensah", given: ["Grace"] }], birthDate: "1958-03-02" });
  const linda = patient({ id: "p2", name: [{ family: "Ross", given: ["Linda"] }], birthDate: "1969-04-27" });

  it("keeps one identity per person and lists their portals", () => {
    const identities = groupProfilesByPatient([
      { sourceId: "portal-a", sourceName: "Portal A", patient: grace },
      { sourceId: "portal-b", sourceName: "Portal B", patient: linda },
      { sourceId: "portal-c", sourceName: "Portal C", patient: { ...grace, id: "p3" } }
    ]);

    expect(identities.map((identity) => identity.name)).toEqual(["Grace Mensah", "Linda Ross"]);
    expect(identities[0].profiles.map((profile) => profile.sourceId)).toEqual(["portal-a", "portal-c"]);
    expect(identities[1].profiles.map((profile) => profile.sourceId)).toEqual(["portal-b"]);
    expect(identities[0].key).toBe(patientIdentityKey(grace));
  });

  it("has nothing to say without profiles", () => {
    expect(groupProfilesByPatient([])).toEqual([]);
  });
});
