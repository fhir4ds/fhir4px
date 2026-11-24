/**
 * Patient details for the app header: the identity and contact chips that
 * used to sit at the top of the Records page, shown on every page. Pure
 * functions over the FHIR Patient resource.
 */

import type { FhirResource } from "../smart/data";

export interface PatientHeaderInfo {
  name: string;
  /** Date of birth with the patient's age, e.g. "1969-04-27 (57)". */
  birthDate?: string;
  gender?: string;
  address?: string;
  telecoms: string[];
  /** Portal profiles behind the loaded records (more than one with several portals). */
  profileCount: number;
  /** Profiles that belong to someone other than the first patient. */
  otherPatients: number;
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

function patientTelecomLabels(patient: FhirResource): string[] {
  const telecoms = Array.isArray(patient.telecom) ? patient.telecom : [];
  return telecoms
    .flatMap((entry) => {
      const telecom = entry as { system?: unknown; value?: unknown; use?: unknown };
      if (typeof telecom.value !== "string" || !telecom.value.trim()) return [];
      const system = typeof telecom.system === "string" ? telecom.system : "contact";
      const use = typeof telecom.use === "string" ? telecom.use : undefined;
      return [[system, use, telecom.value].filter(Boolean).join(": ")];
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
    telecoms: patientTelecomLabels(patient),
    profileCount: 1,
    otherPatients: 0
  };
}

/** Two profiles are the same person when their name and birth date match. */
function samePatient(left: FhirResource, right: FhirResource): boolean {
  return (
    patientDisplayName(left).toLowerCase() === patientDisplayName(right).toLowerCase() &&
    String(left.birthDate ?? "") === String(right.birthDate ?? "")
  );
}

/**
 * The patient the header shows for the loaded records. Portals that resolve
 * to the same person show that patient. When they are different people the
 * first patient is shown and the others are counted, so the header can say
 * "+1 source"; the connection menu lists every portal.
 */
export function headerPatientFor(patients: FhirResource[]): PatientHeaderInfo | null {
  const first = patients[0];
  const info = patientHeaderInfo(first);
  if (!first || !info) return null;
  return {
    ...info,
    profileCount: patients.length,
    otherPatients: patients.slice(1).filter((patient) => !samePatient(patient, first)).length
  };
}
