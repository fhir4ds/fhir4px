import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadValueSets,
  resolveTerminologyRelease,
  setValueSetsForTest,
  type ValueSetConcept
} from "../../src/lib/terminology/valueSets";

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body };
}

describe("resolveTerminologyRelease", () => {
  afterEach(() => {
    setValueSetsForTest(null);
  });

  it("picks the newest release publishing the file under the directory", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      jsonResponse({
        siblings: [
          { rfilename: "README.md" },
          { rfilename: "canonical/2026.11.05.1/value_sets.json" },
          { rfilename: "canonical/2026.11.14.2/value_sets.json" },
          { rfilename: "canonical/2026.11.14.2/claimant_details.json" },
          { rfilename: "canonical/2026.10.31.1/value_sets.json" },
          { rfilename: "lexical/2026.11.14.2/lab.json" },
          { rfilename: "lexical/2026.11.12.1/lab.json" }
        ]
      })
    );
    const fetcher = fetchMock as unknown as typeof fetch;
    await expect(resolveTerminologyRelease("canonical", "value_sets.json", fetcher)).resolves.toBe(
      "2026.11.14.2"
    );
    await expect(resolveTerminologyRelease("lexical", "lab.json", fetcher)).resolves.toBe(
      "2026.11.14.2"
    );
  });

  it("throws when no release exists", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ siblings: [{ rfilename: "README.md" }] }));
    await expect(
      resolveTerminologyRelease("canonical", "value_sets.json", fetchMock as unknown as typeof fetch)
    ).rejects.toThrow(/no canonical value_sets\.json release/i);
  });
});

describe("loadValueSets", () => {
  afterEach(() => {
    setValueSetsForTest(null);
  });

  it("fetches the latest release and indexes concepts by system and code", async () => {
    const concepts: ValueSetConcept[] = [
      {
        canonical_id: "VAL-MED-RXNORM-1191",
        system: "RXNORM",
        code: "1191",
        patient_friendly_name: "Aspirin",
        cui: "C0004057"
      },
      {
        canonical_id: "VAL-COND-SNOMED-44054006",
        system: "SNOMEDCT_US",
        code: "44054006",
        patient_friendly_name: "Type 2 Diabetes"
      }
    ];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/api/models/")) {
        return jsonResponse({ siblings: [{ rfilename: "canonical/2026.11.14.2/value_sets.json" }] });
      }
      expect(url).toBe("https://huggingface.co/fhir4ds/terminology/resolve/main/canonical/2026.11.14.2/value_sets.json");
      return jsonResponse(concepts);
    });
    const lookup = await loadValueSets({ fetcher: fetchMock as unknown as typeof fetch });
    expect(lookup.rxnorm!.get("1191")?.patient_friendly_name).toBe("Aspirin");
    expect(lookup.snomed!.get("44054006")?.patient_friendly_name).toBe("Type 2 Diabetes");
  });
});

