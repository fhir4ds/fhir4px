/**
 * Centroid classifier evaluation driven by the chronic-cohort fixtures.
 *
 * Reads tests/fixtures/fhir/chronic/manifest.json (ground truth recorded at
 * generation time), classifies every unique display/text with the fp32
 * embedding model against the prototype centroids, and reports per-task
 * accuracy, confusion pairs, confidence stats, and coded-vs-codeless
 * breakdown — mirroring the runtime classification in PatientExplorer
 * (observation_category / allergy_type / encounter_class / encounter_type).
 *
 *   node scripts/test-embedding-accuracy-chronic.mjs [--codes-only|--text-only]
 *
 * Downloads ~416MB fp32 model on first run (cached after).
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const EMBEDDING_MODEL_ID = "joelmontavon/fhir4px-embeddings-onnx";
// Mirrors src/lib/embeddings/classify.ts TASK_CONFIDENCE_THRESHOLDS.
const TASK_CONFIDENCE_THRESHOLDS = {
  allergy_type: 0.4,
  encounter_class: 0.5,
  encounter_type: 0.75
};
const MANIFEST = resolve(process.cwd(), "tests/fixtures/fhir/chronic/manifest.json");
const mode = process.argv.includes("--codes-only") ? "codes" : process.argv.includes("--text-only") ? "text" : "all";

const ENCOUNTER_CLASS_MAP = {
  AMB: "outpatient",
  EMER: "emergency",
  IMP: "inpatient",
  VR: "telehealth",
  SS: "urgent_care"
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

async function loadTask(taskName) {
  const protoPath = resolve(process.cwd(), "public/embeddings/prototypes", `${taskName}.json`);
  const protoData = JSON.parse(await readFile(protoPath, "utf8"));
  const classNames = Object.keys(protoData.classes).sort();
  return { classNames, protoData };
}

async function computeCentroids(extractor, protoData, classNames, embed) {
  const textsToEmbed = [];
  const textToClass = [];
  for (const cn of classNames) {
    for (const t of protoData.classes[cn].prototype_texts || []) {
      textsToEmbed.push(t);
      textToClass.push(cn);
    }
  }
  const vectors = await embed(textsToEmbed);
  const byClass = new Map();
  for (let i = 0; i < vectors.length; i++) {
    if (!byClass.has(textToClass[i])) byClass.set(textToClass[i], []);
    byClass.get(textToClass[i]).push(vectors[i]);
  }
  const centroids = new Map();
  for (const cn of classNames) {
    const cv = byClass.get(cn);
    if (cv) centroids.set(cn, averageVectors(cv));
  }
  return centroids;
}

function reportSuite(name, cases, classNames, centroids, vectors, split) {
  // cases: [{text, expected, count, group}] — group used for coded/codeless split
  const confusion = new Map();
  let correct = 0;
  let total = 0;
  const byGroup = {};
  const confidences = { correct: [], incorrect: [] };

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const scores = classNames.map((cn) => ({ className: cn, score: dotProduct(vectors[i], centroids.get(cn) || []) }));
    scores.sort((a, b) => b.score - a.score);
    const predicted = scores[0].className;
    const ok = predicted === c.expected;
    correct += ok ? c.count : 0;
    total += c.count;
    (confidences[ok ? "correct" : "incorrect"]).push({ conf: scores[0].score, text: c.text, predicted, expected: c.expected });
    const g = byGroup[c.group ?? "all"] ?? { correct: 0, total: 0 };
    g.correct += ok ? c.count : 0;
    g.total += c.count;
    byGroup[c.group ?? "all"] = g;
    if (!ok) {
      const key = `${c.expected} -> ${predicted}`;
      confusion.set(key, (confusion.get(key) ?? 0) + c.count);
    }
  }

  const pct = total ? ((correct / total) * 100).toFixed(1) : "0.0";
  const avgConf = (arr) => (arr.length ? (arr.reduce((s, x) => s + x.conf, 0) / arr.length).toFixed(3) : "n/a");
  console.log(`\n=== ${name} (${split}): ${correct}/${total} (${pct}%) | avg conf correct: ${avgConf(confidences.correct)} incorrect: ${avgConf(confidences.incorrect)} ===`);
  for (const [g, v] of Object.entries(byGroup)) {
    if (g === "all") continue;
    console.log(`   [${g}] ${v.correct}/${v.total} (${((v.correct / v.total) * 100).toFixed(1)}%)`);
  }
  const threshold = TASK_CONFIDENCE_THRESHOLDS[name.split(" ")[0] === "observation" ? "observation_category" : name];
  if (threshold !== undefined) {
    let keptCorrect = 0;
    let keptTotal = 0;
    let keptWrong = 0;
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const scores = classNames.map((cn) => ({ className: cn, score: dotProduct(vectors[i], centroids.get(cn) || []) }));
      scores.sort((a, b) => b.score - a.score);
      if (scores[0].score >= threshold) {
        keptTotal += c.count;
        if (scores[0].className === c.expected) keptCorrect += c.count;
        else keptWrong += c.count;
      }
    }
    const coverage = total ? ((keptTotal / total) * 100).toFixed(1) : "0";
    const keptAcc = keptTotal ? ((keptCorrect / keptTotal) * 100).toFixed(1) : "0";
    console.log(`   @threshold ${threshold}: coverage ${coverage}% (${keptTotal}/${total}), accuracy of kept ${keptAcc}% (${keptCorrect}/${keptTotal}), wrong-kept ${keptWrong}`);
  }
  const confPairs = [...confusion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (confPairs.length) {
    console.log("   top confusions:");
    for (const [k, n] of confPairs) console.log(`     ${k}: ${n}`);
  }
  const worst = confidences.incorrect.sort((a, b) => a.conf - b.conf).slice(0, 5);
  if (worst.length) {
    console.log("   sample misclassifications:");
    for (const w of worst) console.log(`     "${w.text}" predicted ${w.predicted}, expected ${w.expected} (conf ${w.conf.toFixed(3)})`);
  }
  return { correct, total };
}

async function main() {
  console.log("Loading manifest...");
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));

  // ---- build suites from ground truth (dedup texts, weight by count) ----
  const obsCases = new Map(); // text|expected -> {text, expected, count, codedCount, codelessCount}
  const allergyCases = new Map();
  const encClassCases = new Map();
  const encTypePrototype = (await loadTask("encounter_type")).protoData;
  const encTypeClasses = new Set(Object.keys(encTypePrototype.classes));
  const encTypeCases = new Map();

  for (const p of manifest.patients) {
    for (const o of p.groundTruth.observations) {
      const key = `${o.text}|${o.expected}`;
      const e = obsCases.get(key) ?? { text: o.text, expected: o.expected, count: 0, codedCount: 0, codelessCount: 0 };
      e.count += 1;
      e[o.coded ? "codedCount" : "codelessCount"] += 1;
      obsCases.set(key, e);
    }
    for (const a of p.groundTruth.allergies) {
      const key = `${a.text}|${a.expected}`;
      const e = allergyCases.get(key) ?? { text: a.text, expected: a.expected, count: 0 };
      e.count += 1;
      allergyCases.set(key, e);
    }
    for (const e of p.groundTruth.encounters) {
      const expectedClass = ENCOUNTER_CLASS_MAP[e.class];
      if (expectedClass) {
        const key = `${e.text}|${expectedClass}`;
        const c = encClassCases.get(key) ?? { text: e.text, expected: expectedClass, count: 0 };
        c.count += 1;
        encClassCases.set(key, c);
      }
      if (encTypeClasses.has(e.expected)) {
        const key = `${e.text}|${e.expected}`;
        const c = encTypeCases.get(key) ?? { text: e.text, expected: e.expected, count: 0 };
        c.count += 1;
        encTypeCases.set(key, c);
      }
    }
  }

  const obsList = [...obsCases.values()].filter((c) =>
    mode === "all" ? true : mode === "codes" ? c.codedCount > 0 : c.codelessCount > 0
  );

  console.log(`unique observation texts: ${obsList.length}, allergy texts: ${allergyCases.size}, encounter texts: ${encClassCases.size}`);

  console.log("Loading transformers.js + fp32 model...");
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  const started = Date.now();
  const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL_ID, { dtype: "fp32", device: "cpu" });
  console.log(`Model loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  async function embed(texts) {
    if (texts.length === 0) return [];
    const out = await extractor(texts, { pooling: "mean", normalize: true });
    return out.tolist();
  }

  const tasks = [
    {
      name: "observation_category",
      classNames: (await loadTask("observation_category")).classNames,
      proto: (await loadTask("observation_category")).protoData,
      cases: obsList.map((c) => ({
        text: c.text,
        expected: c.expected,
        count: mode === "all" ? c.count : mode === "codes" ? c.codedCount : c.codelessCount,
        group: c.codedCount >= c.codelessCount ? "coded" : "codeless"
      })).filter((c) => c.count > 0)
    },
    {
      name: "allergy_type",
      classNames: (await loadTask("allergy_type")).classNames,
      proto: (await loadTask("allergy_type")).protoData,
      cases: [...allergyCases.values()]
    },
    {
      name: "encounter_class",
      classNames: (await loadTask("encounter_class")).classNames,
      proto: (await loadTask("encounter_class")).protoData,
      cases: [...encClassCases.values()]
    },
    {
      name: "encounter_type",
      classNames: [...encTypeClasses].sort(),
      proto: encTypePrototype,
      cases: [...encTypeCases.values()]
    }
  ];

  let totalCorrect = 0;
  let totalCases = 0;

  for (const task of tasks) {
    if (task.cases.length === 0) {
      console.log(`\n=== ${task.name}: no cases ===`);
      continue;
    }
    const centroids = await computeCentroids(task.proto, task.proto, task.classNames, embed);
    const vectors = await embed(task.cases.map((c) => c.text));
    const r = reportSuite(task.name, task.cases, task.classNames, centroids, vectors, mode);
    totalCorrect += r.correct;
    totalCases += r.total;
  }

  console.log(`\n=== OVERALL (${mode}): ${totalCorrect}/${totalCases} (${((totalCorrect / Math.max(totalCases, 1)) * 100).toFixed(1)}%) ===`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
