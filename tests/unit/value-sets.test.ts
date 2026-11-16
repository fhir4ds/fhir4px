import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadValueSets,
  resolveLatestRelease,
  setValueSetsForTest,
  type ValueSetConcept
} from "../../src/lib/terminology/valueSets";

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

describe("resolveLatestRelease", () => {
  afterEach(() => {
    setValueSetsForTest(null);
  });

  it("picks the newest canonical release publishing value_sets.json", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      jsonResponse({
        siblings: [
          { rfilename: "README.md" },
          { rfilename: "canonical/2026.11.05.1/value_sets.json" },
          { rfilename: "canonical/2026.11.14.2/value_sets.json" },
          { rfilename: "canonical/2026.11.14.2/claimant_details.json" },
          { rfilename: "canonical/2026.10.31.1/value_sets.json" },
          { rfilename: "lexical/2026.11.14.2/lab.json" }
        ]
      })
    );
    const release = await resolveLatestRelease(fetchMock as unknown as typeof fetch);
    expect(release).toBe("2026.11.14.2");
  });

  it("throws when no canonical release exists", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ siblings: [{ rfilename: "README.md" }] }));
    await expect(resolveLatestRelease(fetchMock as unknown as typeof fetch)).rejects.toThrow(
      /no canonical value_sets release/i
    );
  });
});

describe("loadValueSets", () => {
  afterEach(() => {
    setValueSetsForTest(null);
  });

  it("fetches the latest release and indexes concepts by system and code", async () => {
    const concepts: ValueSetConcept[] = [
      {
        canonical_id: "VAL-MED-RXNORM-106892",
        system: "RXNORM",
        code: "106892",
        patient_friendly_name: "Insulin, Regular, Human",
        cui: "C0031296"
      },
      {
        canonical_id: "VAL-LAB-LOINC-2339-0",
        system: "LOINC",
        code: "2339-0",
        patient_friendly_name: "Glucose",
        consumer_synonyms: ["blood sugar"]
      },
      {
        canonical_id: "VAL-COND-SNOMED-44054006",
        system: "SNOMEDCT_US",
        code: "44054006",
        patient_friendly_name: "Diabetes"
      },
      { canonical_id: "VAL-VAX-CVX-01", system: "CVX", code: "01", patient_friendly_name: "Diphtheria, Tetanus, Pertussis" },
      // Unmapped system and incomplete entries are skipped.
      { canonical_id: "VAL-DRUGCLASS-ATC-A01", system: "ATC", code: "A01", patient_friendly_name: "Stomatological Preparations" },
      { canonical_id: "VAL-LAB-LOINC-x", system: "LOINC", code: "", patient_friendly_name: "No code" },
      { canonical_id: "VAL-LAB-LOINC-y", system: "LOINC", code: "9999-9", patient_friendly_name: "" }
    ];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/models/")) {
        return jsonResponse({ siblings: [{ rfilename: "canonical/2026.11.14.2/value_sets.json" }] });
      }
      expect(url).toBe("https://huggingface.co/fhir4ds/terminology/resolve/main/canonical/2026.11.14.2/value_sets.json");
      return jsonResponse(concepts);
    });
    const lookup = await loadValueSets({ fetcher: fetchMock as unknown as typeof fetch });
    expect([...lookup.rxnorm!.keys()]).toEqual(["106892"]);
    expect(lookup.rxnorm!.get("106892")?.patient_friendly_name).toBe("Insulin, Regular, Human");
    expect(lookup.loinc!.get("2339-0")?.consumer_synonyms).toEqual(["blood sugar"]);
    expect(lookup.snomed!.get("44054006")?.patient_friendly_name).toBe("Diabetes");
    expect(lookup.cvx!.get("01")).toBeDefined();
    expect(lookup.loinc!.size).toBe(1);
  });
});
