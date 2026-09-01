/** Patient specifications for the chronic-condition cohort. */

const vital = (ref, months, start, end, noise, decimals, unit, unitCode, opts = {}) => ({
  ref, category: "vital-signs", categoryDisplay: "Vital Signs", every: opts.every ?? 1,
  from: opts.from ?? 0, to: months, start, end, noise, decimals, unit, unitCode,
  seasonal: opts.seasonal ?? 0, day: opts.day, text: opts.text, clamp: opts.clamp
});

const lab = (ref, months, start, end, noise, decimals, unit, unitCode, opts = {}) => ({
  ref, category: "laboratory", categoryDisplay: "Laboratory", every: opts.every ?? 3,
  from: opts.from ?? 0, to: months, start, end, noise, decimals, unit, unitCode,
  seasonal: opts.seasonal ?? 0, day: opts.day, text: opts.text, clamp: opts.clamp
});

const bpPanel = (months, v) => ({
  ref: "vital.bp_panel", isBpPanel: true, category: "vital-signs", categoryDisplay: "Vital Signs",
  every: 1, from: 0, to: months, start: v.sbp[0], end: v.sbp[1], noise: 6, dbp: v.dbp, day: 4
});
const stdVitals = (months, v) => [
  bpPanel(months, v),
  vital("vital.hr", months, v.hr[0], v.hr[1], 6, 0, "beats/minute", "/min", { day: 4 }),
  vital("vital.weight", months, v.wt[0], v.wt[1], 1.5, 1, "lb", "[lb_av]", { day: 4 }),
  vital("vital.spo2", months, v.spo2?.[0] ?? 97, v.spo2?.[1] ?? 97, 0.8, 0, "%", "%", { day: 4, clamp: [85, 100] })
];

const fluShots = (startMonth, count) =>
  Array.from({ length: count }, (_, i) => ({ type: "immunization", ref: "vac.influenza", start: startMonth + i * 12, day: 8 + (i % 3) }));
const covidShots = (startMonth, count) =>
  Array.from({ length: count }, (_, i) => ({ type: "immunization", ref: "vac.covid19", start: startMonth + i * 7, day: 12 }));

const ALG = {
  penicillin: { allergyCategory: "medication", allergyExpected: "medication" },
  sulfa: { allergyCategory: "medication", allergyExpected: "medication" },
  aspirin: { allergyCategory: "medication", allergyExpected: "medication" },
  codeine: { allergyCategory: "medication", allergyExpected: "medication" },
  contrast: { allergyCategory: "medication", allergyExpected: "other" },
  pollens: { allergyCategory: "environment", allergyExpected: "environmental" },
  cat_dander: { allergyCategory: "environment", allergyExpected: "environmental" },
  dust_mite: { allergyCategory: "environment", allergyExpected: "environmental" },
  latex: { allergyCategory: "environment", allergyExpected: "environmental" },
  peanut: { allergyCategory: "food", allergyExpected: "food" },
  egg: { allergyCategory: "food", allergyExpected: "food" },
  shellfish: { allergyCategory: "food", allergyExpected: "food" }
};
const alg = (ref, start = 0) => ({ type: "allergy", ref: `alg.${ref}`, start, ...ALG[ref] });

const PATIENTS_A = [
  // 1. Mabel — mild intermittent atopic asthma
  {
    id: "fhir4px-chronic-mabel-atopic-asthma", tier: "M", seed: 101, months: 30,
    anchor: [2024, 1, 12], gender: "female", birthDate: "1991-06-30", race: "white",
    ethnicity: "non_hispanic", mrn: "C1001", given: ["Mabel"], family: "Okafor",
    focus: "Mild intermittent asthma with atopic comorbidities",
    messyRate: 0.1,
    panels: [
      ...stdVitals(30, { sbp: [112, 110], dbp: [72, 70], hr: [74, 72], wt: [148, 147] }),
      lab("lab.eosinophils", 30, 6.5, 5.0, 1.2, 1, "%", "%", { every: 12, day: 9 }),
      lab("lab.vitamin_d", 30, 24, 30, 2, 0, "ng/mL", "ng/mL", { every: 12, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.asthma", onset: "2019-04-18", text: "Mild intermittent asthma" },
      { type: "condition", ref: "cond.allergic_rhinitis", onset: "2015-03-02" },
      { type: "condition", ref: "cond.atopic_dermatitis", onset: "2016-08-11", text: "Atopic dermatitis, intermittent" },
      { type: "med", ref: "med.albuterol_hfa", start: 0, sig: "2 puffs inhaled every 4-6 hours as needed for wheeze" },
      { type: "med", ref: "med.fluticasone_nasal", start: 0, sig: "2 sprays each nostril once daily" },
      { type: "med", ref: "med.cetirizine", start: 13, sig: "1 tablet by mouth once daily" },
      { type: "med", ref: "med.hydrocortisone_cream", start: 2, sig: "Apply thin layer to affected areas twice daily as needed" },
      alg("pollens"), alg("cat_dander"), alg("dust_mite"),
      { type: "encounter", start: 4, typeText: "Encounter for Check Up", visitType: "Encounter for Check Up",
        procedures: [{ ref: "proc.spirometry" }],
        observations: [{ ref: "lab.fev1_fvc", category: "laboratory", categoryDisplay: "Laboratory", value: 0.87, unit: "%", unitCode: "%" }] },
      { type: "encounter", start: 17, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "cond.asthma", diagnosis: true, onset: null, text: "Asthma exacerbation, mild" }],
        meds: [{ ref: "med.prednisone_20", sig: "1 tablet by mouth daily for 5 days" }] },
      { type: "encounter", start: 28, typeText: "Annual Visit", visitType: "Annual Visit",
        procedures: [{ ref: "proc.spirometry" }],
        observations: [{ ref: "lab.fev1_fvc", category: "laboratory", categoryDisplay: "Laboratory", value: 0.91, unit: "%", unitCode: "%" }] },
      ...fluShots(6, 3)
    ]
  },

  // 2. Raul — severe eosinophilic asthma (XL)
  {
    id: "fhir4px-chronic-raul-severe-eosinophilic-asthma", tier: "XL", seed: 102, months: 108,
    anchor: [2017, 3, 8], gender: "male", birthDate: "1973-11-22", race: "white",
    ethnicity: "hispanic", mrn: "C1002", given: ["Raul"], family: "Delgado",
    focus: "Severe persistent eosinophilic asthma on biologic therapy",
    messyRate: 0.09,
    panels: [
      vital("vital.peak_flow", 108, 235, 400, 25, 0, "L/min", "L/min", { every: 1, day: 6, seasonal: 15 }),
      vital("vital.spo2", 108, 93, 96, 1, 0, "%", "%", { day: 4, clamp: [86, 99] }),
      vital("vital.rr", 108, 22, 18, 2, 0, "breaths/minute", "/min", { day: 4 }),
      ...stdVitals(108, { sbp: [132, 126], dbp: [84, 78], hr: [88, 76], wt: [241, 236] }),
      lab("lab.fev1", 108, 1.65, 2.15, 0.12, 2, "L", "L", { every: 6, day: 9 }),
      lab("lab.eosinophils", 108, 11.5, 2.5, 1.5, 1, "%", "%", { every: 3, day: 9, clamp: [0.1, 18] }),
      lab("lab.feno", 108, 68, 28, 6, 0, "[ppb]", "[ppb]", { every: 3, day: 9 }),
      lab("lab.creatinine", 108, 1.0, 1.05, 0.06, 2, "mg/dL", "mg/dL", { every: 12, day: 9 }),
      lab("lab.hgb", 108, 14.1, 14.0, 0.5, 1, "g/dL", "g/dL", { every: 6, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.severe_persistent_asthma", onset: "2018-01-30", text: "Severe persistent eosinophilic asthma" },
      { type: "condition", ref: "icd.asthma_severe", onset: "2018-01-30", text: "Severe persistent asthma" },
      { type: "condition", ref: "cond.chronic_sinusitis", onset: "2016-09-14" },
      { type: "condition", ref: "cond.gerd", onset: "2017-05-02" },
      { type: "condition", ref: "cond.osa", onset: "2021-06-20" },
      { type: "condition", ref: "cond.obesity", onset: "2020-02-11" },
      { type: "condition", ref: "cond.bronchiectasis", onset: "2022-08-04" },
      alg("pollens"), alg("dust_mite"), alg("aspirin"),
      { type: "med", ref: "med.fluticasone_salmeterol", start: 0, sig: "1 inhalation by mouth twice daily" },
      { type: "med", ref: "med.montelukast", start: 10, stop: 72, sig: "1 tablet by mouth nightly" },
      { type: "med", ref: "med.tiotropium", start: 48, sig: "2 capsule inhalations once daily" },
      { type: "med", ref: "med.omalizumab", start: 34, stop: 71, sig: "150 mg subcutaneous injection every 2 weeks" },
      { type: "med", ref: "med.mepolizumab", start: 72, sig: "100 mg subcutaneous injection every 4 weeks" },
      { type: "med", ref: "med.albuterol_hfa", start: 0, sig: "2 puffs inhaled every 4 hours as needed" },
      { type: "med", ref: "med.fluticasone_nasal", start: 6, sig: "2 sprays each nostril once daily" },
      { type: "encounter", start: 22, class: "EMER", days: 1, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "icd.asthma_severe", diagnosis: true, onset: null, text: "Status asthmaticus" }],
        observations: [
          { ref: "vital.spo2", category: "vital-signs", categoryDisplay: "Vital Signs", value: 87, unit: "%", unitCode: "%" },
          { ref: "vital.hr", category: "vital-signs", categoryDisplay: "Vital Signs", value: 122, unit: "beats/minute", unitCode: "/min" },
          { ref: "vital.peak_flow", category: "vital-signs", categoryDisplay: "Vital Signs", value: 165, unit: "L/min", unitCode: "L/min" }
        ],
        meds: [{ ref: "med.prednisone_20", sig: "2 tablets by mouth daily for 5 days" }],
        procedures: [{ ref: "proc.ed_visit" }] },
      { type: "encounter", start: 45, class: "EMER", days: 1, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "icd.asthma_severe", diagnosis: true, onset: null, text: "Asthma exacerbation" }],
        observations: [
          { ref: "vital.spo2", category: "vital-signs", categoryDisplay: "Vital Signs", value: 91, unit: "%", unitCode: "%" }
        ],
        meds: [{ ref: "med.prednisone_20", sig: "1 tablet by mouth daily for 5 days" }] },
      { type: "encounter", start: 70, class: "EMER", days: 2, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "icd.asthma_severe", diagnosis: true, onset: null, text: "Asthma exacerbation with bronchitis" }],
        observations: [
          { ref: "vital.spo2", category: "vital-signs", categoryDisplay: "Vital Signs", value: 90, unit: "%", unitCode: "%" },
          { ref: "lab.wbc", category: "laboratory", categoryDisplay: "Laboratory", value: 12.4, unit: "10*3/uL", unitCode: "10*3/uL" }
        ],
        meds: [
          { ref: "med.prednisone_20", sig: "2 tablets by mouth daily for 5 days" },
          { ref: "med.azithromycin_250", sig: "1 tablet by mouth daily for 5 days" }
        ] },
      { type: "encounter", start: 51, typeText: "Consultation", visitType: "Consultation",
        procedures: [{ ref: "proc.sleep_study" }] },
      { type: "encounter", start: 53, typeText: "Consultation", visitType: "Consultation",
        procedures: [{ ref: "proc.cpap" }] },
      { type: "procedure", ref: "proc.spirometry", start: 5 },
      { type: "procedure", ref: "proc.spirometry", start: 29 },
      { type: "procedure", ref: "proc.spirometry", start: 65 },
      { type: "procedure", ref: "proc.spirometry", start: 101 },
      ...fluShots(8, 9), ...covidShots(46, 3),
      { type: "immunization", ref: "vac.pneumococcal23", start: 50, day: 14 }
    ]
  },

  // 3. Frank — post-MI ASCVD with T2DM
  {
    id: "fhir4px-chronic-frank-post-mi", tier: "L", seed: 103, months: 60,
    anchor: [2021, 3, 2], gender: "male", birthDate: "1964-09-14", race: "white",
    ethnicity: "non_hispanic", mrn: "C1003", given: ["Frank"], family: "Kowalski",
    focus: "Post-MI secondary prevention (DAPT, statin, cardiac rehab)",
    messyRate: 0.1,
    panels: [
      ...stdVitals(60, { sbp: [150, 128], dbp: [92, 78], hr: [78, 68], wt: [232, 218] }),
      lab("lab.ldl", 60, 148, 58, 8, 0, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.hdl", 60, 36, 44, 3, 0, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.trig", 60, 198, 142, 18, 0, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.total_chol", 60, 224, 132, 12, 0, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.a1c", 60, 7.9, 7.0, 0.3, 1, "%", "%", { every: 6, day: 9 }),
      lab("lab.creatinine", 60, 1.05, 1.12, 0.06, 2, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.potassium", 60, 4.4, 4.6, 0.25, 1, "mmol/L", "mmol/L", { every: 6, day: 9 }),
      lab("lab.alt", 60, 34, 28, 5, 0, "U/L", "U/L", { every: 12, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.mi_history", onset: "2021-03-02", text: "Anterior STEMI s/p PCI" },
      { type: "condition", ref: "icd.mi_old", onset: "2021-03-02" },
      { type: "condition", ref: "cond.t2dm", onset: "2015-07-19" },
      { type: "condition", ref: "cond.htn", onset: "2012-01-05" },
      { type: "condition", ref: "cond.hyperlipidemia", onset: "2012-01-05" },
      { type: "condition", ref: "cond.pad", onset: "2023-05-12", text: "Mild claudication, right calf" },
      { type: "med", ref: "med.aspirin_81", start: 0, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.ticagrelor_90", start: 0, stop: 12, sig: "1 tablet by mouth twice daily for 1 year" },
      { type: "med", ref: "med.atorvastatin_80", start: 0, sig: "1 tablet by mouth nightly" },
      { type: "med", ref: "med.metoprolol_succinate_25", start: 0, stop: 8, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.metoprolol_succinate_100", start: 8, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.lisinopril_10", start: 0, stop: 18, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.lisinopril_20", start: 18, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.nitroglycerin_sl", start: 1, sig: "1 spray under tongue for chest pain, may repeat once after 5 minutes" },
      { type: "med", ref: "med.metformin_500", start: 0, sig: "1 tablet by mouth twice daily" },
      { type: "encounter", start: 0, class: "IMP", days: 5, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "icd.STEMI", diagnosis: true, onset: null, text: "Acute ST-elevation myocardial infarction, anterior wall" }],
        observations: [
          { ref: "lab.troponin_i", category: "laboratory", categoryDisplay: "Laboratory", value: 4.8, unit: "ng/mL", unitCode: "ng/mL" },
          { ref: "vital.bp_panel", isBpPanel: true, sbpValue: 158, dbpValue: 96 },
          { ref: "vital.hr", category: "vital-signs", categoryDisplay: "Vital Signs", value: 96, unit: "beats/minute", unitCode: "/min" }
        ],
        procedures: [
          { ref: "proc.cardiac_cath", text: "Left heart catheterization showing 95% LAD occlusion" },
          { ref: "proc.pci_stent", text: "Drug-eluting stent to LAD" },
          { ref: "proc.ecg" }
        ] },
      { type: "procedure", ref: "proc.echo", start: 0, day: 14 },
      { type: "procedure", ref: "proc.echo", start: 24 },
      { type: "procedure", ref: "proc.echo", start: 54 },
      { type: "procedure", ref: "proc.stress_test", start: 26 },
      { type: "encounter", start: 1, typeText: "Cardiovascular Procedures", visitType: "Cardiovascular Procedures" },
      { type: "encounter", start: 3, typeText: "Consultation", visitType: "Consultation" },
      { type: "encounter", start: 6, typeText: "Consultation", visitType: "Consultation" },
      { type: "encounter", start: 12, typeText: "Encounter for Check Up", visitType: "Encounter for Check Up" },
      { type: "encounter", start: 30, typeText: "Consultation", visitType: "Consultation" },
      { type: "encounter", start: 54, typeText: "Encounter for Check Up", visitType: "Encounter for Check Up" },
      ...fluShots(9, 5), ...covidShots(9, 2),
      { type: "immunization", ref: "vac.pneumococcal23", start: 4, day: 18 }
    ]
  },

  // 4. Grace — ischemic stroke with carotid disease
  {
    id: "fhir4px-chronic-grace-stroke", tier: "M", seed: 104, months: 42,
    anchor: [2022, 6, 7], gender: "female", birthDate: "1957-02-28", race: "black",
    ethnicity: "non_hispanic", mrn: "C1004", given: ["Grace"], family: "Mensah",
    focus: "Ischemic stroke with residual hemiparesis, carotid endarterectomy",
    messyRate: 0.1,
    panels: [
      ...stdVitals(42, { sbp: [168, 134], dbp: [96, 80], hr: [82, 74], wt: [172, 166] }),
      lab("lab.ldl", 42, 138, 62, 8, 0, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.hdl", 42, 42, 48, 3, 0, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.a1c", 42, 6.1, 5.9, 0.2, 1, "%", "%", { every: 12, day: 9 }),
      lab("lab.creatinine", 42, 0.92, 0.98, 0.06, 2, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.hgb", 42, 12.8, 12.6, 0.4, 1, "g/dL", "g/dL", { every: 6, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.stroke_ischemic", onset: "2022-06-07", text: "Acute ischemic stroke, left MCA territory" },
      { type: "condition", ref: "icd.stroke", onset: "2022-06-07" },
      { type: "condition", ref: "cond.hemiparesis", onset: "2022-06-07", text: "Right hemiparesis post stroke" },
      { type: "condition", ref: "cond.carotid_stenosis", onset: "2022-06-08", text: "80% left internal carotid stenosis" },
      { type: "condition", ref: "cond.htn", onset: "2008-04-01" },
      { type: "condition", ref: "cond.hyperlipidemia", onset: "2010-09-15" },
      { type: "condition", ref: "cond.afib", onset: "2022-06-20", text: "Paroxysmal atrial fibrillation detected on telemetry" },
      { type: "med", ref: "med.atorvastatin_80", start: 0, sig: "1 tablet by mouth nightly" },
      { type: "med", ref: "med.amlodipine_5", start: 0, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.metoprolol_tartrate_25", start: 0, sig: "1 tablet by mouth twice daily" },
      { type: "med", ref: "med.apixaban_5", start: 1, sig: "1 tablet by mouth twice daily" },
      { type: "encounter", start: 0, class: "IMP", days: 6, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "icd.stroke", diagnosis: true, onset: null, text: "Acute ischemic stroke" }],
        observations: [
          { ref: "lab.nat_k", category: "survey", categoryDisplay: "Survey", value: 16, unit: "{score}", unitCode: "{score}", text: "NIH stroke scale 16" },
          { ref: "vital.bp_panel", isBpPanel: true, sbpValue: 186, dbpValue: 104 }
        ],
        procedures: [
          { ref: "proc.ct_head", text: "Noncontrast head CT showing acute left MCA infarct" },
          { ref: "proc.mri_brain" },
          { ref: "proc.ecg", text: "ECG showing new atrial fibrillation" }
        ] },
      { type: "encounter", start: 8, class: "IMP", days: 3, typeText: "Cardiovascular Procedures", visitType: "Cardiovascular Procedures",
        procedures: [{ ref: "proc.carotid_endarterectomy", text: "Left carotid endarterectomy" }],
        observations: [{ ref: "lab.nat_k", category: "survey", categoryDisplay: "Survey", value: 6, unit: "{score}", unitCode: "{score}", text: "NIH stroke scale 6" }] },
      { type: "encounter", start: 2, typeText: "Consultation", visitType: "Consultation",
        observations: [{ ref: "lab.nat_k", category: "survey", categoryDisplay: "Survey", value: 11, unit: "{score}", unitCode: "{score}", text: "NIH stroke scale 11" }] },
      { type: "procedure", ref: "proc.pt", start: 1, day: 20 },
      { type: "procedure", ref: "proc.pt", start: 2 },
      { type: "procedure", ref: "proc.pt", start: 3 },
      { type: "procedure", ref: "proc.pt", start: 4 },
      { type: "procedure", ref: "proc.pt", start: 5 },
      { type: "procedure", ref: "proc.pt", start: 6 },
      { type: "encounter", start: 18, typeText: "Encounter for Check Up", visitType: "Encounter for Check Up",
        observations: [{ ref: "lab.nat_k", category: "survey", categoryDisplay: "Survey", value: 3, unit: "{score}", unitCode: "{score}", text: "NIH stroke scale 3" }] },
      { type: "encounter", start: 39, typeText: "Consultation", visitType: "Consultation" },
      ...fluShots(5, 4), ...covidShots(7, 1)
    ]
  },

  // 5. Tessa — T1D on pump with autoimmune comorbidities
  {
    id: "fhir4px-chronic-tessa-t1d", tier: "L", seed: 105, months: 72,
    anchor: [2019, 9, 3], gender: "female", birthDate: "1998-12-05", race: "white",
    ethnicity: "non_hispanic", mrn: "C1005", given: ["Tessa"], family: "Lindqvist",
    focus: "Type 1 diabetes on insulin pump with Hashimoto and celiac disease",
    messyRate: 0.1,
    panels: [
      ...stdVitals(72, { sbp: [112, 110], dbp: [70, 69], hr: [76, 72], wt: [152, 156] }),
      lab("lab.a1c", 72, 8.9, 7.1, 0.3, 1, "%", "%", { every: 3, day: 9 }),
      lab("lab.tsh", 72, 3.4, 2.2, 0.4, 2, "uIU/mL", "u[IU]/mL", { every: 6, day: 9 }),
      lab("lab.glucose", 72, 172, 138, 45, 0, "mg/dL", "mg/dL", { every: 1, day: 2, clamp: [55, 320] }),
      lab("lab.ketones", 72, 0.2, 0.1, 0.1, 1, "mmol/L", "mmol/L", { every: 6, day: 9, clamp: [0.1, 0.4] })
    ],
    schedule: [
      { type: "condition", ref: "cond.t1dm", onset: "2011-04-17", text: "Type 1 diabetes, insulin pump" },
      { type: "condition", ref: "cond.hashimoto", onset: "2019-01-22" },
      { type: "condition", ref: "cond.celiac", onset: "2023-02-14" },
      { type: "med", ref: "med.insulin_lispro", start: 0, sig: "Insulin pump: continuous subcutaneous infusion, basal 18 units/day" },
      { type: "med", ref: "med.insulin_lispro", start: 30, sig: "Insulin pump: basal 16.5 units/day, carb ratio 1:10" },
      { type: "med", ref: "med.insulin_lispro", start: 60, sig: "Insulin pump: basal 15 units/day, carb ratio 1:12" },
      { type: "med", ref: "med.levothyroxine_50", start: 0, stop: 40, sig: "1 tablet by mouth every morning" },
      { type: "med", ref: "med.levothyroxine_75", start: 40, sig: "1 tablet by mouth every morning" },
      { type: "encounter", start: 32, class: "IMP", days: 2, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "icd.t1dm", diagnosis: true, onset: null, text: "Diabetic ketoacidosis" }],
        observations: [
          { ref: "lab.glucose", category: "laboratory", categoryDisplay: "Laboratory", value: 384, unit: "mg/dL", unitCode: "mg/dL" },
          { ref: "lab.ketones", category: "laboratory", categoryDisplay: "Laboratory", value: 4.6, unit: "mmol/L", unitCode: "mmol/L" },
          { ref: "lab.anion_gap", category: "laboratory", categoryDisplay: "Laboratory", value: 18, unit: "mmol/L", unitCode: "mmol/L" },
          { ref: "lab.bicarbonate", category: "laboratory", categoryDisplay: "Laboratory", value: 14, unit: "mmol/L", unitCode: "mmol/L" }
        ] },
      { type: "encounter", start: 40, typeText: "Consultation", visitType: "Consultation",
        observations: [
          { ref: "lab.ttg_iga", category: "laboratory", categoryDisplay: "Laboratory", value: 42, unit: "U/mL", unitCode: "U/mL" }
        ] },
      { type: "encounter", start: 44, typeText: "Consultation", visitType: "Consultation",
        observations: [{ ref: "lab.anti_tpo", category: "laboratory", categoryDisplay: "Laboratory", value: 120, unit: "U/mL", unitCode: "U/mL" }] },
      { type: "procedure", ref: "proc.eye_exam", start: 12 },
      { type: "procedure", ref: "proc.eye_exam", start: 36 },
      { type: "procedure", ref: "proc.eye_exam", start: 60 },
      { type: "encounter", start: 6, typeText: "Annual Visit", visitType: "Annual Visit" },
      { type: "encounter", start: 24, typeText: "Annual Visit", visitType: "Annual Visit" },
      { type: "encounter", start: 48, typeText: "Annual Visit", visitType: "Annual Visit" },
      { type: "encounter", start: 70, typeText: "Annual Visit", visitType: "Annual Visit" },
      ...fluShots(3, 6), ...covidShots(20, 2),
      { type: "immunization", ref: "vac.hpv", start: 2, day: 10 },
      { type: "immunization", ref: "vac.hpv", start: 8, day: 10 }
    ]
  },

  // 6. Omar — T2D / obesity / OSA metabolic cluster
  {
    id: "fhir4px-chronic-omar-metabolic", tier: "M", seed: 106, months: 36,
    anchor: [2023, 1, 9], gender: "male", birthDate: "1980-05-30", race: "asian",
    ethnicity: "non_hispanic", mrn: "C1006", given: ["Omar"], family: "Haddad",
    focus: "Type 2 diabetes with obesity and obstructive sleep apnea",
    messyRate: 0.1,
    panels: [
      ...stdVitals(36, { sbp: [138, 124], dbp: [88, 78], hr: [82, 74], wt: [248, 196], spo2: [96, 97] }),
      vital("vital.bmi", 36, 35.8, 28.3, 0.3, 1, "kg/m2", "kg/m2", { day: 4 }),
      lab("lab.a1c", 36, 8.6, 6.8, 0.25, 1, "%", "%", { every: 3, day: 9 }),
      lab("lab.ldl", 36, 132, 88, 8, 0, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.hdl", 36, 34, 42, 3, 0, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.trig", 36, 210, 138, 20, 0, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.alt", 36, 68, 34, 6, 0, "U/L", "U/L", { every: 6, day: 9 }),
      lab("lab.creatinine", 36, 0.98, 0.95, 0.05, 2, "mg/dL", "mg/dL", { every: 6, day: 9 }),
    ],
    schedule: [
      { type: "condition", ref: "cond.t2dm", onset: "2020-08-11" },
      { type: "condition", ref: "icd.t2dm", onset: "2020-08-11" },
      { type: "condition", ref: "cond.obesity", onset: "2018-03-04" },
      { type: "condition", ref: "cond.osa", onset: "2023-04-19" },
      { type: "condition", ref: "cond.htn", onset: "2019-06-25" },
      { type: "condition", ref: "cond.hyperlipidemia", onset: "2019-06-25" },
      { type: "med", ref: "med.metformin_500", start: 0, stop: 12, sig: "1 tablet by mouth twice daily" },
      { type: "med", ref: "med.metformin_er1000", start: 12, sig: "1 tablet by mouth twice daily with meals" },
      { type: "med", ref: "med.semaglutide_pen", start: 13, sig: "0.25 mg subcutaneous once weekly for 4 weeks, then 0.5 mg weekly" },
      { type: "med", ref: "med.lisinopril_10", start: 0, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.atorvastatin_20", start: 0, sig: "1 tablet by mouth nightly" },
      { type: "encounter", start: 3, typeText: "Consultation", visitType: "Consultation",
        procedures: [{ ref: "proc.sleep_study" }] },
      { type: "encounter", start: 5, typeText: "Consultation", visitType: "Consultation",
        procedures: [{ ref: "proc.cpap" }] },
      { type: "encounter", start: 17, typeText: "Encounter for Check Up", visitType: "Encounter for Check Up" },
      { type: "encounter", start: 33, typeText: "Annual Visit", visitType: "Annual Visit" },
      ...fluShots(10, 3), ...covidShots(10, 1)
    ]
  },

  // 7. Danielle — diabetic ESRD on hemodialysis (XL)
  {
    id: "fhir4px-chronic-danielle-esrd", tier: "XL", seed: 107, months: 108,
    anchor: [2017, 7, 5], gender: "female", birthDate: "1954-10-19", race: "black",
    ethnicity: "non_hispanic", mrn: "C1007", given: ["Danielle"], family: "Washington",
    focus: "Diabetic ESRD on in-center hemodialysis",
    messyRate: 0.08,
    panels: [
      ...stdVitals(108, { sbp: [156, 142], dbp: [88, 78], hr: [84, 80], wt: [183, 176], spo2: [95, 95] }),
      lab("lab.egfr", 108, 46, 7, 1.5, 0, "mL/min/1.73m2", "mL/min/{1.73_m2}", { every: 3, day: 9, clamp: [4, 60] }),
      lab("lab.creatinine", 108, 1.6, 4.8, 0.15, 2, "mg/dL", "mg/dL", { every: 3, day: 9 }),
      lab("lab.a1c", 108, 8.2, 7.4, 0.3, 1, "%", "%", { every: 3, day: 9 }),
      lab("lab.potassium", 108, 4.6, 5.1, 0.3, 1, "mmol/L", "mmol/L", { every: 1, day: 9, clamp: [3.4, 6.2] }),
      lab("lab.hgb", 108, 10.2, 10.8, 0.4, 1, "g/dL", "g/dL", { every: 1, day: 9 }),
      lab("lab.phosphorus", 108, 4.8, 5.4, 0.5, 1, "mg/dL", "mg/dL", { every: 1, day: 9 }),
      lab("lab.calcium", 108, 8.9, 8.8, 0.3, 1, "mg/dL", "mg/dL", { every: 1, day: 9 }),
      lab("lab.albumin", 108, 3.9, 3.7, 0.2, 1, "g/dL", "g/dL", { every: 1, day: 9 }),
      lab("lab.pth", 108, 68, 320, 15, 0, "pg/mL", "pg/mL", { every: 3, day: 9 }),
      lab("lab.uacr", 108, 210, 980, 40, 0, "mg/g", "mg/g", { every: 6, to: 66, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.t2dm", onset: "1998-03-12" },
      { type: "condition", ref: "icd.t2dm_ckd", onset: "2016-05-02" },
      { type: "condition", ref: "cond.diabetic_nephropathy", onset: "2016-05-02" },
      { type: "condition", ref: "cond.ckd", onset: "2016-05-02" },
      { type: "condition", ref: "cond.ckd3", onset: "2016-05-02" },
      { type: "condition", ref: "cond.ckd4", onset: "2021-02-18" },
      { type: "condition", ref: "icd.ckd4", onset: "2021-02-18" },
      { type: "condition", ref: "cond.ckd5", onset: "2024-01-09", text: "CKD stage 5, dialysis initiated" },
      { type: "condition", ref: "icd.esrd", onset: "2024-01-09" },
      { type: "condition", ref: "cond.anemia_ckd", onset: "2022-06-14" },
      { type: "condition", ref: "cond.secondary_hyperparathyroidism", onset: "2022-10-03" },
      { type: "condition", ref: "cond.diabetic_retinopathy", onset: "2020-04-22", text: "Proliferative diabetic retinopathy" },
      { type: "condition", ref: "cond.htn", onset: "2005-11-30" },
      alg("latex"),
      { type: "med", ref: "med.metformin_500", start: 0, stop: 43, sig: "1 tablet by mouth twice daily" },
      { type: "med", ref: "med.insulin_glargine", start: 43, sig: "24 units subcutaneous at bedtime, titrate to fasting glucose" },
      { type: "med", ref: "med.lisinopril_20", start: 0, stop: 43, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.furosemide_40", start: 22, stop: 78, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.furosemide_80", start: 78, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.epoetin_alfa", start: 66, sig: "6000 units intravenous with each dialysis session" },
      { type: "med", ref: "med.sevelamer_800", start: 66, sig: "2 capsules by mouth with each meal" },
      { type: "med", ref: "med.calcitriol_025", start: 66, sig: "1 capsule by mouth daily" },
      { type: "med", ref: "med.ferrous_sulfate_325", start: 60, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.aspirin_81", start: 0, sig: "1 tablet by mouth daily" },
      { type: "encounter", start: 76, class: "IMP", days: 3, typeText: "Cardiovascular Procedures", visitType: "Cardiovascular Procedures",
        procedures: [{ ref: "proc.av_fistula", text: "Left radiocephalic AV fistula creation" }] },
      { type: "encounter", start: 79, class: "IMP", days: 4, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "icd.esrd", diagnosis: true, onset: null, text: "ESRD, hemodialysis initiation" }] },
      { type: "encounter", start: 20, typeText: "Consultation", visitType: "Consultation",
        procedures: [{ ref: "proc.ultrasound_kidney" }] },
      { type: "procedure", ref: "proc.eye_exam", start: 33 },
      { type: "procedure", ref: "proc.laser_photo", start: 34, text: "Panretinal photocoagulation" },
      { type: "encounter", start: 12, typeText: "Annual Visit", visitType: "Annual Visit" },
      { type: "encounter", start: 36, typeText: "Annual Visit", visitType: "Annual Visit" },
      { type: "encounter", start: 60, typeText: "Annual Visit", visitType: "Annual Visit" },
      { type: "encounter", start: 90, typeText: "Consultation", visitType: "Consultation" },
      { type: "encounter", start: 104, typeText: "Hemodialysis", visitType: "Hemodialysis" },
      ...fluShots(4, 9), ...covidShots(45, 3),
      { type: "immunization", ref: "vac.pneumococcal23", start: 30, day: 12 },
      { type: "immunization", ref: "vac.hepb", start: 80, day: 6 },
      { type: "immunization", ref: "vac.hepb", start: 82, day: 6 },
      { type: "immunization", ref: "vac.hepb", start: 86, day: 6 },
      ...Array.from({ length: 26 }, (_, i) => ({ type: "procedure", ref: "proc.hemodialysis", start: 80 + Math.floor(i * 1.1), day: [3, 5, 7][i % 3] }))
    ]
  },

  // 8. Tony — kidney transplant recipient
  {
    id: "fhir4px-chronic-tony-transplant", tier: "L", seed: 108, months: 48,
    anchor: [2022, 5, 17], gender: "male", birthDate: "1966-01-08", race: "white",
    ethnicity: "hispanic", mrn: "C1008", given: ["Tony"], family: "Vargas",
    focus: "Deceased-donor kidney transplant on tacrolimus immunosuppression",
    messyRate: 0.1,
    panels: [
      ...stdVitals(48, { sbp: [138, 130], dbp: [84, 78], hr: [78, 74], wt: [198, 194] }),
      lab("lab.creatinine", 48, 5.9, 1.4, 0.12, 2, "mg/dL", "mg/dL", { every: 1, day: 9, clamp: [1.2, 7.5] }),
      lab("lab.egfr", 48, 11, 52, 2, 0, "mL/min/1.73m2", "mL/min/{1.73_m2}", { every: 1, day: 9, clamp: [8, 60] }),
      lab("lab.tacrolimus_level", 48, 10.5, 8.2, 1.2, 1, "ng/mL", "ng/mL", { every: 2, day: 9, clamp: [4, 16] }),
      lab("lab.potassium", 48, 5.1, 4.4, 0.3, 1, "mmol/L", "mmol/L", { every: 2, day: 9 }),
      lab("lab.wbc", 48, 6.2, 5.8, 0.8, 1, "10*3/uL", "10*3/uL", { every: 3, day: 9 }),
      lab("lab.hgb", 48, 9.8, 12.9, 0.4, 1, "g/dL", "g/dL", { every: 3, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.esrd", onset: "2019-11-05", clinicalStatus: "resolved", abatement: "2022-05-17", text: "ESRD secondary to PKD, pre-transplant" },
      { type: "condition", ref: "cond.pkd", onset: "2012-08-19" },
      { type: "condition", ref: "cond.htn", onset: "2009-04-02" },
      { type: "condition", ref: "cond.gerd", onset: "2020-06-11" },
      { type: "med", ref: "med.tacrolimus_1", start: 0, sig: "2 capsules by mouth every morning and evening" },
      { type: "med", ref: "med.mycophenolate_500", start: 0, sig: "2 tablets by mouth twice daily" },
      { type: "med", ref: "med.prednisone_5", start: 0, stop: 2, sig: "4 tablets by mouth daily" },
      { type: "med", ref: "med.prednisone_5", start: 2, stop: 6, sig: "2 tablets by mouth daily" },
      { type: "med", ref: "med.prednisone_5", start: 6, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.valganciclovir_450", start: 0, stop: 6, sig: "2 tablets by mouth daily" },
      { type: "med", ref: "med.bactrim_ds", start: 0, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.amlodipine_5", start: 0, sig: "1 tablet by mouth daily" },
      { type: "encounter", start: 0, class: "IMP", days: 5, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "cond.esrd", diagnosis: true, onset: null, text: "Deceased donor kidney transplant" }],
        procedures: [{ ref: "proc.kidney_transplant", text: "Deceased-donor right kidney transplant" }] },
      { type: "encounter", start: 14, class: "IMP", days: 3, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "cond.t2dm", diagnosis: true, onset: null, clinicalStatus: "resolved", text: "Acute rejection episode, Banff 1A, treated" }],
        observations: [
          { ref: "lab.creatinine", category: "laboratory", categoryDisplay: "Laboratory", value: 2.4, unit: "mg/dL", unitCode: "mg/dL" },
          { ref: "lab.tacrolimus_level", category: "laboratory", categoryDisplay: "Laboratory", value: 5.1, unit: "ng/mL", unitCode: "ng/mL" }
        ],
        procedures: [{ ref: "proc.ultrasound_kidney", text: "Renal ultrasound: no obstruction, mild edema" }],
        meds: [{ ref: "med.prednisone_5", sig: "6 tablets by mouth daily, taper" }] },
      { type: "encounter", start: 27, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "cond.t2dm", diagnosis: true, onset: null, clinicalStatus: "resolved", text: "Urinary tract infection" }],
        observations: [{ ref: "lab.wbc", category: "laboratory", categoryDisplay: "Laboratory", value: 11.8, unit: "10*3/uL", unitCode: "10*3/uL" }],
        meds: [{ ref: "med.azithromycin_250", sig: "1 tablet daily — held, allergy pending" }] },
      { type: "encounter", start: 8, typeText: "Consultation", visitType: "Consultation" },
      { type: "encounter", start: 45, typeText: "Provision of Continuity of Care", visitType: "Provision of Continuity of Care" },
      ...fluShots(5, 4), ...covidShots(6, 2),
      { type: "immunization", ref: "vac.hepb", start: 3, day: 9 }
    ]
  },

  // 9. Hank — HFrEF on quadruple GDMT
  {
    id: "fhir4px-chronic-hank-hfref", tier: "L", seed: 109, months: 60,
    anchor: [2020, 8, 21], gender: "male", birthDate: "1958-07-04", race: "white",
    ethnicity: "non_hispanic", mrn: "C1009", given: ["Hank"], family: "Brennan",
    focus: "HFrEF on quadruple guideline-directed medical therapy",
    messyRate: 0.1,
    panels: [
      ...stdVitals(60, { sbp: [144, 124], dbp: [86, 74], hr: [88, 70], wt: [218, 198], spo2: [95, 96] }),
      lab("lab.ntprobnp", 60, 1850, 380, 90, 0, "pg/mL", "pg/mL", { every: 3, day: 9 }),
      lab("lab.creatinine", 60, 1.15, 1.28, 0.08, 2, "mg/dL", "mg/dL", { every: 3, day: 9 }),
      lab("lab.potassium", 60, 4.3, 4.9, 0.3, 1, "mmol/L", "mmol/L", { every: 3, day: 9 }),
      lab("lab.egfr", 60, 62, 54, 3, 0, "mL/min/1.73m2", "mL/min/{1.73_m2}", { every: 3, day: 9 }),
      lab("lab.ldl", 60, 92, 64, 8, 0, "mg/dL", "mg/dL", { every: 12, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.hfref_systolic", onset: "2020-08-21", text: "Heart failure with reduced ejection fraction" },
      { type: "condition", ref: "icd.hfref", onset: "2020-08-21" },
      { type: "condition", ref: "cond.mi_history", onset: "2020-08-15", text: "NSTEMI with PCI to RCA" },
      { type: "condition", ref: "cond.afib", onset: "2021-02-11" },
      { type: "condition", ref: "cond.htn", onset: "2005-05-20" },
      { type: "condition", ref: "cond.hyperlipidemia", onset: "2005-05-20" },
      { type: "condition", ref: "cond.ckd3", onset: "2022-04-08" },
      { type: "med", ref: "med.sacubitril_valsartan_24_26", start: 1, stop: 6, sig: "1 tablet by mouth twice daily" },
      { type: "med", ref: "med.sacubitril_valsartan_49_51", start: 6, stop: 16, sig: "1 tablet by mouth twice daily" },
      { type: "med", ref: "med.sacubitril_valsartan_97_103", start: 16, sig: "1 tablet by mouth twice daily" },
      { type: "med", ref: "med.metoprolol_succinate_25", start: 2, stop: 9, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.metoprolol_succinate_100", start: 9, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.dapagliflozin_10", start: 22, sig: "1 tablet by mouth every morning" },
      { type: "med", ref: "med.spironolactone_25", start: 30, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.furosemide_40", start: 0, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.apixaban_5", start: 6, sig: "1 tablet by mouth twice daily" },
      { type: "med", ref: "med.atorvastatin_80", start: 0, sig: "1 tablet by mouth nightly" },
      { type: "med", ref: "med.aspirin_81", start: 0, sig: "1 tablet by mouth daily" },
      { type: "encounter", start: 15, class: "IMP", days: 4, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "icd.hfref", diagnosis: true, onset: null, text: "Acute decompensated heart failure" }],
        observations: [
          { ref: "lab.ntprobnp", category: "laboratory", categoryDisplay: "Laboratory", value: 3420, unit: "pg/mL", unitCode: "pg/mL" },
          { ref: "vital.weight", category: "vital-signs", categoryDisplay: "Vital Signs", value: 226, unit: "lb", unitCode: "[lb_av]" },
          { ref: "vital.spo2", category: "vital-signs", categoryDisplay: "Vital Signs", value: 91, unit: "%", unitCode: "%" }
        ] },
      { type: "encounter", start: 0, class: "IMP", days: 4, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "icd.STEMI", diagnosis: true, onset: null, text: "NSTEMI" }],
        observations: [{ ref: "lab.troponin_i", category: "laboratory", categoryDisplay: "Laboratory", value: 2.1, unit: "ng/mL", unitCode: "ng/mL" }],
        procedures: [{ ref: "proc.pci_stent", text: "Drug-eluting stent to RCA" }, { ref: "proc.ecg" }] },
      { type: "procedure", ref: "proc.echo", start: 1, day: 20 },
      { type: "procedure", ref: "proc.echo", start: 18 },
      { type: "procedure", ref: "proc.echo", start: 42 },
      { type: "encounter", start: 1, typeText: "Cardiovascular Procedures", visitType: "Cardiovascular Procedures" },
      { type: "encounter", start: 24, typeText: "Consultation", visitType: "Consultation" },
      { type: "encounter", start: 56, typeText: "Encounter for Check Up", visitType: "Encounter for Check Up" },
      ...fluShots(4, 5), ...covidShots(10, 3),
      { type: "immunization", ref: "vac.pneumococcal23", start: 8, day: 16 }
    ]
  },

  // 10. Pete — psoriasis progressing to psoriatic arthritis
  {
    id: "fhir4px-chronic-pete-psoriasis", tier: "M", seed: 110, months: 36,
    anchor: [2023, 2, 14], gender: "male", birthDate: "1985-03-25", race: "white",
    ethnicity: "non_hispanic", mrn: "C1010", given: ["Pete"], family: "Nguyen",
    focus: "Plaque psoriasis with psoriatic arthritis on biologic",
    messyRate: 0.1,
    panels: [
      ...stdVitals(36, { sbp: [128, 124], dbp: [80, 76], hr: [74, 72], wt: [207, 203] }),
      lab("lab.crp", 36, 12.4, 2.8, 1.5, 1, "mg/L", "mg/L", { every: 3, day: 9 }),
      lab("lab.alt", 36, 32, 26, 5, 0, "U/L", "U/L", { every: 3, day: 9 }),
      lab("lab.hgb", 36, 14.8, 14.7, 0.4, 1, "g/dL", "g/dL", { every: 6, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.psoriasis", onset: "2015-09-30", text: "Plaque psoriasis, BSA 12%" },
      { type: "condition", ref: "cond.psoriatic_arthritis", onset: "2023-06-12" },
      { type: "condition", ref: "cond.obesity", onset: "2019-01-15" },
      alg("sulfa"),
      { type: "med", ref: "med.methotrexate_25mg", start: 7, stop: 19, sig: "6 tablets by mouth once weekly" },
      { type: "med", ref: "med.folic_acid_1", start: 7, sig: "1 tablet by mouth daily except methotrexate day" },
      { type: "med", ref: "med.adalimumab_40", start: 19, sig: "40 mg subcutaneous injection every other week" },
      { type: "med", ref: "med.ibuprofen_600", start: 5, sig: "1 tablet by mouth up to three times daily as needed" },
      { type: "encounter", start: 4, typeText: "Consultation", visitType: "Consultation",
        observations: [{ ref: "lab.crp", category: "laboratory", categoryDisplay: "Laboratory", value: 14.1, unit: "mg/L", unitCode: "mg/L" }] },
      { type: "encounter", start: 18, typeText: "Consultation", visitType: "Consultation",
        procedures: [{ ref: "proc.synovial_injection", text: "Intra-articular corticosteroid injection, right knee" }] },
      { type: "encounter", start: 33, typeText: "Encounter for Check Up", visitType: "Encounter for Check Up" },
      ...fluShots(9, 3)
    ]
  },

  // 11. Carl — moderate COPD, tobacco use disorder, anxiety
  {
    id: "fhir4px-chronic-carl-copd", tier: "M", seed: 111, months: 48,
    anchor: [2022, 1, 11], gender: "male", birthDate: "1961-12-03", race: "ai",
    ethnicity: "non_hispanic", mrn: "C1011", given: ["Carl"], family: "Whitehorse",
    focus: "Moderate COPD (GOLD 2) with tobacco use disorder and anxiety",
    smoking: { code: "449868002", display: "Current every day smoker" },
    messyRate: 0.1,
    panels: [
      ...stdVitals(48, { sbp: [132, 128], dbp: [82, 78], hr: [80, 76], wt: [181, 178], spo2: [94, 94] }),
      vital("vital.rr", 48, 20, 19, 1.5, 0, "breaths/minute", "/min", { day: 4 }),
      lab("lab.fev1", 48, 1.92, 1.78, 0.09, 2, "L", "L", { every: 6, day: 9 }),
      lab("lab.wbc", 48, 7.4, 7.2, 0.7, 1, "10*3/uL", "10*3/uL", { every: 12, day: 9 }),
      lab("lab.hgb", 48, 15.4, 15.2, 0.4, 1, "g/dL", "g/dL", { every: 12, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.copd", onset: "2018-10-05", text: "COPD GOLD 2, emphysema-predominant" },
      { type: "condition", ref: "icd.copd", onset: "2018-10-05" },
      { type: "condition", ref: "icd.tobacco", onset: "1995-06-01" },
      { type: "condition", ref: "cond.gad", onset: "2023-04-17" },
      { type: "condition", ref: "cond.htn", onset: "2016-08-22" },
      { type: "med", ref: "med.tiotropium", start: 0, sig: "2 capsule inhalations once daily" },
      { type: "med", ref: "med.albuterol_hfa", start: 0, sig: "2 puffs inhaled every 4-6 hours as needed" },
      { type: "med", ref: "med.varenicline", start: 8, stop: 11, sig: "1 tablet by mouth daily, then twice daily" },
      { type: "med", ref: "med.sertraline_50", start: 16, sig: "1 tablet by mouth daily" },
      { type: "encounter", start: 23, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "icd.copd_severe", diagnosis: true, onset: null, text: "Acute COPD exacerbation" }],
        observations: [
          { ref: "vital.spo2", category: "vital-signs", categoryDisplay: "Vital Signs", value: 89, unit: "%", unitCode: "%" },
          { ref: "lab.wbc", category: "laboratory", categoryDisplay: "Laboratory", value: 12.9, unit: "10*3/uL", unitCode: "10*3/uL" }
        ],
        meds: [
          { ref: "med.prednisone_20", sig: "2 tablets by mouth daily for 5 days" },
          { ref: "med.azithromycin_250", sig: "1 tablet by mouth daily for 5 days" }
        ] },
      { type: "encounter", start: 7, typeText: "Smoking and Tobacco Use Intermediate Counseling, 3-10 Minutes", visitType: "Smoking and Tobacco Use Intermediate Counseling, 3-10 Minutes" },
      { type: "encounter", start: 32, typeText: "Smoking and Tobacco Use Intermediate Counseling, 3-10 Minutes", visitType: "Smoking and Tobacco Use Intermediate Counseling, 3-10 Minutes" },
      { type: "procedure", ref: "proc.spirometry", start: 3 },
      { type: "procedure", ref: "proc.sixmin_walk", start: 12 },
      { type: "procedure", ref: "proc.sixmin_walk", start: 36 },
      { type: "encounter", start: 44, typeText: "Annual Visit", visitType: "Annual Visit" },
      ...fluShots(6, 4), ...covidShots(9, 2),
      { type: "immunization", ref: "vac.pneumococcal23", start: 5, day: 14 }
    ]
  },

  // 12. Shirley — severe COPD on home oxygen (XL)
  {
    id: "fhir4px-chronic-shirley-severe-copd", tier: "XL", seed: 112, months: 96,
    anchor: [2017, 11, 6], gender: "female", birthDate: "1955-04-17", race: "white",
    ethnicity: "non_hispanic", mrn: "C1012", given: ["Shirley"], family: "Doyle",
    focus: "Very severe COPD on home oxygen with frequent exacerbations",
    smoking: { code: "8517006", display: "Former smoker" },
    messyRate: 0.08,
    panels: [
      vital("vital.spo2", 96, 91, 88, 1.2, 0, "%", "%", { day: 4, clamp: [82, 95] }),
      vital("vital.rr", 96, 22, 24, 1.5, 0, "breaths/minute", "/min", { day: 4 }),
      ...stdVitals(96, { sbp: [138, 146], dbp: [76, 80], hr: [92, 96], wt: [142, 132], spo2: [91, 88] }),
      lab("lab.fev1", 96, 0.82, 0.62, 0.05, 2, "L", "L", { every: 6, day: 9 }),
      lab("lab.paco2", 96, 48, 58, 2, 0, "mmHg", "mm[Hg]", { every: 6, day: 9 }),
      lab("lab.pao2", 96, 62, 55, 3, 0, "mmHg", "mm[Hg]", { every: 6, day: 9 }),
      lab("lab.hgb", 96, 16.8, 15.2, 0.4, 1, "g/dL", "g/dL", { every: 6, day: 9 }),
      lab("lab.vitamin_d", 96, 18, 26, 3, 0, "ng/mL", "ng/mL", { every: 12, day: 9 }),
      lab("lab.alt", 96, 26, 24, 4, 0, "U/L", "U/L", { every: 12, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.copd_severe", onset: "2015-01-20", text: "Very severe COPD GOLD 4" },
      { type: "condition", ref: "icd.copd_severe", onset: "2015-01-20" },
      { type: "condition", ref: "cond.bronchiectasis", onset: "2019-07-09" },
      { type: "condition", ref: "cond.osteoporosis", onset: "2020-03-11" },
      { type: "condition", ref: "cond.mdd", onset: "2021-08-02", text: "Depression, chronic illness related" },
      { type: "condition", ref: "icd.tobacco", onset: "1972-05-01" },
      { type: "med", ref: "med.umeclidinium_vilanterol", start: 12, sig: "1 inhalation by mouth once daily" },
      { type: "med", ref: "med.tiotropium", start: 0, sig: "2 capsule inhalations once daily" },
      { type: "med", ref: "med.ipratropium_albuterol", start: 20, sig: "1 vial via nebulizer four times daily as needed" },
      { type: "med", ref: "med.azithromycin_250", start: 55, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.alendronate_70", start: 38, sig: "1 tablet by mouth weekly" },
      { type: "med", ref: "med.sertraline_50", start: 45, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.trazodone_50", start: 47, sig: "1 tablet by mouth at bedtime" },
      { type: "procedure", ref: "proc.oxygen_therapy", start: 24, text: "Home oxygen 2 L/min nasal cannula" },
      { type: "procedure", ref: "proc.sixmin_walk", start: 18 },
      { type: "procedure", ref: "proc.sixmin_walk", start: 42 },
      { type: "procedure", ref: "proc.sixmin_walk", start: 66 },
      { type: "procedure", ref: "proc.sixmin_walk", start: 90 },
      { type: "procedure", ref: "proc.dexa", start: 38 },
      { type: "procedure", ref: "proc.dexa", start: 62 },
      { type: "encounter", start: 30, class: "IMP", days: 5, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "icd.copd_severe", diagnosis: true, onset: null, text: "COPD exacerbation with hypercapnia" }],
        observations: [
          { ref: "vital.spo2", category: "vital-signs", categoryDisplay: "Vital Signs", value: 84, unit: "%", unitCode: "%" },
          { ref: "lab.paco2", category: "laboratory", categoryDisplay: "Laboratory", value: 68, unit: "mmHg", unitCode: "mm[Hg]" }
        ],
        meds: [{ ref: "med.prednisone_20", sig: "2 tablets by mouth daily for 7 days" }] },
      { type: "encounter", start: 52, class: "IMP", days: 4, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "icd.copd_severe", diagnosis: true, onset: null, text: "COPD exacerbation" }],
        observations: [{ ref: "vital.spo2", category: "vital-signs", categoryDisplay: "Vital Signs", value: 86, unit: "%", unitCode: "%" }],
        meds: [{ ref: "med.prednisone_20", sig: "2 tablets by mouth daily for 5 days" }] },
      { type: "encounter", start: 77, class: "EMER", days: 1, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "icd.copd_severe", diagnosis: true, onset: null, text: "COPD exacerbation, discharged on steroids" }],
        observations: [{ ref: "vital.spo2", category: "vital-signs", categoryDisplay: "Vital Signs", value: 87, unit: "%", unitCode: "%" }] },
      { type: "encounter", start: 80, typeText: "Home Visit for Respiratory Therapy Care", visitType: "Home Visit for Respiratory Therapy Care" },
      { type: "encounter", start: 92, typeText: "Home Visit for Respiratory Therapy Care", visitType: "Home Visit for Respiratory Therapy Care" },
      ...fluShots(2, 8), ...covidShots(44, 3),
      { type: "immunization", ref: "vac.pneumococcal23", start: 6, day: 10 },
      { type: "immunization", ref: "vac.pneumococcal", start: 58, day: 10 },
      { type: "immunization", ref: "vac.zoster_recomb", start: 50, day: 10 }
    ]
  }
];

import { PATIENTS_B } from "./patients-b.mjs";
import { PATIENTS_C } from "./patients-c.mjs";

export const PATIENTS = [...PATIENTS_A, ...PATIENTS_B, ...PATIENTS_C];
