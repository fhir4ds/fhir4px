/**
 * Embedding accuracy test suite — paste into browser console at http://localhost:3000
 *
 * Loads the embedding model, fetches prototype files, runs test cases,
 * and prints accuracy results. Takes ~30-60s on first run (model download).
 */
(async () => {
  const { classifyBatch } = await import("/src/lib/embeddings/classify.ts");
  const { preloadEmbedder } = await import("/src/lib/embeddings/embedder.ts");

  console.log("Loading embedding model (may take 10-30s)...");
  await preloadEmbedder();
  console.log("Model loaded. Running accuracy suite...\n");

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

  let totalCorrect = 0;
  let totalCases = 0;

  for (const [task, cases] of Object.entries(SUITES)) {
    const texts = cases.map((c) => c.text);
    const predictions = await classifyBatch(task, texts);
    let correct = 0;
    const details = [];
    cases.forEach((c, i) => {
      const predicted = predictions[i].className;
      const conf = predictions[i].confidence;
      const mark = predicted === c.expected ? "✓" : "✗";
      if (predicted === c.expected) correct++;
      details.push(`  ${mark} "${c.text}" → ${predicted} (expected: ${c.expected}, conf: ${conf.toFixed(3)})`);
    });
    totalCorrect += correct;
    totalCases += cases.length;
    const pct = ((correct / cases.length) * 100).toFixed(1);
    const avgConf = predictions
      .filter((_, i) => predictions[i].className === cases[i].expected)
      .reduce((s, p) => s + p.confidence, 0) / Math.max(1, correct);
    console.log(`\n=== ${task}: ${correct}/${cases.length} (${pct}%) | avg confidence on correct: ${avgConf.toFixed(3)} ===`);
    details.forEach((d) => console.log(d));
  }

  console.log(`\n=== OVERALL: ${totalCorrect}/${totalCases} (${((totalCorrect / totalCases) * 100).toFixed(1)}%) ===`);
  window.__testComplete = true;
})();
