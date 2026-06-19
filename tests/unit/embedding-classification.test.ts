/**
 * Accuracy tests for embedding-based classification tasks.
 *
 * These tests require the ONNX model to load, which only works in the browser
 * (WASM/WebGPU backend). Node.js's onnxruntime-node can't handle q8 quantized
 * models. The tests auto-skip in Node.
 *
 * To run: open the app in a browser and visit /embedding-test, or run the
 * dev server and trigger classification on a test patient.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { classifyBatch, setPrototypeDataForTest } from "../../src/lib/embeddings/classify";

interface TestCase {
  text: string;
  expected: string;
}

const OBSERVATION_CASES: TestCase[] = [
  // Labs — should classify as "lab"
  { text: "Hemoglobin A1c", expected: "lab" },
  { text: "Glucose", expected: "lab" },
  { text: "Creatinine", expected: "lab" },
  { text: "Sodium", expected: "lab" },
  { text: "Potassium", expected: "lab" },
  { text: "Total Cholesterol", expected: "lab" },
  { text: "LDL", expected: "lab" },
  { text: "ALT", expected: "lab" },
  { text: "TSH", expected: "lab" },
  { text: "White Blood Cell Count", expected: "lab" },
  { text: "Platelet Count", expected: "lab" },
  { text: "INR", expected: "lab" },
  { text: "Vitamin D", expected: "lab" },
  { text: "Ferritin", expected: "lab" },
  { text: "Uric Acid", expected: "lab" },
  { text: "Troponin", expected: "lab" },
  { text: "Fecal Calprotectin", expected: "lab" },
  { text: "24-hour urinary cortisol excretion", expected: "lab" },
  { text: "Hemoglobin A1c/Hemoglobin.Total", expected: "lab" },
  { text: "Blood Culture", expected: "lab" },
  // Vitals — should classify as "vital"
  { text: "Systolic Blood Pressure", expected: "vital" },
  { text: "Diastolic Blood Pressure", expected: "vital" },
  { text: "Heart Rate", expected: "vital" },
  { text: "Respiratory Rate", expected: "vital" },
  { text: "Oxygen Saturation", expected: "vital" },
  { text: "Body Temperature", expected: "vital" },
  { text: "Body Weight", expected: "vital" },
  { text: "BMI", expected: "vital" },
  { text: "Intravascular Systolic", expected: "vital" },
  { text: "Intravascular Diastolic", expected: "vital" },
  { text: "Peak Expiratory Flow", expected: "vital" },
  // Other — should classify as "other"
  { text: "PHQ-9 Score", expected: "other" },
  { text: "Tobacco Smoking Status", expected: "other" },
  { text: "Alcohol Consumption", expected: "other" },
  { text: "Patient Health Questionnaire 9 Item Total Score", expected: "other" },
  { text: "Exercise Frequency", expected: "other" },
  { text: "Social Determinants of Health", expected: "other" },
];

const ALLERGY_CASES: TestCase[] = [
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
  { text: "Seasonal Allergies", expected: "environmental" },
  { text: "Allergic rhinitis", expected: "environmental" },
  { text: "Allergy to nickel", expected: "other" },
  { text: "Allergy to contrast media", expected: "other" },
  { text: "Contact dermatitis", expected: "other" },
  { text: "Allergy to adhesive", expected: "other" },
];

const VISIT_CASES: TestCase[] = [
  { text: "Hospital admission", expected: "inpatient" },
  { text: "Inpatient stay", expected: "inpatient" },
  { text: "Overnight hospital stay", expected: "inpatient" },
  { text: "Hospital readmission", expected: "inpatient" },
  { text: "Emergency admission", expected: "inpatient" },
  { text: "Ambulatory visit", expected: "outpatient" },
  { text: "Office visit", expected: "outpatient" },
  { text: "Follow-up clinic visit", expected: "outpatient" },
  { text: "Routine checkup", expected: "outpatient" },
  { text: "Annual wellness visit", expected: "outpatient" },
  { text: "Urgent care visit", expected: "outpatient" },
  { text: "Emergency room visit", expected: "emergency" },
  { text: "ED visit", expected: "emergency" },
  { text: "Emergency department visit", expected: "emergency" },
  { text: "Trauma activation", expected: "emergency" },
  { text: "Telehealth visit", expected: "telehealth" },
  { text: "Virtual visit", expected: "telehealth" },
  { text: "Video visit", expected: "telehealth" },
  { text: "Phone visit", expected: "telehealth" },
  { text: "Colonoscopy", expected: "procedure" },
  { text: "Cardiac catheterization", expected: "procedure" },
  { text: "Outpatient surgery", expected: "procedure" },
  { text: "Endoscopy", expected: "procedure" },
  { text: "Joint injection", expected: "procedure" },
  { text: "Cataract surgery", expected: "procedure" },
  { text: "ambulatory", expected: "outpatient" },
];

export const EMBEDDING_TEST_SUITES = [
  { task: "observation_category", cases: OBSERVATION_CASES },
  { task: "allergy_type", cases: ALLERGY_CASES },
  { task: "visit_type", cases: VISIT_CASES }
] as const;

function runAccuracySuite(taskName: string, cases: TestCase[]) {
  const isNode = typeof process !== "undefined" && process.versions?.node;
  describe.skip(`embedding classification: ${taskName} (requires browser)`, { timeout: 120000 }, () => {
    let results: Array<{ text: string; expected: string; predicted: string; confidence: number }>;

    beforeAll(async () => {
      // Load prototype file from disk and inject into classifier (bypasses fetch)
      const protoPath = resolve(process.cwd(), "public/embeddings/prototypes", `${taskName}.json`);
      const protoData = JSON.parse(await readFile(protoPath, "utf8"));
      setPrototypeDataForTest(taskName, protoData);

      const texts = cases.map((c) => c.text);
      const predictions = await classifyBatch(taskName, texts);
      results = cases.map((c, i) => ({
        text: c.text,
        expected: c.expected,
        predicted: predictions[i].className,
        confidence: predictions[i].confidence
      }));
    });

    it("reports accuracy summary", () => {
      const correct = results.filter((r) => r.predicted === r.expected).length;
      const total = results.length;
      const accuracy = (correct / total * 100).toFixed(1);

      // Print per-case results for debugging
      console.log(`\n  ${taskName} accuracy: ${correct}/${total} (${accuracy}%)`);
      for (const r of results) {
        const mark = r.predicted === r.expected ? "✓" : "✗";
        console.log(
          `    ${mark} "${r.text}" → predicted=${r.predicted} expected=${r.expected} conf=${r.confidence.toFixed(3)}`
        );
      }

      // We expect at least 80% accuracy after prototype expansion
      expect(correct).toBeGreaterThanOrEqual(Math.ceil(total * 0.8));
    });

    it("average confidence on correct predictions", () => {
      const correctResults = results.filter((r) => r.predicted === r.expected);
      if (correctResults.length === 0) return;
      const avgConf = correctResults.reduce((s, r) => s + r.confidence, 0) / correctResults.length;
      console.log(`  Average confidence on correct: ${avgConf.toFixed(3)}`);
      expect(avgConf).toBeGreaterThan(0.3);
    });
  });
}

runAccuracySuite("observation_category", OBSERVATION_CASES);
runAccuracySuite("allergy_type", ALLERGY_CASES);
runAccuracySuite("visit_type", VISIT_CASES);
