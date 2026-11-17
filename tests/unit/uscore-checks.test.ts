import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "../../public/fhir4ds/uscore-views/manifest.json"), "utf8")
) as { views: Array<{ id: string; name: string; resource: string }> };

describe("US Core view definitions", () => {
  it("covers the core resource types", () => {
    const resources = manifest.views.map((view) => view.resource);
    expect(resources).toEqual(
      expect.arrayContaining([
        "Patient",
        "Condition",
        "MedicationRequest",
        "AllergyIntolerance",
        "Immunization",
        "Procedure",
        "DocumentReference",
        "Observation"
      ])
    );
  });

  it("every view is a fhir4ds ViewDefinition with required-element columns", () => {
    for (const view of manifest.views) {
      const definition = JSON.parse(
        readFileSync(resolve(__dirname, `../../public/fhir4ds/uscore-views/${view.id}.json`), "utf8")
      ) as { resource: string; select: Array<{ column: Array<{ name: string; path: string }> }> };
      expect(definition.resource).toBe(view.resource);
      expect(definition.select?.[0]?.column?.length).toBeGreaterThan(0);
      for (const column of definition.select[0].column) {
        expect(column.path.length).toBeGreaterThan(0);
      }
    }
  });
});
