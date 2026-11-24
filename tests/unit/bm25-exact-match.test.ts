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

function resolverFor(index: unknown) {
  return new BM25Resolver({ loadIndex: async () => index });
}

describe("BM25Resolver exact surface", () => {
  it("returns the verbatim consumer-name document when tokens alone would mislead", async () => {
    // "a1c" has no posting; the row is recovered from its text and its name
    // is the query itself.
    const result = await resolverFor(miniIndex()).resolve("Hemoglobin A1c", "lab");
    expect(result.friendly_name).toBe("Hemoglobin A1c");
    expect(result.code).toBe("4548-4");
    expect(result.exact_surface).toBe(true);
  });

  it("normalizes punctuation and case for the exact match", async () => {
    const result = await resolverFor(miniIndex()).resolve("glucose  ", "lab");
    expect(result.friendly_name).toBe("Glucose");
    expect(result.exact_surface).toBe(true);
  });

  it("still scores rows by their terms for non-exact queries", async () => {
    const result = await resolverFor(miniIndex()).resolve("glucose measurement", "lab");
    expect(result.friendly_name).toBe("Glucose");
    expect(result.exact_surface).toBe(false);
  });
});

describe("BM25Resolver matches the terminology server's lexical search", () => {
  // Small index in the published format (version 3): posting keys keep
  // acronyms and alphanumerics.
  function v3Index() {
    return {
      category: "lab",
      version: 3,
      num_records: 6,
      avg_doc_length: 4,
      names: [
        "HbA1c", // 0
        "Acute Myocardial Infarction (MI)", // 1
        "Mi-2 Ab [Presence] in Serum", // 2
        "Prothrombin Time (PT) Test", // 3
        "Glycated hemoglobin panel", // 4
        "Phototherapy panel" // 5
      ],
      postings: {
        hba1c: [[0, 1]],
        acute: [[1, 1]],
        myocardial: [[1, 1]],
        infarction: [[1, 1]],
        mi: [[1, 1], [2, 1]],
        prothrombin: [[3, 1]],
        time: [[3, 1]],
        test: [[3, 1]],
        ab: [[2, 1]],
        presence: [[2, 1]],
        serum: [[2, 1]],
        glycated: [[4, 1]],
        hemoglobin: [[4, 1]],
        panel: [[4, 1], [5, 1]],
        phototherapi: [[5, 1]]
      },
      idf: {
        hba1c: 3, acute: 1.2, myocardial: 1.2, infarction: 1.2, mi: 1.4, prothrombin: 1.2,
        time: 1.2, test: 1.2, ab: 1.2, presence: 1.2, serum: 1.2, glycated: 1.2,
        hemoglobin: 1.2, panel: 1.0, phototherapi: 1.2
      },
      doc_lengths: [1, 5, 5, 5, 3, 2],
      rid_to_friendly_name: [
        "Hemoglobin A1c",
        "Heart attack",
        "Mi-2 antibody",
        "Prothrombin time",
        "Glycated hemoglobin panel",
        "Phototherapy panel"
      ],
      rid_to_code: ["A", "B", "C", "D", "E", "F"],
      rid_to_system: ["s", "s", "s", "s", "s", "s"]
    };
  }

  it("uses an alphanumeric posting key the index carries", async () => {
    const result = await resolverFor(v3Index()).resolve("HbA1c", "lab");
    expect(result.code).toBe("A");
    expect(result.friendly_name).toBe("Hemoglobin A1c");
    expect(result.exact_surface).toBe(true);
  });

  it("tries a word's stem when the word itself has no posting", async () => {
    // "phototherapy" is indexed as its stem "phototherapi".
    const result = await resolverFor(v3Index()).resolve("phototherapy", "lab");
    expect(result.code).toBe("F");
  });

  it("lets a cased two-letter acronym pick the row that spells it out", async () => {
    const result = await resolverFor(v3Index()).resolve("MI", "lab");
    expect(result.code).toBe("B");
  });

  it("ranks an exact name above a higher-scoring partial match", async () => {
    const index = v3Index();
    // A long document scores low per term, so the partial match on "panel"
    // alone would win on score; the row named like the query goes first.
    index.doc_lengths[4] = 40;
    const result = await resolverFor(index).resolve("Glycated hemoglobin panel", "lab", 2);
    expect(result.candidates.map((c) => c.code)).toEqual(["E", "F"]);
    expect(result.candidates[0].exact_surface).toBe(true);
    expect(result.candidates[0].score).toBeLessThan(result.candidates[1].score);
  });

  it("breaks equal scores by the closest name text", async () => {
    const index = v3Index();
    // "panel" matches rows 4 and 5; equal document lengths make their
    // term scores identical, so only the name text can decide.
    index.doc_lengths[5] = 3;
    const result = await resolverFor(index).resolve("panel", "lab", 3);
    const panelRows = result.candidates.filter((c) => c.code === "E" || c.code === "F");
    expect(panelRows.map((c) => c.code)).toEqual(["F", "E"]);
    expect(panelRows[0].score).toBe(panelRows[1].score);
  });

  it("settles scores that differ only beyond four decimals by the closest name", async () => {
    const index = v3Index();
    // Row 4 is a hair shorter, so it scores a hair higher; after rounding
    // the scores tie and the name text decides.
    index.doc_lengths[5] = 3 + 1e-7;
    const result = await resolverFor(index).resolve("panel", "lab", 3);
    const panelRows = result.candidates.filter((c) => c.code === "E" || c.code === "F");
    expect(panelRows[0].normalized_score).toBe(panelRows[1].normalized_score);
    expect(panelRows.map((c) => c.code)).toEqual(["F", "E"]);
  });

  it("returns no candidate for a query without usable tokens", async () => {
    const result = await resolverFor(v3Index()).resolve("--", "lab");
    expect(result.code).toBeNull();
    expect(result.candidates).toHaveLength(0);
  });
});
