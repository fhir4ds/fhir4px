import { describe, expect, it } from "vitest";
import {
  allergyNegativeAssertionSuperseded,
  deterministicAllergyClassification,
  deterministicEncounterVisitClassification,
  deterministicObservationCategoryClassification
} from "../../src/lib/fhir/local-classification";
import type { GroupableRecord } from "../../src/lib/fhir/patient-groups";

function record(overrides: Partial<GroupableRecord>): GroupableRecord {
  return {
    id: "record-1",
    resourceType: "Observation",
    sourceLabel: "Record",
    source: "provider",
    ...overrides
  };
}

describe("local clinical classification", () => {
  it("aligns Observation category classification with FHIR R4 category codes", () => {
    expect(
      deterministicObservationCategoryClassification(
        record({ resourceType: "Observation", categoryCode: "laboratory", sourceLabel: "Hemoglobin A1c" })
      )
    ).toMatchObject({ observationCategory: "labs", source: "fhir_category", fallback: false });

    expect(
      deterministicObservationCategoryClassification(
        record({ resourceType: "Observation", categoryCode: "vital-signs", sourceLabel: "Systolic blood pressure" })
      )
    ).toMatchObject({ observationCategory: "vitals", source: "fhir_category", fallback: false });

    expect(
      deterministicObservationCategoryClassification(
        record({ resourceType: "Observation", categoryCode: "imaging", sourceLabel: "Chest x-ray finding" })
      )
    ).toMatchObject({ observationCategory: "other", source: "fhir_category", fallback: false });
  });

  it("classifies allergy negative assertions and supersedes only matching active domains", () => {
    const noKnownAllergies = deterministicAllergyClassification(
      record({ resourceType: "AllergyIntolerance", sourceLabel: "No known allergies" })
    );
    const noKnownDrugAllergies = deterministicAllergyClassification(
      record({ resourceType: "AllergyIntolerance", sourceLabel: "NKDA" })
    );
    const peanut = deterministicAllergyClassification(
      record({ resourceType: "AllergyIntolerance", sourceLabel: "Peanut allergy" })
    );

    expect(noKnownAllergies).toMatchObject({ assertionType: "negative_assertion", allergyDomain: "generic" });
    expect(noKnownDrugAllergies).toMatchObject({ assertionType: "negative_assertion", allergyDomain: "drug" });
    expect(peanut).toMatchObject({ assertionType: "specific_allergy", allergyDomain: "food" });

    expect(allergyNegativeAssertionSuperseded(noKnownAllergies, new Set(["food"]))).toBe(true);
    expect(allergyNegativeAssertionSuperseded(noKnownDrugAllergies, new Set(["food"]))).toBe(false);
    expect(allergyNegativeAssertionSuperseded(noKnownDrugAllergies, new Set(["drug"]))).toBe(true);
  });

  it("classifies common Encounter visit classes from source labels and codes", () => {
    expect(
      deterministicEncounterVisitClassification(
        record({ resourceType: "Encounter", sourceLabel: "Annual wellness office visit", categoryCode: "AMB" })
      )
    ).toMatchObject({ visitClass: "outpatient", fallback: false });

    expect(
      deterministicEncounterVisitClassification(
        record({ resourceType: "Encounter", sourceLabel: "Emergency department visit", categoryCode: "EMER" })
      )
    ).toMatchObject({ visitClass: "emergency", fallback: false });

    expect(
      deterministicEncounterVisitClassification(
        record({ resourceType: "Encounter", sourceLabel: "Video visit for follow-up" })
      )
    ).toMatchObject({ visitClass: "telehealth", fallback: false });
  });
});
