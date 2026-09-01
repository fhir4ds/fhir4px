/** Patient specifications part C (patients 26-27, guideline-campaign fixtures). */

const lab = (ref, months, start, end, noise, decimals, unit, unitCode, opts = {}) => ({
  ref, category: "laboratory", categoryDisplay: "Laboratory", every: opts.every ?? 3,
  from: opts.from ?? 0, to: months, start, end, noise, decimals, unit, unitCode,
  seasonal: opts.seasonal ?? 0, day: opts.day, text: opts.text, clamp: opts.clamp
});

const stdVitals = (months, v) => [
  { ref: "vital.bp_panel", isBpPanel: true, category: "vital-signs", categoryDisplay: "Vital Signs",
    every: 1, from: 0, to: months, start: v.sbp[0], end: v.sbp[1], noise: 6, dbp: v.dbp, day: 4 },
  { ref: "vital.hr", category: "vital-signs", categoryDisplay: "Vital Signs", every: 1, from: 0, to: months,
    start: v.hr[0], end: v.hr[1], noise: 6, decimals: 0, unit: "beats/minute", unitCode: "/min", day: 4 },
  { ref: "vital.weight", category: "vital-signs", categoryDisplay: "Vital Signs", every: 1, from: 0, to: months,
    start: v.wt[0], end: v.wt[1], noise: 1.5, decimals: 1, unit: "lb", unitCode: "[lb_av]", day: 4 },
  { ref: "vital.spo2", category: "vital-signs", categoryDisplay: "Vital Signs", every: 1, from: 0, to: months,
    start: v.spo2?.[0] ?? 97, end: v.spo2?.[1] ?? 97, noise: 0.8, decimals: 0, unit: "%", unitCode: "%", day: 4, clamp: [85, 100] }
];

const fluShots = (startMonth, count) =>
  Array.from({ length: count }, (_, i) => ({ type: "immunization", ref: "vac.influenza", start: startMonth + i * 12, day: 8 + (i % 3) }));

export const PATIENTS_C = [
  // 26. Gus — gout on urate-lowering therapy
  {
    id: "fhir4px-chronic-gus-gout", tier: "M", seed: 126, months: 42,
    anchor: [2023, 2, 20], gender: "male", birthDate: "1967-07-09", race: "white",
    ethnicity: "hispanic", mrn: "C1026", given: ["Gus"], family: "Guerrero",
    focus: "Gout on allopurinol with urate monitoring and colchicine flare coverage",
    smoking: { code: "8517006", display: "Former smoker" },
    messyRate: 0.1,
    panels: [
      ...stdVitals(42, { sbp: [138, 130], dbp: [86, 80], hr: [76, 74], wt: [216, 210] }),
      lab("lab.urate", 42, 8.9, 5.4, 0.6, 1, "mg/dL", "mg/dL", { every: 2, day: 9, clamp: [3.0, 12.0] }),
      lab("lab.creatinine", 42, 1.12, 1.15, 0.06, 2, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.hgb", 42, 14.6, 14.5, 0.4, 1, "g/dL", "g/dL", { every: 6, day: 9 }),
      lab("lab.alt", 42, 32, 30, 5, 0, "U/L", "U/L", { every: 6, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.gout", onset: "2019-08-12" },
      { type: "condition", ref: "icd.gout", onset: "2019-08-12" },
      { type: "condition", ref: "cond.htn", onset: "2016-05-02" },
      { type: "condition", ref: "cond.hyperlipidemia", onset: "2017-11-17" },
      { type: "med", ref: "med.allopurinol_100", start: 0, stop: 6, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.allopurinol_300", start: 6, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.colchicine_06", start: 0, sig: "1 tablet by mouth twice daily for 3 days at first sign of flare" },
      { type: "med", ref: "med.amlodipine_5", start: 0, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.atorvastatin_20", start: 0, sig: "1 tablet by mouth nightly" },
      { type: "encounter", start: 9, class: "EMER", days: 1, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "cond.gout", diagnosis: true, onset: null, text: "Acute gout flare, first MTP" }],
        observations: [
          { ref: "vital.bp_panel", isBpPanel: true, sbpValue: 146, dbpValue: 92 },
          { ref: "lab.urate", category: "laboratory", categoryDisplay: "Laboratory", value: 9.8, unit: "mg/dL", unitCode: "mg/dL" }
        ],
        meds: [{ ref: "med.colchicine_06", sig: "1 tablet by mouth twice daily for 3 days" }, { ref: "med.prednisone_20", sig: "1 tablet by mouth daily for 5 days" }] },
      { type: "encounter", start: 26, class: "EMER", days: 1, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "cond.gout", diagnosis: true, onset: null, text: "Acute gout flare on allopurinol" }],
        meds: [{ ref: "med.colchicine_06", sig: "1 tablet by mouth twice daily for 3 days" }] },
      { type: "encounter", start: 20, typeText: "Consultation", visitType: "Consultation" },
      { type: "encounter", start: 40, typeText: "Encounter for Check Up", visitType: "Encounter for Check Up" },
      ...fluShots(4, 4)
    ]
  },

  // 27. Sam — clozapine-treated schizophrenia with ANC monitoring
  {
    id: "fhir4px-chronic-sam-schizophrenia", tier: "M", seed: 127, months: 48,
    anchor: [2022, 4, 11], gender: "male", birthDate: "1981-03-25", race: "asian",
    ethnicity: "non_hispanic", mrn: "C1027", given: ["Sam"], family: "Bhatt",
    focus: "Clozapine-treated schizophrenia with ANC and metabolic monitoring",
    smoking: { code: "449868002", display: "Current every day smoker" },
    messyRate: 0.1,
    panels: [
      ...stdVitals(48, { sbp: [124, 126], dbp: [78, 80], hr: [86, 88], wt: [178, 198] }),
      { ref: "vital.bmi", category: "vital-signs", categoryDisplay: "Vital Signs", every: 3, from: 0, to: 48,
        start: 26.1, end: 28.9, noise: 0.3, decimals: 1, unit: "kg/m2", unitCode: "kg/m2", day: 4 },
      lab("lab.anc", 48, 3100, 3900, 350, 0, "cells/uL", "{cells}/uL", { every: 1, day: 9, clamp: [1500, 9000] }),
      lab("lab.wbc", 48, 6.8, 7.4, 0.5, 1, "10*3/uL", "10*3/uL", { every: 1, day: 9, clamp: [3.0, 12.0] }),
      lab("lab.clozapine_level", 48, 480, 620, 70, 0, "ng/mL", "ng/mL", { every: 3, day: 9, clamp: [100, 1300] }),
      lab("lab.a1c", 48, 5.9, 6.4, 0.2, 1, "%", "%", { every: 6, day: 9 }),
      lab("lab.ldl", 48, 112, 124, 8, 0, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.trig", 48, 168, 205, 18, 0, "mg/dL", "mg/dL", { every: 6, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.schizophrenia", onset: "2009-10-02", text: "Schizophrenia, paranoid type" },
      { type: "condition", ref: "icd.schizophrenia", onset: "2009-10-02" },
      { type: "condition", ref: "cond.t2dm", onset: "2023-08-14", text: "Antipsychotic-associated type 2 diabetes" },
      { type: "condition", ref: "cond.obesity", onset: "2023-02-06" },
      { type: "med", ref: "med.clozapine_100", start: 0, sig: "1 tablet by mouth at bedtime, titrated to 4 tablets nightly per ANC" },
      { type: "med", ref: "med.metformin_500", start: 18, sig: "1 tablet by mouth twice daily" },
      { type: "encounter", start: 12, typeText: "Consultation", visitType: "Consultation",
        observations: [
          { ref: "lab.anc", category: "laboratory", categoryDisplay: "Laboratory", value: 2450, unit: "cells/uL", unitCode: "{cells}/uL" },
          { ref: "lab.clozapine_level", category: "laboratory", categoryDisplay: "Laboratory", value: 940, unit: "ng/mL", unitCode: "ng/mL" }
        ] },
      { type: "encounter", start: 30, class: "EMER", days: 1, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "cond.t2dm", diagnosis: true, onset: null, text: "Hyperglycemia" }],
        observations: [
          { ref: "lab.glucose", category: "laboratory", categoryDisplay: "Laboratory", value: 218, unit: "mg/dL", unitCode: "mg/dL" },
          { ref: "lab.a1c", category: "laboratory", categoryDisplay: "Laboratory", value: 7.1, unit: "%", unitCode: "%" }
        ] },
      { type: "encounter", start: 46, typeText: "Consultation", visitType: "Consultation" },
      ...fluShots(6, 4), ...Array.from({ length: 2 }, (_, i) => ({ type: "immunization", ref: "vac.covid19", start: 8 + i * 7, day: 12 }))
    ]
  }
];
