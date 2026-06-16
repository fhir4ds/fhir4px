/**
 * Embedding tier (Tier 3) — public API.
 *
 * Re-exports the embedder and classifier for use by the app's classification
 * pipeline. The embedding model (gte-modernbert-base, 143MB q8 WASM) loads
 * lazily on first use and is shared across all Tier 3 tasks.
 *
 * Classification tasks are defined by prototype JSON files in
 * /public/embeddings/prototypes/. Each file specifies class names and
 * prototype texts (or pre-computed centroids). The classifier embeds the
 * input text and finds the nearest class centroid via cosine similarity.
 *
 * Current tasks:
 *   - observation_category: lab / vital / other
 *   - allergy_type: medication / food / environmental / other
 *   - visit_type: inpatient / outpatient / emergency / telehealth / procedure
 *
 * Future tasks (per REQUIREMENTS.md):
 *   - chronic_acute_medication
 *   - chronic_acute_condition
 *   - fuzzy lab → condition matching
 */

export { embed, embedOne, preloadEmbedder, isEmbedderLoaded } from "./embedder";
export { classify, classifyBatch, preloadTask } from "./classify";
export type { ClassificationResult } from "./classify";
