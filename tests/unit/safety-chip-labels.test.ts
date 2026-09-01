import { describe, expect, it } from "vitest";
import { relationshipLabel } from "../../src/lib/associations/matcher";

describe("safety-signal chip labels (v1.4)", () => {
  it("adverse_effect uses caution prefix distinct from treats", () => {
    const treats = relationshipLabel("treats", true, "direct_indication");
    const ae = relationshipLabel("adverse_effect", true, "warning_section");
    expect(treats).toBe("Treats this");
    expect(ae).toBe("Caution: may cause");
    expect(ae).not.toContain("Treats");
  });

  it("contraindicated_in and interferes_with_test have distinct prefixes", () => {
    expect(relationshipLabel("contraindicated_in", true)).toBe("Avoid with this");
    expect(relationshipLabel("interferes_with_test", true)).toBe("May interfere with");
  });

  it("safety provenance tiers do not change the label (bucket drives it)", () => {
    expect(relationshipLabel("adverse_effect", true, "boxed_warning")).toBe("Caution: may cause");
    expect(relationshipLabel("adverse_effect", true, "warning_section")).toBe("Caution: may cause");
  });
});
