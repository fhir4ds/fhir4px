/**
 * Flattened HTML rendering of an IPS bundle — print-to-PDF ready.
 * Pure string builder (no React) so it can open in a new window for
 * browser printing; content is escaped since feed data is untrusted.
 */

import type { FhirResource } from "../smart/data";

interface BundleEntry {
  fullUrl?: string;
  resource?: FhirResource;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resourceLabel(resource: FhirResource): string {
  const concepts = [resource.code, resource.medicationCodeableConcept, resource.vaccineCode, resource.clinicalStatus] as Array<
    { text?: string; coding?: Array<{ display?: string }> } | undefined
  >;
  for (const concept of concepts) {
    if (concept?.text) return concept.text;
    const display = concept?.coding?.find((coding) => coding.display)?.display;
    if (display) return display;
  }
  return `${resource.resourceType} ${resource.id ?? ""}`.trim();
}

function resourceDate(resource: FhirResource): string | undefined {
  const fields = ["effectiveDateTime", "issued", "date", "authoredOn", "recordedDate", "onsetDateTime", "performedDateTime", "occurrenceDateTime"];
  for (const field of fields) {
    const value = resource[field];
    if (typeof value === "string") return value.slice(0, 10);
  }
  return undefined;
}

function resourceValue(resource: FhirResource): string | undefined {
  const quantity = resource.valueQuantity as { value?: number; unit?: string } | undefined;
  if (quantity && typeof quantity.value === "number") {
    return `${quantity.value}${quantity.unit ? ` ${quantity.unit}` : ""}`;
  }
  const codeable = resource.valueCodeableConcept as { text?: string; coding?: Array<{ display?: string }> } | undefined;
  const codeableDisplay = codeable?.text ?? codeable?.coding?.find((coding) => coding.display)?.display;
  if (codeableDisplay) return codeableDisplay;
  if (typeof resource.valueString === "string") return resource.valueString;
  const components = Array.isArray(resource.component) ? (resource.component as Array<Record<string, unknown>>) : [];
  if (components.length > 0) {
    return components
      .map((component) => {
        const label = resourceLabel(component as FhirResource);
        const q = component.valueQuantity as { value?: number; unit?: string } | undefined;
        return q && typeof q.value === "number" ? `${label}: ${q.value}${q.unit ? ` ${q.unit}` : ""}` : label;
      })
      .join("; ");
  }
  return undefined;
}

function patientHeader(patient: FhirResource | undefined): string {
  if (!patient) return "";
  const name = (patient.name as Array<{ family?: string; given?: string[] }> | undefined)?.[0];
  const given = name?.given?.join(" ") ?? "";
  const family = name?.family ?? "";
  return `
    <header class="patient">
      <h1>International Patient Summary</h1>
      <p class="patient-name">${escapeHtml(`${given} ${family}`.trim() || patient.id || "Patient")}</p>
      <p class="meta">
        ${typeof patient.gender === "string" ? escapeHtml(patient.gender) + " · " : ""}
        ${typeof patient.birthDate === "string" ? escapeHtml(patient.birthDate) : ""}
      </p>
    </header>`;
}

const SECTION_TYPE_ORDER: Record<string, string[]> = {
  medications: ["MedicationRequest", "MedicationStatement"],
  allergies: ["AllergyIntolerance"],
  problems: ["Condition"],
  procedures: ["Procedure"],
  immunizations: ["Immunization"],
  results: ["Observation", "DiagnosticReport"]
};

export function renderIpsHtml(bundle: FhirResource): string {
  const entries = ((bundle.entry ?? []) as BundleEntry[]).filter((entry) => entry.resource?.resourceType);
  const composition = entries.find((entry) => entry.resource?.resourceType === "Composition")?.resource;
  const patient = entries.find((entry) => entry.resource?.resourceType === "Patient")?.resource;
  const referenced = new Map(entries.map((entry) => [entry.fullUrl ?? "", entry.resource!]));

  const sectionHtml = (composition?.section as Array<{ title?: string; entry?: Array<{ reference?: string }>; emptyReason?: unknown }> | undefined) ?? [];

  const body = sectionHtml
    .map((section) => {
      const title = escapeHtml(section.title ?? "Section");
      const rows = (section.entry ?? [])
        .map((ref) => referenced.get(ref.reference ?? ""))
        .filter((resource): resource is FhirResource => Boolean(resource));
      if (rows.length === 0) {
        return `<section><h2>${title}</h2><p class="empty">No information</p></section>`;
      }
      const items = rows
        .map((resource) => {
          const date = resourceDate(resource);
          const value = resourceValue(resource);
          return `<tr><td>${escapeHtml(resourceLabel(resource))}</td><td>${date ? escapeHtml(date) : "—"}</td><td>${
            value ? escapeHtml(value) : "—"
          }</td></tr>`;
        })
        .join("");
      return `<section><h2>${title}</h2><table><thead><tr><th>Item</th><th>Date</th><th>Value</th></tr></thead><tbody>${items}</tbody></table></section>`;
    })
    .join("\n");

  const generatedAt = typeof bundle.timestamp === "string" ? bundle.timestamp : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>International Patient Summary</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; margin: 32px; }
  header.patient { border-bottom: 3px solid #0d1b2a; padding-bottom: 12px; margin-bottom: 20px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .patient-name { font-size: 18px; font-weight: 600; margin: 0; }
  .meta, .generated { color: #555; font-size: 12px; }
  section { margin-bottom: 18px; }
  h2 { font-size: 15px; margin: 0 0 6px; color: #0d1b2a; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th { text-align: left; border-bottom: 1px solid #999; padding: 4px 8px 4px 0; }
  td { border-bottom: 1px solid #ddd; padding: 4px 8px 4px 0; vertical-align: top; }
  .empty { color: #777; font-style: italic; font-size: 13px; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
${patientHeader(patient)}
${body}
<p class="generated">Generated ${escapeHtml(generatedAt)} by fhir4px</p>
</body>
</html>`;
}

/** Open the flattened IPS in a new window and trigger print-to-PDF. */
export function printIpsHtml(bundle: FhirResource): void {
  const html = renderIpsHtml(bundle);
  const win = globalThis.open("", "_blank");
  if (!win) throw new Error("Popup blocked — allow popups to print the summary");
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}
