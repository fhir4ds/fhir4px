import { afterEach, describe, expect, it } from "vitest";
import {
  lexicalCodeMapOf,
  loadLexicalCodeMap,
  setLexicalIndexForTest,
  type LexicalIndex
} from "../../src/lib/terminology/lexical";
import { setValueSetsForTest } from "../../src/lib/terminology/valueSets";

function miniIndex(): LexicalIndex {
  return {
    category: "medication",
    names: [
      "insulin isophane, human 70 UNT/ML / insulin, regular, human 30 UNT/ML Injectable Suspension [Humulin]",
      "diphenhydramine hydrochloride 25 MG Oral Tablet",
      "Uncoded synonym entry"
    ],
    postings: {},
    idf: {},
    doc_lengths: [4, 4, 3],
    avg_doc_length: 3.7,
    rid_to_friendly_name: [
      "Insulin Isophane / Insulin, Regular, Human Injectable Product",
      "Diphenhydramine Oral Product",
      "Some Canonical"
    ],
    rid_to_code: ["106892", "1049630", ""],
    rid_to_system: ["rxnorm", "rxnorm", ""],
    rid_to_canonical_code: ["106892", "1049630", ""],
    rid_to_canonical_system: ["rxnorm", "rxnorm", ""]
  };
}

describe("lexicalCodeMapOf", () => {
  it("maps every coded document to its canonical-friendly name", () => {
    const map = lexicalCodeMapOf(miniIndex());
    expect(map.get("rxnorm:106892")?.name).toBe("Insulin Isophane / Insulin, Regular, Human Injectable Product");
    expect(map.get("rxnorm:1049630")?.name).toBe("Diphenhydramine Oral Product");
    expect(map.size).toBe(2);
  });
});

describe("loadLexicalCodeMap", () => {
  afterEach(() => {
    setLexicalIndexForTest("medication", null);
    setValueSetsForTest(null);
  });

  it("serves the injected index through the shared cache", async () => {
    setLexicalIndexForTest("medication", miniIndex());
    const map = await loadLexicalCodeMap("medication");
    expect(map.get("rxnorm:106892")?.name).toContain("Insulin Isophane");
  });
});
