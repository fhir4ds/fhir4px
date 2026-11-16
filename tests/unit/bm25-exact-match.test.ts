import { describe, expect, it } from "vitest";
import { BM25Resolver } from "../../src/lib/fhir/bm25-resolver.js";

function miniIndex() {
  return {
    category: "lab",
    num_records: 2,
    avg_doc_length: 3,
    names: ["Hemoglobin A1c:MCnc:Pt:Bld:Qn", "Glucose:MCnc:Pt:Ser:Qn"],
    postings: { hemoglobin: [[0, 1]], glucose: [[1, 1]] },
    idf: { hemoglobin: 2, glucose: 2 },
    doc_lengths: [3, 3],
    rid_to_friendly_name: ["Hemoglobin A1c", "Glucose"],
    rid_to_code: ["4548-4", "2339-0"],
    rid_to_system: ["loinc", "loinc"],
    rid_to_canonical_code: ["4548-4", "2339-0"],
    rid_to_canonical_system: ["loinc", "loinc"]
  };
}

describe("BM25Resolver exact-match fast path", () => {
  it("returns the verbatim consumer-name document when tokens alone would mislead", async () => {
    const resolver = new BM25Resolver({ loadIndex: async () => miniIndex() });
    // "A1c" is dropped by the tokenizer; the exact friendly-name match wins.
    const result = await resolver.resolve("Hemoglobin A1c", "lab");
    expect(result.friendly_name).toBe("Hemoglobin A1c");
    expect(result.code).toBe("4548-4");
    expect(result.score).toBeGreaterThanOrEqual(50);
  });

  it("normalizes punctuation and case for the exact match", async () => {
    const resolver = new BM25Resolver({ loadIndex: async () => miniIndex() });
    const result = await resolver.resolve("glucose  ", "lab");
    expect(result.friendly_name).toBe("Glucose");
  });

  it("still falls back to BM25 scoring for non-exact queries", async () => {
    const resolver = new BM25Resolver({ loadIndex: async () => miniIndex() });
    const result = await resolver.resolve("glucose measurement", "lab");
    expect(result.friendly_name).toBe("Glucose");
    expect(result.score).toBeLessThan(50);
  });
});
