/**
 * Generic centroid-based classifier for Tier 3 embedding tasks.
 *
 * Each classification task (observation_category, allergy_type, visit_type,
 * etc.) has a prototype JSON file that defines class names and either
 * pre-computed centroid vectors or prototype texts (which are embedded and
 * averaged into centroids at load time).
 *
 * Classification: embed input text → cosine similarity against each class
 * centroid → return (className, confidence).
 */

import { embed, embedOne } from "./embedder";

export interface ClassificationResult {
  className: string;
  confidence: number;
  scores: Array<{ className: string; score: number }>;
}

interface PrototypeFile {
  task: string;
  model: string;
  version: string;
  classes: Record<string, ClassEntry>;
}

interface ClassEntry {
  centroid?: number[];
  prototype_texts?: string[];
}

interface LoadedTask {
  classNames: string[];
  centroids: Map<string, number[]>;
}

const loadedTasks = new Map<string, LoadedTask>();
const loadPromises = new Map<string, Promise<LoadedTask>>();

/** Test-only: inject a prototype JSON object directly, bypassing fetch. */
export function setPrototypeDataForTest(taskName: string, data: PrototypeFile | null): void {
  if (data) {
    const classNames = Object.keys(data.classes).sort();
    const centroids = new Map<string, number[]>();
    const textsToEmbed: string[] = [];
    const textToClass: string[] = [];
    for (const className of classNames) {
      const entry = data.classes[className];
      if (entry.centroid && entry.centroid.length > 0) {
        centroids.set(className, entry.centroid);
      } else if (entry.prototype_texts && entry.prototype_texts.length > 0) {
        for (const text of entry.prototype_texts) {
          textsToEmbed.push(text);
          textToClass.push(className);
        }
      }
    }
    // Store as a pre-loaded promise that embeds texts at first call
    loadPromises.set(taskName, (async (): Promise<LoadedTask> => {
      if (textsToEmbed.length > 0) {
        const vectors = await embed(textsToEmbed);
        const vectorsByClass = new Map<string, number[][]>();
        for (let i = 0; i < vectors.length; i++) {
          const cn = textToClass[i];
          if (!vectorsByClass.has(cn)) vectorsByClass.set(cn, []);
          vectorsByClass.get(cn)!.push(vectors[i]);
        }
        for (const cn of classNames) {
          if (!centroids.has(cn)) {
            const cv = vectorsByClass.get(cn);
            if (cv && cv.length > 0) centroids.set(cn, averageVectors(cv));
          }
        }
      }
      const loaded: LoadedTask = { classNames, centroids };
      loadedTasks.set(taskName, loaded);
      return loaded;
    })());
  } else {
    loadedTasks.delete(taskName);
    loadPromises.delete(taskName);
  }
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const mean = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) mean[i] += vec[i];
  }
  return normalize(mean.map((v) => v / vectors.length));
}

/**
 * Load a task's prototype file and prepare centroids.
 *
 * If the JSON contains pre-computed centroids, they're used directly.
 * Otherwise, prototype texts are embedded on first load and averaged into
 * centroids (one-time cost of ~100-500ms depending on text count).
 */
async function loadTask(taskName: string): Promise<LoadedTask> {
  const existing = loadedTasks.get(taskName);
  if (existing) return existing;

  const existingPromise = loadPromises.get(taskName);
  if (existingPromise) return existingPromise;

  const promise = (async (): Promise<LoadedTask> => {
    const response = await fetch(`/embeddings/prototypes/${taskName}.json`);
    if (!response.ok) {
      throw new Error(`Prototype file not found for task "${taskName}" (${response.status})`);
    }
    const data = (await response.json()) as PrototypeFile;

    const classNames = Object.keys(data.classes).sort();
    const centroids = new Map<string, number[]>();

    // Collect any classes that need runtime centroid computation
    const textsToEmbed: string[] = [];
    const textToClass: string[] = [];

    for (const className of classNames) {
      const entry = data.classes[className];
      if (entry.centroid && entry.centroid.length > 0) {
        centroids.set(className, entry.centroid);
      } else if (entry.prototype_texts && entry.prototype_texts.length > 0) {
        for (const text of entry.prototype_texts) {
          textsToEmbed.push(text);
          textToClass.push(className);
        }
      }
    }

    // Embed prototype texts and compute centroids if needed
    if (textsToEmbed.length > 0) {
      const vectors = await embed(textsToEmbed);
      const vectorsByClass = new Map<string, number[][]>();
      for (let i = 0; i < vectors.length; i++) {
        const className = textToClass[i];
        if (!vectorsByClass.has(className)) vectorsByClass.set(className, []);
        vectorsByClass.get(className)!.push(vectors[i]);
      }
      for (const className of classNames) {
        if (!centroids.has(className)) {
          const classVectors = vectorsByClass.get(className);
          if (classVectors && classVectors.length > 0) {
            centroids.set(className, averageVectors(classVectors));
          }
        }
      }
    }

    const loaded: LoadedTask = { classNames, centroids };
    loadedTasks.set(taskName, loaded);
    return loaded;
  })();

  loadPromises.set(taskName, promise);
  return promise;
}

/**
 * Classify a single text against a task's class centroids.
 *
 * @param taskName - Task identifier (e.g. "observation_category")
 * @param text - Input text to classify
 * @returns Best class name, confidence (cosine similarity), and full scores
 */
export async function classify(taskName: string, text: string): Promise<ClassificationResult> {
  const task = await loadTask(taskName);
  const inputVec = await embedOne(text);

  const scores = task.classNames.map((className) => ({
    className,
    score: dotProduct(inputVec, task.centroids.get(className) ?? [])
  }));
  scores.sort((a, b) => b.score - a.score);

  return {
    className: scores[0].className,
    confidence: scores[0].score,
    scores
  };
}

/**
 * Classify multiple texts in a single batch (more efficient than individual calls).
 *
 * @param taskName - Task identifier
 * @param texts - Array of input texts
 * @returns Array of classification results, one per input text
 */
export async function classifyBatch(taskName: string, texts: string[]): Promise<ClassificationResult[]> {
  if (texts.length === 0) return [];
  const task = await loadTask(taskName);
  const vectors = await embed(texts);

  return vectors.map((inputVec) => {
    const scores = task.classNames.map((className) => ({
      className,
      score: dotProduct(inputVec, task.centroids.get(className) ?? [])
    }));
    scores.sort((a, b) => b.score - a.score);

    return {
      className: scores[0].className,
      confidence: scores[0].score,
      scores
    };
  });
}

/**
 * Pre-load a task's prototypes. Call during idle time to avoid latency
 * on the first classification call.
 */
export async function preloadTask(taskName: string): Promise<void> {
  await loadTask(taskName);
}
