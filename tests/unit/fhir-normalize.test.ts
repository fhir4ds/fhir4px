import { describe, expect, it } from "vitest";
import { buildReferralSummary, normalizeObservation } from "../../src/lib/fhir/normalize";

describe("FHIR normalization", () => {
  it("normalizes Observation values, dates, categories, and interpretations", () => {
    const observation = normalizeObservation({
      resourceType: "Observation",
      id: "obs-1",
      status: "final",
      category: [
        {
          coding: [{ code: "laboratory", display: "Laboratory" }]
        }
      ],
      code: {
        coding: [{ system: "urn:oid:2.16.840.1.113883.6.1", code: "718-7", display: "Hemoglobin" }]
      },
      valueQuantity: {
        value: 13.4,
        unit: "g/dL"
      },
      interpretation: [
        {
          coding: [{ code: "N", display: "Normal" }]
        }
      ],
      effectiveDateTime: "2026-05-24T12:00:00.000Z"
    });

    expect(observation).toMatchObject({
      id: "obs-1",
      label: "Hemoglobin",
      value: "13.4 g/dL",
      status: "final",
      category: "Laboratory",
      categoryCode: "laboratory",
      codingKeys: ["loinc:718-7"],
      interpretation: "Normal",
      effectiveDate: "2026-05-24T12:00:00.000Z"
    });
  });

  it("normalizes medication ingredient, dosage form, and coding hints from referenced Medication", () => {
    const summary = buildReferralSummary([
      { resourceType: "Patient", id: "patient-1" },
      {
        resourceType: "Medication",
        id: "med-metformin",
        code: {
          coding: [
            {
              system: "oid:2.16.840.1.113883.6.88",
              code: "861007",
              display: "metformin hydrochloride 500 MG Extended Release Oral Tablet"
            }
          ],
          text: "Metformin 500 mg extended release tablet"
        },
        form: { text: "Extended release tablet" },
        ingredient: [
          {
            itemCodeableConcept: {
              coding: [
                {
                  system: "http://www.nlm.nih.gov/research/umls/rxnorm",
                  code: "6809",
                  display: "metformin"
                }
              ],
              text: "Metformin"
            }
          }
        ]
      },
      {
        resourceType: "MedicationRequest",
        id: "medreq-metformin",
        status: "active",
        medicationReference: { reference: "Medication/med-metformin" },
        dosageInstruction: [
          {
            route: { text: "Oral" }
          }
        ]
      }
    ]);

    expect(summary.medications[0]).toMatchObject({
      id: "medreq-metformin",
      label: "Metformin 500 mg extended release tablet",
      codingKeys: ["rxnorm:861007"],
      ingredients: ["Metformin"],
      dosageForm: "Extended release tablet",
      route: "Oral"
    });
    expect(summary.medications[0].groupingText).toContain("Metformin");
    expect(summary.medications[0].groupingText).toContain("Extended release tablet");
    expect(summary.medications[0].groupingText).toContain("Oral");
  });

  it("infers medication route from source product and dosage form text when route is absent", () => {
    const summary = buildReferralSummary([
      { resourceType: "Patient", id: "patient-1" },
      {
        resourceType: "Medication",
        id: "med-albuterol",
        code: {
          coding: [
            {
              system: "http://www.nlm.nih.gov/research/umls/rxnorm",
              code: "745679",
              display: "albuterol 90 MCG/ACTUAT Metered Dose Inhaler"
            }
          ],
          text: "Albuterol metered dose inhaler"
        },
        form: { text: "Metered dose inhaler" },
        ingredient: [
          {
            itemCodeableConcept: { text: "Albuterol" }
          }
        ]
      },
      {
        resourceType: "MedicationRequest",
        id: "medreq-albuterol",
        status: "active",
        medicationReference: { reference: "Medication/med-albuterol" }
      }
    ]);

    expect(summary.medications[0]).toMatchObject({
      label: "Albuterol metered dose inhaler",
      ingredients: ["Albuterol"],
      dosageForm: "Metered dose inhaler",
      route: "Inhaled"
    });
  });

  it("sorts summary observations newest first", () => {
    const summary = buildReferralSummary([
      { resourceType: "Patient", id: "patient-1" },
      {
        resourceType: "Observation",
        id: "older",
        code: { text: "Older" },
        valueString: "a",
        effectiveDateTime: "2026-05-20T00:00:00.000Z"
      },
      {
        resourceType: "Observation",
        id: "newer",
        code: { text: "Newer" },
        valueString: "b",
        effectiveDateTime: "2026-05-24T00:00:00.000Z"
      }
    ]);

    expect(summary.observations.map((observation) => observation.id)).toEqual(["newer", "older"]);
  });

  it("normalizes encounters, procedures, and diagnostic reports for display", () => {
    const summary = buildReferralSummary([
      { resourceType: "Patient", id: "patient-1" },
      {
        resourceType: "Encounter",
        id: "encounter-1",
        status: "finished",
        class: { code: "AMB", display: "Ambulatory" },
        type: [
          {
            text: "Annual wellness visit",
            coding: [{ system: "http://snomed.info/sct", code: "444971000124105", display: "Annual wellness visit" }]
          }
        ],
        period: { start: "2026-05-24T12:00:00.000Z" },
        serviceProvider: { display: "Lakeview Primary Care" }
      },
      {
        resourceType: "Procedure",
        id: "procedure-1",
        status: "completed",
        code: {
          text: "Electrocardiogram",
          coding: [{ system: "http://www.ama-assn.org/go/cpt", code: "93000", display: "Electrocardiogram" }]
        },
        performedDateTime: "2026-05-24T12:05:00.000Z"
      },
      {
        resourceType: "DiagnosticReport",
        id: "report-1",
        status: "final",
        category: [{ text: "Laboratory" }],
        code: {
          text: "Comprehensive metabolic panel",
          coding: [{ system: "http://loinc.org", code: "24323-8", display: "Comprehensive metabolic panel" }]
        },
        effectiveDateTime: "2026-05-24T12:10:00.000Z",
        result: [{ reference: "Observation/glucose-1" }]
      }
    ]);

    expect(summary.encounters[0]).toMatchObject({
      id: "encounter-1",
      label: "Annual wellness visit",
      status: "finished",
      classLabel: "Ambulatory",
      serviceProvider: "Lakeview Primary Care",
      codingKeys: ["snomed:444971000124105"]
    });
    expect(summary.procedures[0]).toMatchObject({
      id: "procedure-1",
      label: "Electrocardiogram",
      status: "completed",
      codingKeys: ["cpt:93000"],
      performedDate: "2026-05-24T12:05:00.000Z"
    });
    expect(summary.diagnosticReports[0]).toMatchObject({
      id: "report-1",
      label: "Comprehensive metabolic panel",
      status: "final",
      category: "Laboratory",
      codingKeys: ["loinc:24323-8"],
      resultCount: 1
    });
  });
});
