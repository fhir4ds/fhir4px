/**
 * Debug Robin's BM25 resolution in the browser.
 * Paste into browser console at http://localhost:3000
 */
(async () => {
  const { resolveBm25Name } = await import("/src/lib/fhir/bm25-naming.ts");

  const robinRecords = [
    { id: "tier4-cond-1", resourceType: "Condition", sourceLabel: "Chronic migraine without aura", source: "provider" },
    { id: "tier4-cond-2", resourceType: "Condition", sourceLabel: "Irritable bowel syndrome with diarrhea", source: "provider" },
    { id: "tier4-obs-1", resourceType: "Observation", sourceLabel: "24-hour urinary cortisol excretion", source: "provider" },
    { id: "tier4-obs-2", resourceType: "Observation", sourceLabel: "Fecal calprotectin", source: "provider" },
    { id: "tier4-obs-3", resourceType: "Observation", sourceLabel: "resting metabolic rate measurement", source: "provider" },
    { id: "tier4-med-1", resourceType: "MedicationRequest", sourceLabel: "Sumatriptan succinate 50 MG Subcutaneous Injection", source: "provider" },
    { id: "tier4-med-2", resourceType: "MedicationRequest", sourceLabel: "Hyoscyamine sulfate 0.125 MG Oral Tablet", source: "provider" },
  ];

  console.log("Testing BM25 resolution for Robin's records...\n");
  for (const record of robinRecords) {
    try {
      const result = await resolveBm25Name(record);
      if (result) {
        console.log(`✓ ${record.resourceType}: "${record.sourceLabel}" → name="${result.patientFriendlyName}" code=${result.code} system=${result.system} score=${result.score} canonical=${result.canonicalCode?.code ?? "none"} ingredients=${result.ingredientCodes ?? "none"}`);
      } else {
        console.log(`✗ ${record.resourceType}: "${record.sourceLabel}" → NO MATCH (score below threshold or category null)`);

        // Debug: try raw resolve to see the actual score
        const { BM25Resolver } = await import("/src/lib/fhir/bm25-resolver.js");
        const category = BM25Resolver.resourceTypeToCategory(record.resourceType);
        if (category) {
          const resolver = new BM25Resolver({ baseUrl: "https://huggingface.co/joelmontavon/fhir4px-bm25/resolve/main", debug: true });
          const raw = await resolver.resolve(record.sourceLabel, category, 3);
          console.log(`    Raw BM25 result: name=${raw.name} score=${raw.score} candidates=${raw.candidates.length}`);
          if (raw.candidates.length > 0) {
            raw.candidates.forEach((c, i) => console.log(`      [${i}] "${c.name}" score=${c.score}`));
          }
        }
      }
    } catch (err) {
      console.log(`ERR ${record.resourceType}: "${record.sourceLabel}" → ${err.message}`);
    }
  }
  window.__robinTestDone = true;
})();
