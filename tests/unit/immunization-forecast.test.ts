import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildForecastParameters, parseForecastResult } from "../../src/lib/fhir/immunization-forecast";
import type { FhirResource } from "../../src/lib/smart/data";

const recordedOutput = readFileSync(
  resolve(__dirname, "../fixtures/forecast/adult-due-50-zoster-output.json"),
  "utf8"
);

describe("buildForecastParameters", () => {
  it("maps local resources into $immds-forecast Parameters", () => {
    const patient = { resourceType: "Patient", id: "p1", birthDate: "1976-01-15" } as FhirResource;
    const immunization = {
      resourceType: "Immunization", id: "i1", status: "completed",
      vaccineCode: { coding: [{ system: "http://hl7.org/fhir/sid/cvx", code: "207" }] },
      occurrenceDateTime: "2026-05-25"
    } as FhirResource;
    const parameters = buildForecastParameters(patient, [immunization], [], [], "2026-11-16") as unknown as {
      parameter: Array<{ name: string; valueDate?: string; resource?: { resourceType: string } }>;
    };
    expect(parameters.parameter[0]).toMatchObject({ name: "assessmentDate", valueDate: "2026-11-16" });
    expect(parameters.parameter.find((p) => p.name === "patient")?.resource?.resourceType).toBe("Patient");
    expect(parameters.parameter.filter((p) => p.name === "immunization")).toHaveLength(1);
  });
});

describe("parseForecastResult (recorded CDC CDSi engine output)", () => {
  it("extracts vaccine groups with statuses and date criteria", () => {
    const items = parseForecastResult(recordedOutput);
    expect(items.length).toBeGreaterThan(5);
    const zoster = items.find((item) => item.vaccineCodes.includes("152"));
    expect(zoster).toBeDefined();
    const immune = items.find((item) => item.status === "immune");
    expect(immune).toBeDefined();
    const withDates = items.find((item) => item.recommendedDate);
    expect(withDates?.earliestDate).toBeDefined();
    expect(withDates?.pastDueDate).toBeDefined();
    // date criterion LOINC codes land in the right fields
    expect(withDates?.recommendedDate).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("surfaces engine errors", () => {
    expect(() => parseForecastResult(JSON.stringify({ error: "bad input" }))).toThrow("bad input");
  });
});
