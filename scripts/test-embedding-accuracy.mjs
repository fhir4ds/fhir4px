/**
 * Standalone accuracy test for embedding classification.
 * Uses fp32 model (compatible with onnxruntime-node).
 *
 *   node scripts/test-embedding-accuracy.mjs
 *
 * Downloads ~416MB fp32 model on first run (cached after).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const EMBEDDING_MODEL_ID = "joelmontavon/fhir4px-embeddings-onnx";

const SUITES = {
  observation_category: [
    // Labs
    { text: "Hemoglobin A1c", expected: "lab" },
    { text: "Glucose", expected: "lab" },
    { text: "Creatinine", expected: "lab" },
    { text: "Sodium", expected: "lab" },
    { text: "Potassium", expected: "lab" },
    { text: "Total Cholesterol", expected: "lab" },
    { text: "LDL Cholesterol", expected: "lab" },
    { text: "ALT", expected: "lab" },
    { text: "TSH", expected: "lab" },
    { text: "White Blood Cell Count", expected: "lab" },
    { text: "Platelets", expected: "lab" },
    { text: "INR", expected: "lab" },
    { text: "Vitamin D", expected: "lab" },
    { text: "Ferritin", expected: "lab" },
    { text: "Troponin", expected: "lab" },
    { text: "Fecal Calprotectin", expected: "lab" },
    { text: "24-hour urinary cortisol excretion", expected: "lab" },
    { text: "Hemoglobin A1c/Hemoglobin.Total", expected: "lab" },
    // Vitals
    { text: "Systolic Blood Pressure", expected: "vital" },
    { text: "Diastolic Blood Pressure", expected: "vital" },
    { text: "Heart Rate", expected: "vital" },
    { text: "Respiratory Rate", expected: "vital" },
    { text: "Oxygen Saturation", expected: "vital" },
    { text: "Body Temperature", expected: "vital" },
    { text: "Body Weight", expected: "vital" },
    { text: "BMI", expected: "vital" },
    { text: "Intravascular Systolic", expected: "vital" },
    { text: "Peak Expiratory Flow", expected: "vital" },
    // Other
    { text: "PHQ-9 Score", expected: "other" },
    { text: "Tobacco Smoking Status", expected: "other" },
    { text: "Alcohol Consumption", expected: "other" },
    { text: "Exercise Frequency", expected: "other" },
    { text: "Social Determinants of Health", expected: "other" },
  ],
  allergy_type: [
    { text: "Allergy to penicillin", expected: "medication" },
    { text: "Allergy to aspirin", expected: "medication" },
    { text: "Allergy to ibuprofen", expected: "medication" },
    { text: "Allergy to morphine", expected: "medication" },
    { text: "Allergy to sulfonamide", expected: "medication" },
    { text: "Drug Allergies", expected: "medication" },
    { text: "Allergy to vancomycin", expected: "medication" },
    { text: "Allergy to peanut", expected: "food" },
    { text: "Allergy to shellfish", expected: "food" },
    { text: "Allergy to milk", expected: "food" },
    { text: "Allergy to gluten", expected: "food" },
    { text: "Allergy to egg", expected: "food" },
    { text: "Allergy to tree nuts", expected: "food" },
    { text: "Allergy to soy", expected: "food" },
    { text: "Hay Fever", expected: "environmental" },
    { text: "Allergy to pollen", expected: "environmental" },
    { text: "Allergy to dust mite", expected: "environmental" },
    { text: "Allergy to cat dander", expected: "environmental" },
    { text: "Allergy to latex", expected: "environmental" },
    { text: "Allergic rhinitis", expected: "environmental" },
    { text: "Allergy to nickel", expected: "other" },
    { text: "Allergy to contrast media", expected: "other" },
    { text: "Contact dermatitis", expected: "other" },
    { text: "Allergy to adhesive", expected: "other" },
  ],
  visit_type: [
    { text: "Hospital admission", expected: "inpatient" },
    { text: "Inpatient stay", expected: "inpatient" },
    { text: "Overnight hospital stay", expected: "inpatient" },
    { text: "Hospital readmission", expected: "inpatient" },
    { text: "Ambulatory visit", expected: "outpatient" },
    { text: "Office visit", expected: "outpatient" },
    { text: "Follow-up clinic visit", expected: "outpatient" },
    { text: "Routine checkup", expected: "outpatient" },
    { text: "Urgent care visit", expected: "outpatient" },
    { text: "Emergency room visit", expected: "emergency" },
    { text: "ED visit", expected: "emergency" },
    { text: "Emergency department visit", expected: "emergency" },
    { text: "Telehealth visit", expected: "telehealth" },
    { text: "Virtual visit", expected: "telehealth" },
    { text: "Video visit", expected: "telehealth" },
    { text: "Colonoscopy", expected: "procedure" },
    { text: "Cardiac catheterization", expected: "procedure" },
    { text: "Outpatient surgery", expected: "procedure" },
    { text: "Endoscopy", expected: "procedure" },
    { text: "Cataract surgery", expected: "procedure" },
    { text: "ambulatory", expected: "outpatient" },
  ],
};

function dotProduct(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

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
  console.log("Loading transformers.js...");
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.allowRemoteModels = true;

  console.log(`Loading fp32 model (${EMBEDDING_MODEL_ID})...`);
  console.log("(416MB download on first run, cached after)");
  const startedAt = Date.now();
  const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
    dtype: "fp32",
    device: "cpu"
  });
  console.log(`Model loaded in ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);

  async function embed(texts) {
    if (texts.length === 0) return [];
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  }

  let totalCorrect = 0;
  let totalCases = 0;

  for (const [taskName, cases] of Object.entries(SUITES)) {
    // Load prototype file
    const protoPath = resolve(process.cwd(), "public/embeddings/prototypes", `${taskName}.json`);
    const protoData = JSON.parse(await readFile(protoPath, "utf8"));
    const classNames = Object.keys(protoData.classes).sort();

    // Compute centroids from prototype texts
    const textsToEmbed = [];
    const textToClass = [];
    for (const cn of classNames) {
      const texts = protoData.classes[cn].prototype_texts || [];
      for (const t of texts) {
        textsToEmbed.push(t);
        textToClass.push(cn);
      }
    }
    console.log(`Computing centroids for ${taskName} (${textsToEmbed.length} prototypes)...`);
    const protoVectors = await embed(textsToEmbed);
    const centroids = new Map();
    const vectorsByClass = new Map();
    for (let i = 0; i < protoVectors.length; i++) {
      const cn = textToClass[i];
      if (!vectorsByClass.has(cn)) vectorsByClass.set(cn, []);
      vectorsByClass.get(cn).push(protoVectors[i]);
    }
    for (const cn of classNames) {
      const cv = vectorsByClass.get(cn);
      if (cv && cv.length > 0) centroids.set(cn, averageVectors(cv));
    }

    // Classify test cases
    const testTexts = cases.map((c) => c.text);
    const testVectors = await embed(testTexts);
    let correct = 0;
    const details = [];

    for (let i = 0; i < cases.length; i++) {
      const scores = classNames.map((cn) => ({
        className: cn,
        score: dotProduct(testVectors[i], centroids.get(cn) || [])
      }));
      scores.sort((a, b) => b.score - a.score);
      const predicted = scores[0].className;
      const confidence = scores[0].score;
      const expected = cases[i].expected;
      const mark = predicted === expected ? "✓" : "✗";
      if (predicted === expected) correct++;
      details.push(`  ${mark} "${cases[i].text}" → ${predicted} (expected: ${expected}, conf: ${confidence.toFixed(3)})`);
    }

    totalCorrect += correct;
    totalCases += cases.length;
    const pct = ((correct / cases.length) * 100).toFixed(1);
    const correctConfs = details
      .filter((d) => d.startsWith("  ✓"))
      .map((d) => parseFloat(d.match(/conf: ([\d.]+)/)?.[1] || "0"));
    const avgConf = correctConfs.length > 0 ? (correctConfs.reduce((s, c) => s + c, 0) / correctConfs.length).toFixed(3) : "N/A";

    console.log(`\n=== ${taskName}: ${correct}/${cases.length} (${pct}%) | avg conf on correct: ${avgConf} ===`);
    details.forEach((d) => console.log(d));
  }

  console.log(`\n=== OVERALL: ${totalCorrect}/${totalCases} (${((totalCorrect / totalCases) * 100).toFixed(1)}%) ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
