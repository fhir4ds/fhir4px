/**
 * Patient details for the app header: the identity and contact chips that
 * used to sit at the top of the Records page, shown on every page. Pure
 * functions over the FHIR Patient resource.
 */

import type { FhirResource } from "../smart/data";

/** One contact detail, without the FHIR packaging the header does not need. */
export interface PatientContact {
  /** FHIR telecom system, e.g. "phone", "email", "sms". */
  system: string;
  value: string;
}

export interface PatientHeaderInfo {
  name: string;
  /** Date of birth with the patient's age, e.g. "1969-04-27 (57)". */
  birthDate?: string;
  gender?: string;
  address?: string;
  contacts: PatientContact[];
  /** Portal profiles behind the loaded records (more than one with several portals). */
  profileCount: number;
}

export function patientDisplayName(patient: FhirResource | null | undefined): string {
  const names = Array.isArray(patient?.name) ? patient.name : [];
  const official = names.find((name) => (name as { use?: unknown }).use === "official");
  const selected = (official ?? names[0]) as
    | {
        text?: unknown;
        given?: unknown;
        family?: unknown;
      }
    | undefined;
  if (typeof selected?.text === "string" && selected.text.trim()) return selected.text.trim();
  const given = Array.isArray(selected?.given)
    ? selected.given.filter((value): value is string => typeof value === "string")
    : [];
  const family = typeof selected?.family === "string" ? selected.family : "";
  return [...given, family].filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || "Patient";
}

export function patientAge(birthDate?: unknown): number | undefined {
  if (typeof birthDate !== "string") return undefined;
  const parsed = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const today = new Date();
  let age = today.getFullYear() - parsed.getFullYear();
  const monthDelta = today.getMonth() - parsed.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < parsed.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : undefined;
}

function patientBirthDateLabel(patient: FhirResource): string | undefined {
  if (typeof patient.birthDate !== "string") return undefined;
  const age = patientAge(patient.birthDate);
  return age === undefined ? patient.birthDate : `${patient.birthDate} (${age})`;
}

function patientGenderLabel(patient: FhirResource): string | undefined {
  return typeof patient.gender === "string" && patient.gender.trim() ? patient.gender : undefined;
}

function patientAddressLabel(patient: FhirResource): string | undefined {
  const addresses = Array.isArray(patient.address) ? patient.address : [];
  const selected = addresses[0] as
    | {
        line?: unknown;
        city?: unknown;
        state?: unknown;
        postalCode?: unknown;
      }
    | undefined;
  if (!selected) return undefined;
  const lines = Array.isArray(selected.line)
    ? selected.line.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
  const city = typeof selected.city === "string" ? selected.city : undefined;
  const state = typeof selected.state === "string" ? selected.state : undefined;
  const postalCode = typeof selected.postalCode === "string" ? selected.postalCode : undefined;
  const locality = [city, state, postalCode].filter(Boolean).join(", ").replace(", ,", ",");
  return [...lines, locality].filter(Boolean).join(" · ") || undefined;
}

function patientContacts(patient: FhirResource): PatientContact[] {
  const telecoms = Array.isArray(patient.telecom) ? patient.telecom : [];
  return telecoms
    .flatMap((entry) => {
      const telecom = entry as { system?: unknown; value?: unknown };
      if (typeof telecom.value !== "string" || !telecom.value.trim()) return [];
      return [{ system: typeof telecom.system === "string" ? telecom.system : "contact", value: telecom.value.trim() }];
    })
    .slice(0, 3);
}

/** Header details for one patient; null when there is no Patient resource. */
export function patientHeaderInfo(patient: FhirResource | null | undefined): PatientHeaderInfo | null {
  if (!patient) return null;
  return {
    name: patientDisplayName(patient),
    birthDate: patientBirthDateLabel(patient),
    gender: patientGenderLabel(patient),
    address: patientAddressLabel(patient),
    contacts: patientContacts(patient),
    profileCount: 1
  };
}

/** Two profiles are the same person when their name and birth date match. */
export function patientIdentityKey(patient: FhirResource): string {
  return `${patientDisplayName(patient).toLowerCase()}|${String(patient.birthDate ?? "")}`;
}

/** A portal profile: which portal a patient came from. */
export interface PatientProfileLike {
  sourceId: string;
  /** The portal's name, without the patient (the person is the identity). */
  portalName: string;
  patient: FhirResource;
}

/** One person, with the portals whose profiles belong to them. */
export interface PatientIdentity<T extends PatientProfileLike> {
  /** Stable id for the person: the header's patient selector uses it. */
  key: string;
  name: string;
  profiles: T[];
}

/**
 * The distinct people behind the connected portals, in the order they were
 * connected. Several portals of the same person land in one identity.
 */
export function groupProfilesByPatient<T extends PatientProfileLike>(profiles: T[]): PatientIdentity<T>[] {
  const identities: PatientIdentity<T>[] = [];
  const byKey = new Map<string, PatientIdentity<T>>();
  for (const profile of profiles) {
    const key = patientIdentityKey(profile.patient);
    const existing = byKey.get(key);
    if (existing) {
      existing.profiles.push(profile);
      continue;
    }
    const identity: PatientIdentity<T> = {
      key,
      name: patientDisplayName(profile.patient),
      profiles: [profile]
    };
    byKey.set(key, identity);
    identities.push(identity);
  }
  return identities;
}

/**
 * The patient the header shows for the loaded records: the first portal's
 * patient, with the number of portal profiles behind it. When the portals are
 * different people the header also has a patient selector (groupProfilesByPatient).
 */
export function headerPatientFor(patients: FhirResource[]): PatientHeaderInfo | null {
  const first = patients[0];
  const info = patientHeaderInfo(first);
  if (!first || !info) return null;
  return { ...info, profileCount: patients.length };
}
