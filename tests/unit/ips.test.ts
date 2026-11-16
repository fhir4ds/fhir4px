import { describe, expect, it } from "vitest";
import { buildIpsBundle } from "../../src/lib/fhir/ips";
import { renderIpsHtml } from "../../src/lib/fhir/ips-html";
import type { FhirResource } from "../../src/lib/smart/data";

const RESOURCES: FhirResource[] = [
  { resourceType: "Patient", id: "p1", name: [{ family: "Steuber", given: ["Shalonda"] }], gender: "female", birthDate: "1975-12-29" } as FhirResource,
  {
    resourceType: "Condition", id: "c1", subject: { reference: "Patient/p1" },
    code: { coding: [{ system: "http://snomed.info/sct", code: "44054006", display: "Diabetes" }], text: "Type 2 Diabetes" },
    clinicalStatus: { coding: [{ code: "active" }] }, recordedDate: "2021-06-21"
  } as FhirResource,
  {
    resourceType: "Condition", id: "c2", subject: { reference: "Patient/p1" },
    code: { text: "Childhood measles" }, clinicalStatus: { coding: [{ code: "resolved" }] }, recordedDate: "1980-01-01"
  } as FhirResource,
  {
    resourceType: "MedicationRequest", id: "m1", subject: { reference: "Patient/p1" },
    medicationCodeableConcept: { text: "Insulin Isophane / Insulin Regular" }, authoredOn: "2021-06-21"
  } as FhirResource,
  {
    resourceType: "AllergyIntolerance", id: "a1", patient: { reference: "Patient/p1" },
    code: { text: "Penicillin" }, recordedDate: "2010-03-01"
  } as FhirResource,
  {
    resourceType: "Immunization", id: "v1", patient: { reference: "Patient/p1" },
    vaccineCode: { text: "Influenza vaccine" }, occurrenceDateTime: "2021-09-01"
  } as FhirResource,
  {
    resourceType: "Observation", id: "o1", subject: { reference: "Patient/p1" },
    code: { coding: [{ system: "http://loinc.org", code: "4548-4", display: "Hemoglobin A1c" }], text: "Hemoglobin A1c" },
    valueQuantity: { value: 8.2, unit: "%" }, effectiveDateTime: "2021-06-21"
  } as FhirResource,
  {
    resourceType: "Procedure", id: "pr1", subject: { reference: "Patient/p1" },
    code: { text: "Appendectomy" }, performedDateTime: "1990-05-05"
  } as FhirResource
];

describe("buildIpsBundle", () => {
  it("builds a document bundle with IPS profiles and all sections", () => {
    const bundle = buildIpsBundle(RESOURCES, { authorLabel: "fhir4px test", generatedAt: "2026-11-16T00:00:00Z" }) as {
      resourceType: string; type: string; meta: { profile: string[] }; entry: Array<{ fullUrl: string; resource: FhirResource }>;
    };
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("document");
    expect(bundle.meta.profile).toContain("http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-ips");
    const composition = bundle.entry[0].resource as { resourceType: string; section: Array<{ title: string; entry?: unknown[]; emptyReason?: unknown }> };
    expect(composition.resourceType).toBe("Composition");
    expect(composition.section.map((s) => s.title)).toEqual([
      "Medications", "Allergies", "Problem List", "History of Procedures", "Immunizations", "Results"
    ]);
    // Problems include active conditions only
    const problems = composition.section.find((s) => s.title === "Problem List")!;
    expect(problems.entry).toHaveLength(1);
    // Resolved condition excluded, others present
    expect(JSON.stringify(bundle.entry)).not.toContain("Childhood measles");
    expect(JSON.stringify(bundle.entry)).toContain("Insulin Isophane");
    // Entries resolve: every section reference has a matching fullUrl entry
    const urls = new Set(bundle.entry.map((e) => e.fullUrl));
    for (const section of composition.section) {
      for (const ref of (section.entry ?? []) as Array<{ reference: string }>) {
        expect(urls.has(ref.reference)).toBe(true);
      }
    }
  });

  it("requires a Patient", () => {
    expect(() => buildIpsBundle([RESOURCES[1]])).toThrow(/requires a Patient/);
  });

  it("emits emptyReason for sections with no entries", () => {
    const sparse = [RESOURCES[0], RESOURCES[1]] as FhirResource[];
    const bundle = buildIpsBundle(sparse, { generatedAt: "2026-11-16T00:00:00Z" }) as unknown as {
      entry: Array<{ resource: FhirResource }>;
    };
    const composition = bundle.entry[0].resource as unknown as { section: Array<{ title: string; entry?: unknown; emptyReason?: unknown }> };
    const meds = composition.section.find((s) => s.title === "Medications")!;
    expect(meds.entry).toBeUndefined();
    expect(meds.emptyReason).toBeDefined();
    const problems = composition.section.find((s) => s.title === "Problem List")!;
    expect(problems.entry).toHaveLength(1);
  });
});

describe("renderIpsHtml", () => {
  it("renders the flattened summary with escaped content", () => {
    const bundle = buildIpsBundle(RESOURCES, { generatedAt: "2026-11-16T00:00:00Z" });
    const html = renderIpsHtml(bundle);
    expect(html).toContain("International Patient Summary");
    expect(html).toContain("Shalonda Steuber");
    expect(html).toContain("Hemoglobin A1c");
    expect(html).toContain("8.2 %");
    expect(html).not.toContain("Childhood measles");
    // markup present for print
    expect(html).toContain("@media print");
  });

  it("escapes untrusted text", () => {
    const hostile: FhirResource[] = [
      RESOURCES[0],
      { resourceType: "Condition", id: "x", code: { text: '<script>alert("x")</script>' }, clinicalStatus: { coding: [{ code: "active" }] } } as FhirResource
    ];
    const html = renderIpsHtml(buildIpsBundle(hostile));
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });
});
