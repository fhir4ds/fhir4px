import { describe, expect, it } from "vitest";
import { US_CORE_CHECKS } from "../../src/lib/fhir/uscore-checks";

describe("US Core checks", () => {
  it("covers the core resource types with executable SQL", () => {
    const ids = US_CORE_CHECKS.map((check) => check.id);
    expect(ids).toContain("patient-identity");
    expect(ids).toContain("condition-status");
    expect(ids).toContain("observation-coded");
    for (const check of US_CORE_CHECKS) {
      expect(check.sql).toMatch(/FROM resources/);
      expect(check.sql).toMatch(/AS conforming/);
    }
  });

  it("expands choice elements ([x]) into any-property predicates", () => {
    const medication = US_CORE_CHECKS.find((check) => check.id === "medication-request-core")!;
    expect(medication.sql).toContain("starts_with(_props.key, 'medication')");
    expect(medication.sql).toContain("json_type(resource, '$.authoredOn')");
  });
});
