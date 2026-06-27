/**
 * Pre-compute embedding centroids for classification prototype files.
 *
 * Reads each prototype JSON, embeds prototype_texts using the embedding model,
 * averages them into per-class centroids, and writes the centroids back into
 * the JSON. This eliminates ~500 runtime embedding calls on every page load.
 *
 *   node scripts/precompute-centroids.mjs
 *
 * Downloads ~105MB q8 model on first run (cached after).
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTOTYPE_DIR = resolve(__dirname, "..", "public", "embeddings", "prototypes");
const EMBEDDING_MODEL_ID = "joelmontavon/fhir4px-embeddings-onnx";

const TASKS = [
  "observation_category",
  "allergy_type",
  "encounter_class",
  "encounter_type"
];

function normalize(vec) {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

function averageVectors(vectors) {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const mean = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) mean[i] += vec[i];
  }
  return normalize(mean.map((v) => v / vectors.length));
}

async function main() {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.allowRemoteModels = true;

  console.log(`Loading embedding model (${EMBEDDING_MODEL_ID}, q8)...`);
  const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
    dtype: "q8",
    device: "cpu"
  });
  console.log("Model loaded.");

  async function embed(texts) {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  }

  for (const task of TASKS) {
    const filePath = resolve(PROTOTYPE_DIR, `${task}.json`);
    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(raw);

    const classNames = Object.keys(data.classes).sort();
    const allTexts = [];
    const textToClass = [];

    for (const className of classNames) {
      const entry = data.classes[className];
      const texts = entry.prototype_texts ?? [];
      for (const text of texts) {
        allTexts.push(text);
        textToClass.push(className);
      }
    }

    if (allTexts.length === 0) {
      console.log(`  ${task}: no prototype_texts, skipping`);
      continue;
    }

    console.log(`  ${task}: embedding ${allTexts.length} texts across ${classNames.length} classes...`);
    const vectors = await embed(allTexts);

    const vectorsByClass = new Map();
    for (let i = 0; i < vectors.length; i++) {
      const cn = textToClass[i];
      if (!vectorsByClass.has(cn)) vectorsByClass.set(cn, []);
      vectorsByClass.get(cn).push(vectors[i]);
    }

    let centroidCount = 0;
    for (const className of classNames) {
      const classVectors = vectorsByClass.get(className);
      if (classVectors && classVectors.length > 0) {
        data.classes[className].centroid = averageVectors(classVectors);
        centroidCount++;
      }
    }

    // Keep prototype_texts for reference/debugging — the runtime classifier
    // uses centroid if present, ignoring prototype_texts entirely.
    await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    console.log(`  ${task}: wrote ${centroidCount} centroids`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
