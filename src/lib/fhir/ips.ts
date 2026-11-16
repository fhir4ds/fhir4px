/**
 * International Patient Summary (IPS) generation — HL7 IPS (R4) document
 * bundle from a merged FHIR resource set.
 *
 * Produces a Bundle (type "document") with an IPS-profiled Composition and
 * the required sections: Medications, Allergies, Problem List, History of
 * Procedures, Immunizations, and Results. Resources keep their original
 * content; the Composition carries section titles and entry references.
 */

import type { FhirResource } from "../smart/data";

const IPS_PROFILE = {
  bundle: "http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-ips",
  composition: "http://hl7.org/fhir/uv/ips/StructureDefinition/Composition-uv-ips"
} as const;

export const IPS_SECTIONS = [
  { code: "medications", title: "Medications" },
  { code: "allergies", title: "Allergies" },
  { code: "problems", title: "Problem List" },
  { code: "procedures", title: "History of Procedures" },
  { code: "immunizations", title: "Immunizations" },
  { code: "results", title: "Results" }
] as const;

export type IpsSectionCode = (typeof IPS_SECTIONS)[number]["code"];

function fullUrl(resource: FhirResource, index: number): string {
  return `urn:uuid:${typeof resource.id === "string" && resource.id ? resource.id : `entry-${index}`}`;
}

function resourceDate(resource: FhirResource): string | undefined {
  const fields = ["effectiveDateTime", "issued", "date", "authoredOn", "recordedDate", "onsetDateTime", "performedDateTime", "occurrenceDateTime"];
  for (const field of fields) {
    const value = resource[field];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function activeCondition(resource: FhirResource): boolean {
  const codings = (resource.clinicalStatus as { coding?: Array<{ code?: string }> } | undefined)?.coding ?? [];
  if (codings.length === 0) return true;
  return codings.some((coding) => ["active", "recurrence", "relapse"].includes(coding.code ?? ""));
}

function sectionEntries(resources: FhirResource[]): Array<{ fullUrl: string; resource: FhirResource }> {
  return resources.map((resource, index) => ({ fullUrl: fullUrl(resource, index + 1), resource }));
}

export interface IpsSectionContent {
  code: IpsSectionCode;
  title: string;
  entries: Array<{ fullUrl: string; resource: FhirResource }>;
}

export interface BuildIpsBundleOptions {
  authorLabel?: string;
  generatedAt?: string;
  /** Cap per section to keep summaries readable (default 250). */
  perSectionLimit?: number;
}

function collectSections(resources: FhirResource[], limit: number): IpsSectionContent[] {
  const byType = (type: string) => resources.filter((resource) => resource.resourceType === type);
  const pick = (
    code: IpsSectionCode,
    title: string,
    candidates: FhirResource[]
  ): IpsSectionContent => {
    const sorted = [...candidates].sort((left, right) =>
      (resourceDate(right) ?? "").localeCompare(resourceDate(left) ?? "")
    );
    return { code, title, entries: sectionEntries(sorted.slice(0, limit)) };
  };

  return [
    pick("medications", "Medications", [...byType("MedicationRequest"), ...byType("MedicationStatement")]),
    pick("allergies", "Allergies", byType("AllergyIntolerance")),
    pick("problems", "Problem List", byType("Condition").filter(activeCondition)),
    pick("procedures", "History of Procedures", byType("Procedure")),
    pick("immunizations", "Immunizations", byType("Immunization")),
    pick("results", "Results", [...byType("Observation"), ...byType("DiagnosticReport")])
  ];
}

/**
 * Build an IPS document Bundle. The Patient is required; sections with no
 * entries are still emitted with `emptyReason` per the IG, so consumers see
 * the full section structure.
 */
export function buildIpsBundle(resources: FhirResource[], options: BuildIpsBundleOptions = {}): FhirResource {
  const limit = options.perSectionLimit ?? 250;
  const patient = resources.find((resource) => resource.resourceType === "Patient");
  if (!patient) throw new Error("IPS requires a Patient resource");
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  const sections = collectSections(resources, limit);
  const patientEntry = { fullUrl: fullUrl(patient, 0), resource: patient };
  const entries = [patientEntry, ...sections.flatMap((section) => section.entries)];

  const composition: FhirResource = {
    resourceType: "Composition",
    status: "final",
    type: {
      coding: [
        {
          system: "http://loinc.org",
          code: "60591-5",
          display: "Patient summary Document"
        }
      ]
    },
    subject: { reference: patientEntry.fullUrl },
    date: generatedAt,
    author: [{ display: options.authorLabel ?? "fhir4px" }],
    title: "International Patient Summary",
    meta: { profile: [IPS_PROFILE.composition] },
    section: sections.map((section) =>
      section.entries.length > 0
        ? {
            title: section.title,
            entry: section.entries.map((entry) => ({ reference: entry.fullUrl }))
          }
        : {
            title: section.title,
            emptyReason: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/list-empty-reason", code: "notasked", display: "Not Asked" }] }
          }
    )
  };

  const compositionEntry = { fullUrl: "urn:uuid:composition-ips", resource: composition };

  return {
    resourceType: "Bundle",
    type: "document",
    timestamp: generatedAt,
    meta: { profile: [IPS_PROFILE.bundle] },
    entry: [compositionEntry, ...entries]
  } as FhirResource;
}
