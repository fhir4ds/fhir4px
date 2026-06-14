import { describe, expect, it } from "vitest";
import { filterResourcesByLookback } from "../../src/lib/fhir/filters";

describe("FHIR resource filters", () => {
  it("filters high-volume resources by lookback while keeping core resources", () => {
    const now = Date.parse("2026-05-25T00:00:00.000Z");
    const filtered = filterResourcesByLookback(
      [
        { resourceType: "Patient", id: "patient-1" },
        { resourceType: "Condition", id: "condition-1", recordedDate: "2020-01-01T00:00:00.000Z" },
        { resourceType: "Observation", id: "recent", effectiveDateTime: "2026-05-01T00:00:00.000Z" },
        { resourceType: "Observation", id: "old", effectiveDateTime: "2020-01-01T00:00:00.000Z" },
        { resourceType: "DiagnosticReport", id: "unknown-date" }
      ],
      365,
      now
    );

    expect(filtered.map((resource) => resource.id)).toEqual([
      "patient-1",
      "condition-1",
      "recent",
      "unknown-date"
    ]);
  });
});
