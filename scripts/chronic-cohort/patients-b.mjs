/** Patient specifications part B (patients 13-25). */

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
  codeine: { allergyCategory: "medication", allergyExpected: "medication" },
  contrast: { allergyCategory: "medication", allergyExpected: "other" },
  pollens: { allergyCategory: "environment", allergyExpected: "environmental" },
  dust_mite: { allergyCategory: "environment", allergyExpected: "environmental" },
  peanut: { allergyCategory: "food", allergyExpected: "food" },
  egg: { allergyCategory: "food", allergyExpected: "food" }
};
const alg = (ref, start = 0) => ({ type: "allergy", ref: `alg.${ref}`, start, ...ALG[ref] });

export const PATIENTS_B = [
  // 13. Rosa — seropositive RA with Sjogren
  {
    id: "fhir4px-chronic-rosa-ra", tier: "M", seed: 113, months: 48,
    anchor: [2022, 2, 8], gender: "female", birthDate: "1970-06-14", race: "pi",
    ethnicity: "non_hispanic", mrn: "C1013", given: ["Rosa"], family: "Faleao",
    focus: "Seropositive rheumatoid arthritis with Sjogren syndrome",
    messyRate: 0.1,
    panels: [
      ...stdVitals(48, { sbp: [122, 120], dbp: [76, 74], hr: [74, 72], wt: [163, 161] }),
      lab("lab.crp", 48, 9.8, 2.4, 1.2, 1, "mg/L", "mg/L", { every: 3, day: 9 }),
      lab("lab.esr", 48, 42, 18, 4, 0, "mm/h", "mm/h", { every: 3, day: 9 }),
      lab("lab.alt", 48, 24, 22, 4, 0, "U/L", "U/L", { every: 3, day: 9 }),
      lab("lab.hgb", 48, 11.8, 12.6, 0.4, 1, "g/dL", "g/dL", { every: 6, day: 9 }),
      lab("lab.vitamin_d", 48, 21, 34, 3, 0, "ng/mL", "ng/mL", { every: 12, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.ra", onset: "2010-03-17" },
      { type: "condition", ref: "cond.sjogren", onset: "2019-11-25" },
      { type: "condition", ref: "cond.gerd", onset: "2018-06-06" },
      alg("penicillin"),
      { type: "med", ref: "med.methotrexate_25", start: 0, sig: "0.6 mL subcutaneous injection once weekly" },
      { type: "med", ref: "med.folic_acid_1", start: 0, sig: "1 tablet by mouth daily except methotrexate day" },
      { type: "med", ref: "med.hydroxychloroquine_200", start: 0, sig: "1 tablet by mouth twice daily" },
      { type: "med", ref: "med.ibuprofen_600", start: 0, sig: "1 tablet by mouth up to three times daily as needed" },
      { type: "encounter", start: 0, typeText: "Consultation", visitType: "Consultation",
        observations: [
          { ref: "lab.rf", category: "laboratory", categoryDisplay: "Laboratory", value: 68, unit: "U/mL", unitCode: "U/mL" },
          { ref: "lab.anti_ccp", category: "laboratory", categoryDisplay: "Laboratory", value: 84, unit: "U/mL", unitCode: "U/mL" }
        ] },
      { type: "encounter", start: 14, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "cond.ra", diagnosis: true, onset: null, text: "RA flare, bilateral wrists" }],
        meds: [{ ref: "med.prednisone_10", sig: "2 tablets by mouth daily for 10 days, taper" }],
        procedures: [{ ref: "proc.synovial_injection", text: "Intra-articular injection, left wrist" }] },
      { type: "procedure", ref: "proc.dexa", start: 10 },
      { type: "procedure", ref: "proc.dexa", start: 34 },
      { type: "procedure", ref: "proc.eye_exam", start: 22, text: "Hydroxychloroquine retinal screening" },
      { type: "encounter", start: 45, typeText: "Encounter for Check Up", visitType: "Encounter for Check Up" },
      ...fluShots(4, 4), ...covidShots(5, 1),
      { type: "immunization", ref: "vac.zoster_recomb", start: 20, day: 12 }
    ]
  },

  // 14. Lucia — SLE with nephritis and APS on warfarin (XL)
  {
    id: "fhir4px-chronic-lucia-sle", tier: "XL", seed: 114, months: 120,
    anchor: [2016, 4, 12], gender: "female", birthDate: "1993-08-25", race: "black",
    ethnicity: "hispanic", mrn: "C1014", given: ["Lucia"], family: "Ramirez",
    focus: "SLE with lupus nephritis and antiphospholipid syndrome",
    messyRate: 0.08,
    panels: [
      ...stdVitals(120, { sbp: [138, 126], dbp: [86, 78], hr: [84, 76], wt: [158, 152] }),
      lab("lab.dsdna", 120, 88, 22, 8, 0, "U/mL", "U/mL", { every: 6, day: 9 }),
      lab("lab.uacr", 120, 920, 165, 45, 0, "mg/g", "mg/g", { every: 3, day: 9 }),
      lab("lab.creatinine", 120, 1.28, 1.02, 0.07, 2, "mg/dL", "mg/dL", { every: 3, day: 9 }),
      lab("lab.hgb", 120, 9.8, 11.6, 0.4, 1, "g/dL", "g/dL", { every: 3, day: 9 }),
      lab("lab.wbc", 120, 3.4, 4.6, 0.5, 1, "10*3/uL", "10*3/uL", { every: 3, day: 9 }),
      lab("lab.inr", 120, 2.4, 2.5, 0.35, 1, "ratio", "{ratio}", { every: 1, day: 7, clamp: [1.4, 3.8] }),
      lab("lab.crp", 120, 6.8, 2.2, 1.0, 1, "mg/L", "mg/L", { every: 6, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.sle", onset: "2014-09-08" },
      { type: "condition", ref: "cond.lupus_nephritis", onset: "2018-02-13", text: "Class IV lupus nephritis" },
      { type: "condition", ref: "cond.antiphospholipid_syndrome", onset: "2017-06-04" },
      { type: "condition", ref: "cond.dvt_history", onset: "2017-05-28", text: "Left leg DVT" },
      { type: "condition", ref: "cond.anemia", onset: "2016-01-19" },
      { type: "condition", ref: "cond.htn", onset: "2018-04-02" },
      { type: "condition", ref: "cond.osteoporosis", onset: "2021-03-16", text: "Glucocorticoid-induced osteoporosis" },
      alg("sulfa"),
      { type: "med", ref: "med.hydroxychloroquine_200", start: 0, sig: "1 tablet by mouth twice daily" },
      { type: "med", ref: "med.mycophenolate_500", start: 21, sig: "2 tablets by mouth twice daily" },
      { type: "med", ref: "med.prednisone_20", start: 21, stop: 27, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.prednisone_5", start: 27, stop: 60, sig: "2 tablets by mouth daily" },
      { type: "med", ref: "med.prednisone_5", start: 60, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.warfarin_5", start: 14, sig: "1 tablet by mouth daily, dose per INR" },
      { type: "med", ref: "med.lisinopril_10", start: 24, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.cholecalciferol_2000", start: 60, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.folic_acid_1", start: 21, sig: "1 tablet by mouth daily" },
      { type: "encounter", start: 46, class: "IMP", days: 5, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "cond.lupus_nephritis", diagnosis: true, onset: null, text: "Lupus nephritis flare, proteinuria 1.8 g/day" }],
        observations: [
          { ref: "lab.uacr", category: "laboratory", categoryDisplay: "Laboratory", value: 1850, unit: "mg/g", unitCode: "mg/g" },
        ],
        meds: [{ ref: "med.prednisone_20", sig: "3 tablets by mouth daily" }] },
      { type: "encounter", start: 14, class: "EMER", days: 1, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "cond.dvt_history", diagnosis: true, onset: null, text: "Acute left leg DVT" }] },
      { type: "procedure", ref: "proc.ultrasound_kidney", start: 22 },
      { type: "procedure", ref: "proc.ultrasound_kidney", start: 80 },
      { type: "procedure", ref: "proc.dexa", start: 62 },
      { type: "procedure", ref: "proc.dexa", start: 110 },
      { type: "procedure", ref: "proc.eye_exam", start: 48, text: "Hydroxychloroquine retinal screening" },
      { type: "procedure", ref: "proc.eye_exam", start: 96, text: "Hydroxychloroquine retinal screening" },
      { type: "encounter", start: 70, typeText: "Consultation", visitType: "Consultation" },
      { type: "encounter", start: 116, typeText: "Consultation", visitType: "Consultation" },
      ...fluShots(6, 10), ...covidShots(58, 2)
    ]
  },

  // 15. Chase — Crohn disease on infliximab
  {
    id: "fhir4px-chronic-chase-crohn", tier: "L", seed: 115, months: 60,
    anchor: [2021, 1, 19], gender: "male", birthDate: "1996-02-29" in {} ? "1996-02-28" : "1996-02-28", race: "white",
    ethnicity: "non_hispanic", mrn: "C1015", given: ["Chase"], family: "Whitaker",
    focus: "Ileal Crohn disease with perianal fistula on infliximab",
    messyRate: 0.1,
    panels: [
      ...stdVitals(60, { sbp: [118, 120], dbp: [72, 74], hr: [74, 72], wt: [158, 172] }),
      lab("lab.calprotectin", 60, 840, 92, 60, 0, "mcg/g", "ug/g", { every: 3, day: 9, clamp: [20, 1200] }),
      lab("lab.crp", 60, 11.2, 2.1, 1.2, 1, "mg/L", "mg/L", { every: 3, day: 9 }),
      lab("lab.hgb", 60, 10.2, 13.4, 0.4, 1, "g/dL", "g/dL", { every: 3, day: 9 }),
      lab("lab.albumin", 60, 3.2, 4.1, 0.15, 1, "g/dL", "g/dL", { every: 3, day: 9 }),
      lab("lab.alt", 60, 28, 26, 4, 0, "U/L", "U/L", { every: 6, day: 9 }),
      lab("lab.wbc", 60, 6.8, 6.4, 0.6, 1, "10*3/uL", "10*3/uL", { every: 6, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.crohn", onset: "2016-11-02", text: "Crohn disease, ileal with perianal involvement" },
      { type: "condition", ref: "cond.anal_fistula", onset: "2021-04-15" },
      { type: "condition", ref: "cond.iron_def_anemia", onset: "2020-08-30" },
      alg("codeine"),
      { type: "med", ref: "med.infliximab_100", start: 3, sig: "5 mg/kg intravenous infusion every 8 weeks" },
      { type: "med", ref: "med.azathioprine_50", start: 12, sig: "2 tablets by mouth twice daily" },
      { type: "med", ref: "med.ferrous_sulfate_325", start: 8, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.prednisone_20", start: 0, stop: 3, sig: "1 tablet by mouth daily, tapering" },
      { type: "encounter", start: 3, typeText: "Assessment Procedure", visitType: "Assessment Procedure",
        procedures: [{ ref: "proc.colonoscopy", text: "Colonoscopy: ileal ulcerations, perianal fistula" }],
        observations: [{ ref: "lab.calprotectin", category: "laboratory", categoryDisplay: "Laboratory", value: 980, unit: "mcg/g", unitCode: "ug/g" }] },
      { type: "encounter", start: 15, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "cond.crohn", diagnosis: true, onset: null, text: "Perianal fistula drainage" }],
        procedures: [{ ref: "proc.fistula_incision" }],
        meds: [{ ref: "med.prednisone_20", sig: "1 tablet by mouth daily for 14 days" }] },
      { type: "encounter", start: 27, typeText: "Assessment Procedure", visitType: "Assessment Procedure",
        procedures: [{ ref: "proc.mri_abdomen", text: "MR enterography: active ileal inflammation" }] },
      { type: "encounter", start: 39, typeText: "Assessment Procedure", visitType: "Assessment Procedure",
        procedures: [{ ref: "proc.colonoscopy", text: "Surveillance colonoscopy: healed mucosa" }] },
      { type: "encounter", start: 57, typeText: "Assessment Procedure", visitType: "Assessment Procedure",
        procedures: [{ ref: "proc.egd", text: "EGD: normal upper GI tract" }] },
      ...Array.from({ length: 28 }, (_, i) => ({
        type: "encounter", start: 3 + i * 2, typeText: "Patient-Initiated Encounter", visitType: "Patient-Initiated Encounter"
      })),
      ...fluShots(9, 5), ...covidShots(12, 2)
    ]
  },

  // 16. Benji — bipolar I on lithium
  {
    id: "fhir4px-chronic-benji-bipolar", tier: "M", seed: 116, months: 60,
    anchor: [2021, 3, 16], gender: "male", birthDate: "1984-10-02", race: "black",
    ethnicity: "non_hispanic", mrn: "C1016", given: ["Benji"], family: "Achebe",
    focus: "Bipolar I disorder on lithium with thyroid monitoring",
    messyRate: 0.1,
    panels: [
      ...stdVitals(60, { sbp: [126, 124], dbp: [78, 78], hr: [76, 74], wt: [192, 197] }),
      lab("lab.lithium_level", 60, 0.72, 0.78, 0.09, 2, "mmol/L", "mmol/L", { every: 3, day: 9, clamp: [0.4, 1.3] }),
      lab("lab.tsh", 60, 4.8, 5.4, 0.5, 2, "uIU/mL", "u[IU]/mL", { every: 6, day: 9 }),
      lab("lab.creatinine", 60, 0.98, 1.14, 0.06, 2, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.calcium", 60, 9.6, 9.9, 0.2, 1, "mg/dL", "mg/dL", { every: 12, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.bipolar", onset: "2009-05-21", text: "Bipolar I disorder" },
      { type: "condition", ref: "cond.hypothyroidism", onset: "2019-12-04", text: "Hypothyroidism, lithium-associated" },
      { type: "med", ref: "med.lithium_300", start: 0, stop: 14, sig: "2 capsules by mouth twice daily" },
      { type: "med", ref: "med.lithium_er450", start: 14, sig: "2 tablets by mouth every morning, 1 tablet nightly" },
      { type: "med", ref: "med.lamotrigine_100", start: 18, sig: "1 tablet by mouth twice daily" },
      { type: "med", ref: "med.levothyroxine_50", start: 0, sig: "1 tablet by mouth every morning" },
      { type: "encounter", start: 27, class: "EMER", days: 1, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "cond.bipolar", diagnosis: true, onset: null, text: "Lithium toxicity, level 1.4" }],
        observations: [{ ref: "lab.lithium_level", category: "laboratory", categoryDisplay: "Laboratory", value: 1.42, unit: "mmol/L", unitCode: "mmol/L" }] },
      { type: "encounter", start: 4, typeText: "Consultation", visitType: "Consultation" },
      { type: "encounter", start: 30, typeText: "Consultation", visitType: "Consultation" },
      { type: "encounter", start: 58, typeText: "Consultation", visitType: "Consultation" },
      ...fluShots(8, 5), ...covidShots(11, 1)
    ]
  },

  // 17. Maya — MDD with GAD, telehealth therapy
  {
    id: "fhir4px-chronic-maya-mdd", tier: "M", seed: 117, months: 36,
    anchor: [2023, 4, 4], gender: "female", birthDate: "1989-11-13", race: "asian",
    ethnicity: "non_hispanic", mrn: "C1017", given: ["Maya"], family: "Chen",
    focus: "Recurrent major depression with generalized anxiety",
    messyRate: 0.1,
    panels: [
      ...stdVitals(36, { sbp: [114, 112], dbp: [72, 70], hr: [78, 74], wt: [141, 138] }),
      lab("lab.phq9", 36, 18, 4, 1.5, 0, "{score}", "{score}", { every: 2, day: 9, clamp: [0, 24] }),
      lab("lab.gad7", 36, 15, 5, 1.5, 0, "{score}", "{score}", { every: 2, day: 9, clamp: [0, 21] }),
      lab("lab.tsh", 36, 2.1, 2.0, 0.3, 2, "uIU/mL", "u[IU]/mL", { every: 12, day: 9 }),
    ],
    schedule: [
      { type: "condition", ref: "cond.mdd", onset: "2018-07-09", text: "Major depressive disorder, recurrent" },
      { type: "condition", ref: "icd.mdd", onset: "2018-07-09" },
      { type: "condition", ref: "cond.gad", onset: "2020-02-18" },
      { type: "condition", ref: "cond.insomnia", onset: "2023-01-30" },
      { type: "med", ref: "med.sertraline_50", start: 0, stop: 9, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.sertraline_100", start: 9, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.trazodone_50", start: 3, sig: "1 tablet by mouth at bedtime as needed for sleep" },
      ...Array.from({ length: 16 }, (_, i) => ({
        type: "encounter", start: 1 + i * 2, class: "VR", typeText: "Patient-Initiated Encounter", visitType: "Patient-Initiated Encounter"
      })),
      { type: "encounter", start: 34, typeText: "Annual Visit", visitType: "Annual Visit" },
      ...fluShots(7, 3)
    ]
  },

  // 18. Elena — juvenile myoclonic epilepsy
  {
    id: "fhir4px-chronic-elena-epilepsy", tier: "M", seed: 118, months: 48,
    anchor: [2022, 2, 21], gender: "female", birthDate: "2001-09-07", race: "white",
    ethnicity: "hispanic", mrn: "C1018", given: ["Elena"], family: "Moreno",
    focus: "Juvenile myoclonic epilepsy on levetiracetam",
    messyRate: 0.1,
    panels: [
      ...stdVitals(48, { sbp: [110, 108], dbp: [68, 68], hr: [72, 70], wt: [131, 134] }),
      lab("lab.alt", 48, 18, 17, 4, 0, "U/L", "U/L", { every: 12, day: 9 }),
      lab("lab.wbc", 48, 6.1, 5.9, 0.5, 1, "10*3/uL", "10*3/uL", { every: 12, day: 9 }),
      lab("lab.hgb", 48, 13.2, 13.1, 0.4, 1, "g/dL", "g/dL", { every: 12, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.epilepsy", onset: "2016-03-08", text: "Epilepsy, well controlled on levetiracetam" },
      { type: "condition", ref: "cond.jme", onset: "2016-03-08" },
      { type: "med", ref: "med.levetiracetam_500", start: 0, sig: "1 tablet by mouth twice daily" },
      { type: "encounter", start: 12, class: "EMER", days: 1, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "cond.epilepsy", diagnosis: true, onset: null, text: "Generalized tonic-clonic seizure" }],
        observations: [
          { ref: "lab.sodium", category: "laboratory", categoryDisplay: "Laboratory", value: 138, unit: "mmol/L", unitCode: "mmol/L" }
        ] },
      { type: "procedure", ref: "proc.eeg", start: 0, text: "Awake and sleep EEG: generalized spike-wave" },
      { type: "procedure", ref: "proc.eeg", start: 44, text: "Routine EEG: improved" },
      { type: "procedure", ref: "proc.mri_brain", start: 2 },
      { type: "encounter", start: 20, typeText: "Consultation", visitType: "Consultation" },
      { type: "encounter", start: 46, typeText: "Consultation", visitType: "Consultation" },
      { type: "immunization", ref: "vac.hpv", start: 1, day: 10 },
      { type: "immunization", ref: "vac.hpv", start: 7, day: 10 },
      ...fluShots(5, 4), ...covidShots(6, 1)
    ]
  },

  // 19. Olive — osteoporosis with compression fracture
  {
    id: "fhir4px-chronic-olive-osteoporosis", tier: "M", seed: 119, months: 48,
    anchor: [2022, 5, 9], gender: "female", birthDate: "1946-03-11", race: "white",
    ethnicity: "non_hispanic", mrn: "C1019", given: ["Olive"], family: "Petrov",
    focus: "Postmenopausal osteoporosis with vertebral compression fracture",
    messyRate: 0.1,
    panels: [
      vital("vital.height", 48, 158, 154.5, 0.3, 1, "cm", "cm", { day: 4 }),
      ...stdVitals(48, { sbp: [142, 138], dbp: [78, 76], hr: [72, 72], wt: [138, 134] }),
      lab("lab.vitamin_d", 48, 18, 38, 3, 0, "ng/mL", "ng/mL", { every: 6, day: 9 }),
      lab("lab.calcium", 48, 8.8, 9.2, 0.2, 1, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.pth", 48, 52, 44, 4, 0, "pg/mL", "pg/mL", { every: 12, day: 9 }),
      lab("lab.creatinine", 48, 0.94, 0.98, 0.05, 2, "mg/dL", "mg/dL", { every: 12, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.osteoporosis", onset: "2015-07-22" },
      { type: "condition", ref: "icd.osteo", onset: "2015-07-22" },
      { type: "condition", ref: "cond.compression_fx", onset: "2022-07-19", text: "T12 compression fracture" },
      { type: "condition", ref: "cond.vitamin_d_deficiency", onset: "2021-10-05" },
      { type: "condition", ref: "cond.htn", onset: "2010-01-14" },
      { type: "condition", ref: "cond.oa_knee", onset: "2018-05-30" },
      { type: "med", ref: "med.alendronate_70", start: 0, stop: 12, sig: "1 tablet by mouth weekly" },
      { type: "med", ref: "med.zoledronic_5", start: 13, sig: "5 mg intravenous infusion once yearly" },
      { type: "med", ref: "med.zoledronic_5", start: 25, sig: "5 mg intravenous infusion once yearly" },
      { type: "med", ref: "med.zoledronic_5", start: 37, sig: "5 mg intravenous infusion once yearly" },
      { type: "med", ref: "med.cholecalciferol_2000", start: 0, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.amlodipine_5", start: 0, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.ibuprofen_600", start: 2, sig: "1 tablet by mouth up to three times daily as needed" },
      { type: "encounter", start: 2, class: "EMER", days: 1, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "cond.compression_fx", diagnosis: true, onset: null, text: "Acute T12 compression fracture after fall" }],
        procedures: [{ ref: "proc.ct_head", text: "CT: no fracture" }] },
      { type: "encounter", start: 3, class: "IMP", days: 1, typeText: "Medical Services", visitType: "Medical Services",
        procedures: [{ ref: "proc.kyphoplasty", text: "T12 vertebroplasty" }] },
      { type: "procedure", ref: "proc.dexa", start: 0 },
      { type: "procedure", ref: "proc.dexa", start: 22 },
      { type: "procedure", ref: "proc.dexa", start: 46 },
      { type: "procedure", ref: "proc.pt", start: 4 },
      { type: "procedure", ref: "proc.pt", start: 5 },
      { type: "encounter", start: 44, typeText: "Annual Visit", visitType: "Annual Visit" },
      ...fluShots(3, 4), ...covidShots(4, 2),
      { type: "immunization", ref: "vac.zoster_recomb", start: 8, day: 11 },
      { type: "immunization", ref: "vac.pneumococcal23", start: 9, day: 11 }
    ]
  },

  // 20. Ciro — HCV-cured cirrhosis under surveillance
  {
    id: "fhir4px-chronic-ciro-cirrhosis", tier: "M", seed: 120, months: 72,
    anchor: [2019, 6, 10], gender: "male", birthDate: "1965-08-08", race: "white",
    ethnicity: "hispanic", mrn: "C1020", given: ["Ciro"], family: "Esposito",
    focus: "HCV-cured compensated cirrhosis under HCC surveillance",
    messyRate: 0.1,
    panels: [
      ...stdVitals(72, { sbp: [124, 126], dbp: [76, 74], hr: [72, 70], wt: [188, 182] }),
      lab("lab.alt", 72, 58, 42, 6, 0, "U/L", "U/L", { every: 6, day: 9 }),
      lab("lab.ast", 72, 64, 46, 6, 0, "U/L", "U/L", { every: 6, day: 9 }),
      lab("lab.bilirubin_total", 72, 1.1, 1.3, 0.15, 1, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.albumin", 72, 4.0, 3.6, 0.15, 1, "g/dL", "g/dL", { every: 6, day: 9 }),
      lab("lab.platelets", 72, 108, 74, 8, 0, "10*3/uL", "10*3/uL", { every: 6, day: 9 }),
      lab("lab.inr", 72, 1.1, 1.3, 0.08, 1, "ratio", "{ratio}", { every: 6, day: 9 }),
      lab("lab.creatinine", 72, 0.92, 0.96, 0.06, 2, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.a1c", 72, 6.9, 7.1, 0.25, 1, "%", "%", { every: 6, day: 9 }),
      lab("lab.sodium", 72, 138, 136, 1.5, 0, "mmol/L", "mmol/L", { every: 6, day: 9 }),
      lab("lab.afp", 72, 4.2, 4.8, 1.2, 1, "ng/mL", "ng/mL", { every: 6, day: 9, clamp: [1.2, 15] })
    ],
    schedule: [
      { type: "condition", ref: "cond.hcv", onset: "2005-04-18", clinicalStatus: "resolved", abatement: "2019-09-30" },
      { type: "condition", ref: "cond.cirrhosis", onset: "2018-01-16", text: "Compensated Child-Pugh A cirrhosis" },
      { type: "condition", ref: "cond.thrombocytopenia", onset: "2019-02-11" },
      { type: "condition", ref: "cond.esophageal_varices", onset: "2021-11-08", text: "Grade 2 varices" },
      { type: "condition", ref: "cond.t2dm", onset: "2017-08-14" },
      { type: "med", ref: "med.sofosbuvir_400", start: 0, stop: 3, sig: "1 tablet by mouth daily for 12 weeks" },
      { type: "med", ref: "med.propranolol_20", start: 29, sig: "1 tablet by mouth twice daily" },
      { type: "med", ref: "med.metformin_500", start: 0, sig: "1 tablet by mouth twice daily" },
      { type: "med", ref: "med.spironolactone_25", start: 52, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.lactulose", start: 57, sig: "30 mL by mouth daily, titrate to 2-3 soft stools daily" },
      { type: "encounter", start: 4, typeText: "Consultation", visitType: "Consultation",
        observations: [{ ref: "lab.hcv_rna", category: "laboratory", categoryDisplay: "Laboratory", value: 0, unit: "U/mL", unitCode: "U/mL", text: "HCV RNA not detected" }] },
      { type: "encounter", start: 28, typeText: "Assessment Procedure", visitType: "Assessment Procedure",
        procedures: [{ ref: "proc.egd", text: "EGD: grade 2 varices, banding performed" }] },
      { type: "encounter", start: 57, class: "IMP", days: 3, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "cond.cirrhosis", diagnosis: true, onset: null, text: "Hepatic encephalopathy, grade 1" }],
        observations: [
          { ref: "lab.bilirubin_total", category: "laboratory", categoryDisplay: "Laboratory", value: 2.8, unit: "mg/dL", unitCode: "mg/dL" },
          { ref: "lab.albumin", category: "laboratory", categoryDisplay: "Laboratory", value: 2.7, unit: "g/dL", unitCode: "g/dL" },
          { ref: "lab.sodium", category: "laboratory", categoryDisplay: "Laboratory", value: 129, unit: "mmol/L", unitCode: "mmol/L" }
        ] },
      ...Array.from({ length: 12 }, (_, i) => ({ type: "procedure", ref: "proc.ultrasound_liver", start: 6 + i * 6, text: "Liver ultrasound surveillance" })),
      { type: "encounter", start: 68, typeText: "Annual Visit", visitType: "Annual Visit" },
      ...fluShots(2, 6), ...covidShots(20, 2),
      { type: "immunization", ref: "vac.hepb", start: 1, day: 9 },
      { type: "immunization", ref: "vac.hepb", start: 3, day: 9 }
    ]
  },

  // 21. Izzy — HIV on ART, suppressed
  {
    id: "fhir4px-chronic-izzy-hiv", tier: "M", seed: 121, months: 96,
    anchor: [2018, 6, 6], gender: "female", birthDate: "1979-04-27", race: "black",
    ethnicity: "non_hispanic", mrn: "C1021", given: ["Izzy"], family: "Osei",
    focus: "HIV on ART with durable viral suppression",
    messyRate: 0.1,
    panels: [
      ...stdVitals(96, { sbp: [122, 118], dbp: [76, 74], hr: [74, 72], wt: [156, 152] }),
      lab("lab.cd4", 96, 312, 780, 30, 0, "cells/uL", "{cells}/uL", { every: 3, day: 9 }),
      lab("lab.hiv_vl", 96, 48200, 20, 800, 0, "copies/mL", "{copies}/mL", { every: 3, day: 9, clamp: [20, 120000] }),
      lab("lab.ldl", 96, 118, 104, 8, 0, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.trig", 96, 168, 142, 15, 0, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.creatinine", 96, 0.82, 0.86, 0.05, 2, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.hgb", 96, 12.4, 13.1, 0.4, 1, "g/dL", "g/dL", { every: 6, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.hiv", onset: "2016-02-09" },
      { type: "condition", ref: "cond.hyperlipidemia", onset: "2022-03-14" },
      { type: "condition", ref: "cond.gad", onset: "2023-01-20" },
      { type: "med", ref: "med.biktarvy", start: 0, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.rosuvastatin_20", start: 45, sig: "1 tablet by mouth nightly" },
      { type: "med", ref: "med.sertraline_50", start: 55, sig: "1 tablet by mouth daily" },
      { type: "encounter", start: 0, typeText: "Consultation", visitType: "Consultation",
        observations: [
          { ref: "lab.cd4", category: "laboratory", categoryDisplay: "Laboratory", value: 286, unit: "cells/uL", unitCode: "{cells}/uL" },
          { ref: "lab.hiv_vl", category: "laboratory", categoryDisplay: "Laboratory", value: 124000, unit: "copies/mL", unitCode: "{copies}/mL" }
        ] },
      { type: "encounter", start: 48, typeText: "Encounter for Check Up", visitType: "Encounter for Check Up" },
      { type: "encounter", start: 92, typeText: "Consultation", visitType: "Consultation" },
      ...fluShots(4, 8), ...covidShots(32, 3),
      { type: "immunization", ref: "vac.pneumococcal23", start: 6, day: 12 },
      { type: "immunization", ref: "vac.hepb", start: 8, day: 12 }
    ]
  },

  // 22. Carmen — breast cancer survivor
  {
    id: "fhir4px-chronic-carmen-breast-cancer", tier: "M", seed: 122, months: 72,
    anchor: [2019, 8, 13], gender: "female", birthDate: "1963-01-22", race: "pi",
    ethnicity: "non_hispanic", mrn: "C1022", given: ["Carmen"], family: "Tuiasosopo",
    focus: "ER+ breast cancer survivor on aromatase inhibitor",
    messyRate: 0.1,
    panels: [
      ...stdVitals(72, { sbp: [128, 126], dbp: [78, 76], hr: [72, 72], wt: [164, 160] }),
      lab("lab.wbc", 72, 3.1, 4.6, 0.35, 1, "10*3/uL", "10*3/uL", { every: 6, day: 9, clamp: [1.8, 8] }),
      lab("lab.hgb", 72, 11.4, 12.6, 0.4, 1, "g/dL", "g/dL", { every: 6, day: 9 }),
      lab("lab.creatinine", 72, 0.84, 0.86, 0.05, 2, "mg/dL", "mg/dL", { every: 12, day: 9 }),
      lab("lab.alt", 72, 26, 24, 4, 0, "U/L", "U/L", { every: 12, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.breast_cancer", onset: "2019-08-13", clinicalStatus: "remission", text: "ER+ PR+ HER2- left breast cancer, in remission" },
      { type: "condition", ref: "cond.lymphedema", onset: "2020-04-06", text: "Left arm lymphedema, mild" },
      { type: "condition", ref: "cond.htn", onset: "2015-06-17" },
      { type: "condition", ref: "cond.insomnia", onset: "2020-09-02" },
      alg("contrast"),
      { type: "med", ref: "med.anastrozole_1", start: 5, stop: 65, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.lisinopril_10", start: 0, sig: "1 tablet by mouth daily" },
      { type: "encounter", start: 0, class: "IMP", days: 1, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "icd.breast_ca", diagnosis: true, onset: null, text: "Left breast mass, biopsy proven invasive ductal carcinoma" }],
        procedures: [{ ref: "proc.mammogram", text: "Diagnostic mammogram: BI-RADS 5 left" }] },
      { type: "encounter", start: 3, class: "IMP", days: 2, typeText: "Medical Services", visitType: "Medical Services",
        procedures: [
          { ref: "proc.lumpectomy", text: "Left breast lumpectomy" },
          { ref: "proc.sentinel_node", text: "Sentinel lymph node biopsy: 0 of 2 positive" }
        ] },
      ...Array.from({ length: 15 }, (_, i) => ({
        type: "procedure", ref: "proc.radiotherapy_breast", start: 6 + Math.floor(i / 5), text: `Radiation fraction ${i + 1} of 15`
      })),
      ...Array.from({ length: 12 }, (_, i) => ({ type: "procedure", ref: "proc.pt", start: 8 + Math.floor(i / 2), text: "Lymphedema therapy" })),
      { type: "procedure", ref: "proc.mammogram", start: 30, text: "Screening mammogram: BI-RADS 1" },
      { type: "procedure", ref: "proc.mammogram", start: 42, text: "Screening mammogram: BI-RADS 1" },
      { type: "procedure", ref: "proc.mammogram", start: 54, text: "Screening mammogram: BI-RADS 1" },
      { type: "procedure", ref: "proc.mammogram", start: 66, text: "Screening mammogram: BI-RADS 1" },
      { type: "procedure", ref: "proc.dexa", start: 24 },
      { type: "procedure", ref: "proc.dexa", start: 60 },
      { type: "encounter", start: 70, typeText: "Consultation", visitType: "Consultation" },
      ...fluShots(2, 6), ...covidShots(18, 2)
    ]
  },

  // 23. Simi — sickle cell disease
  {
    id: "fhir4px-chronic-simi-sickle", tier: "M", seed: 123, months: 60,
    anchor: [2021, 7, 14], gender: "female", birthDate: "1999-05-19", race: "black",
    ethnicity: "non_hispanic", mrn: "C1023", given: ["Simi"], family: "Adesanya",
    focus: "Sickle cell disease (HbSS) with vaso-occlusive crises",
    messyRate: 0.1,
    panels: [
      ...stdVitals(60, { sbp: [112, 110], dbp: [68, 68], hr: [88, 84], wt: [128, 130] }),
      lab("lab.hgb", 60, 8.2, 8.8, 0.5, 1, "g/dL", "g/dL", { every: 3, day: 9 }),
      lab("lab.hbf", 60, 6.5, 17.8, 1.2, 1, "%", "%", { every: 3, day: 9 }),
      lab("lab.reticulocytes", 60, 12.4, 9.2, 1.2, 1, "%", "%", { every: 3, day: 9 }),
      lab("lab.wbc", 60, 12.8, 11.2, 1.0, 1, "10*3/uL", "10*3/uL", { every: 3, day: 9 }),
      lab("lab.creatinine", 60, 0.62, 0.68, 0.05, 2, "mg/dL", "mg/dL", { every: 6, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.sickle_cell", onset: "2001-09-12" },
      { type: "condition", ref: "icd.sickle", onset: "2001-09-12" },
      { type: "condition", ref: "cond.anemia", onset: "2001-09-12", text: "Chronic hemolytic anemia" },
      { type: "med", ref: "med.hydroxyurea_500", start: 0, sig: "1 capsule by mouth daily, increased to 2 capsules daily as tolerated" },
      { type: "med", ref: "med.folic_acid_1", start: 0, sig: "1 tablet by mouth daily" },
      { type: "encounter", start: 9, class: "EMER", days: 1, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "cond.sickle_crisis", diagnosis: true, onset: null, text: "Vaso-occlusive crisis, back and legs" }],
        observations: [{ ref: "lab.hgb", category: "laboratory", categoryDisplay: "Laboratory", value: 7.1, unit: "g/dL", unitCode: "g/dL" }] },
      { type: "encounter", start: 22, class: "IMP", days: 4, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "cond.sickle_crisis", diagnosis: true, onset: null, text: "Vaso-occlusive crisis requiring IV opioids" }],
        observations: [{ ref: "lab.hgb", category: "laboratory", categoryDisplay: "Laboratory", value: 6.8, unit: "g/dL", unitCode: "g/dL" }],
        procedures: [{ ref: "proc.blood_transfusion" }] },
      { type: "encounter", start: 41, class: "IMP", days: 3, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "cond.sickle_crisis", diagnosis: true, onset: null, text: "Vaso-occlusive crisis, chest" }],
        observations: [{ ref: "lab.hgb", category: "laboratory", categoryDisplay: "Laboratory", value: 7.4, unit: "g/dL", unitCode: "g/dL" }],
        procedures: [{ ref: "proc.blood_transfusion" }] },
      { type: "encounter", start: 50, class: "EMER", days: 1, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "cond.sickle_crisis", diagnosis: true, onset: null, text: "Mild pain crisis, managed orally" }] },
      { type: "procedure", ref: "lab.hbelectro" ? "proc.eye_exam" : "proc.eye_exam", start: 24 },
      { type: "encounter", start: 58, typeText: "Consultation", visitType: "Consultation" },
      ...fluShots(2, 5), ...covidShots(14, 2),
      { type: "immunization", ref: "vac.pneumococcal23", start: 1, day: 10 },
      { type: "immunization", ref: "vac.pneumococcal", start: 36, day: 10 },
      { type: "immunization", ref: "vac.hepb", start: 3, day: 10 }
    ]
  },

  // 24. Abi — adolescent ADHD with obesity
  {
    id: "fhir4px-chronic-abi-adolescent", tier: "M", seed: 124, months: 24,
    anchor: [2024, 2, 6], gender: "female", birthDate: "2010-08-15", race: "black",
    ethnicity: "non_hispanic", mrn: "C1024", given: ["Abi"], family: "Turner",
    focus: "Adolescent ADHD with obesity and allergic rhinitis",
    messyRate: 0.12,
    panels: [
      ...stdVitals(24, { sbp: [108, 108], dbp: [66, 66], hr: [84, 80], wt: [168, 171] }),
      vital("vital.bmi", 24, 28.9, 28.6, 0.3, 1, "kg/m2", "kg/m2", { day: 4 }),
      lab("lab.ldl", 24, 102, 96, 8, 0, "mg/dL", "mg/dL", { every: 12, day: 9 }),
      lab("lab.hdl", 24, 42, 44, 3, 0, "mg/dL", "mg/dL", { every: 12, day: 9 }),
      lab("lab.trig", 24, 118, 108, 12, 0, "mg/dL", "mg/dL", { every: 12, day: 9 }),
      lab("lab.alt", 24, 34, 30, 4, 0, "U/L", "U/L", { every: 12, day: 9 }),
      lab("lab.phq9", 24, 5, 3, 1, 0, "{score}", "{score}", { every: 12, day: 9, clamp: [0, 12] })
    ],
    schedule: [
      { type: "condition", ref: "cond.adhd", onset: "2022-09-13", text: "ADHD, combined presentation" },
      { type: "condition", ref: "cond.obesity", onset: "2023-06-07" },
      { type: "condition", ref: "cond.allergic_rhinitis", onset: "2020-04-02" },
      alg("peanut"),
      { type: "med", ref: "med.methylphenidate_er20", start: 0, sig: "1 capsule by mouth every morning" },
      { type: "med", ref: "med.cetirizine", start: 0, sig: "1 teaspoon by mouth nightly" },
      { type: "encounter", start: 0, typeText: "Consultation", visitType: "Consultation" },
      { type: "encounter", start: 11, typeText: "Encounter for Check Up", visitType: "Encounter for Check Up",
        procedures: [{ ref: "proc.eye_exam", text: "Vision screening normal" }] },
      { type: "encounter", start: 22, typeText: "Encounter for Check Up", visitType: "Encounter for Check Up" },
      { type: "immunization", ref: "vac.hpv", start: 1, day: 10 },
      { type: "immunization", ref: "vac.hpv", start: 7, day: 10 },
      { type: "immunization", ref: "vac.tdap", start: 0, day: 14 },
      { type: "immunization", ref: "vac.mmr", start: -168, day: 14 },
      ...fluShots(3, 2)
    ]
  },

  // 25. Walt — elderly multimorbidity and polypharmacy (XL)
  {
    id: "fhir4px-chronic-walt-multimorbid", tier: "XL", seed: 125, months: 120,
    anchor: [2016, 1, 5], gender: "male", birthDate: "1944-02-09", race: "white",
    ethnicity: "non_hispanic", mrn: "C1025", given: ["Walt"], family: "Jorgensen",
    focus: "Elderly multimorbidity: HFpEF, AF, CKD3, T2DM, osteoporosis, BPH",
    messyRate: 0.07,
    panels: [
      ...stdVitals(120, { sbp: [142, 138], dbp: [78, 74], hr: [82, 78], wt: [188, 178], spo2: [96, 95] }),
      lab("lab.ntprobnp", 120, 380, 720, 90, 0, "pg/mL", "pg/mL", { every: 3, day: 9 }),
      lab("lab.egfr", 120, 58, 41, 2, 0, "mL/min/1.73m2", "mL/min/{1.73_m2}", { every: 3, day: 9 }),
      lab("lab.creatinine", 120, 1.28, 1.68, 0.08, 2, "mg/dL", "mg/dL", { every: 3, day: 9 }),
      lab("lab.potassium", 120, 4.4, 4.8, 0.3, 1, "mmol/L", "mmol/L", { every: 3, day: 9 }),
      lab("lab.a1c", 120, 7.3, 7.9, 0.3, 1, "%", "%", { every: 3, day: 9 }),
      lab("lab.hgb", 120, 12.2, 10.8, 0.35, 1, "g/dL", "g/dL", { every: 3, day: 9 }),
      lab("lab.psa", 120, 3.2, 3.9, 0.3, 1, "ng/mL", "ng/mL", { every: 12, day: 9 }),
      lab("lab.calcium", 120, 9.0, 8.9, 0.25, 1, "mg/dL", "mg/dL", { every: 6, day: 9 }),
      lab("lab.vitamin_d", 120, 24, 32, 3, 0, "ng/mL", "ng/mL", { every: 12, day: 9 }),
      lab("lab.ldl", 120, 88, 74, 8, 0, "mg/dL", "mg/dL", { every: 12, day: 9 })
    ],
    schedule: [
      { type: "condition", ref: "cond.hf", onset: "2018-05-22", text: "Heart failure with preserved ejection fraction" },
      { type: "condition", ref: "icd.hfpef", onset: "2018-05-22" },
      { type: "condition", ref: "cond.afib", onset: "2017-11-03" },
      { type: "condition", ref: "icd.afib", onset: "2017-11-03" },
      { type: "condition", ref: "cond.ckd3", onset: "2019-08-14" },
      { type: "condition", ref: "cond.t2dm", onset: "2004-10-19" },
      { type: "condition", ref: "cond.htn", onset: "1998-06-02" },
      { type: "condition", ref: "cond.hyperlipidemia", onset: "2002-03-27" },
      { type: "condition", ref: "cond.osteoporosis", onset: "2020-04-10" },
      { type: "condition", ref: "cond.bph", onset: "2016-09-28" },
      { type: "condition", ref: "cond.oa", onset: "2015-02-17" },
      { type: "condition", ref: "cond.oa_knee", onset: "2018-04-11", text: "Osteoarthritis of knee, right" },
      { type: "condition", ref: "cond.anemia", onset: "2021-07-06" },
      alg("penicillin"), alg("sulfa"),
      { type: "med", ref: "med.apixaban_5", start: 22, sig: "1 tablet by mouth twice daily" },
      { type: "med", ref: "med.furosemide_40", start: 28, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.spironolactone_25", start: 60, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.metoprolol_succinate_25", start: 22, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.lisinopril_10", start: 0, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.insulin_glargine", start: 66, sig: "12 units subcutaneous at bedtime" },
      { type: "med", ref: "med.atorvastatin_20", start: 0, sig: "1 tablet by mouth nightly" },
      { type: "med", ref: "med.alendronate_70", start: 52, sig: "1 tablet by mouth weekly" },
      { type: "med", ref: "med.cholecalciferol_2000", start: 52, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.tamsulosin_04", start: 33, sig: "1 capsule by mouth 30 minutes after dinner" },
      { type: "med", ref: "med.finasteride_5", start: 48, sig: "1 tablet by mouth daily" },
      { type: "med", ref: "med.trazodone_50", start: 40, sig: "1 tablet by mouth at bedtime" },
      { type: "encounter", start: 68, class: "IMP", days: 5, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "icd.hfpef", diagnosis: true, onset: null, text: "Acute decompensated HFpEF" }],
        observations: [
          { ref: "lab.ntprobnp", category: "laboratory", categoryDisplay: "Laboratory", value: 1980, unit: "pg/mL", unitCode: "pg/mL" },
          { ref: "lab.creatinine", category: "laboratory", categoryDisplay: "Laboratory", value: 2.1, unit: "mg/dL", unitCode: "mg/dL" },
          { ref: "vital.weight", category: "vital-signs", categoryDisplay: "Vital Signs", value: 194, unit: "lb", unitCode: "[lb_av]" }
        ] },
      { type: "encounter", start: 102, class: "IMP", days: 4, typeText: "Medical Services", visitType: "Medical Services",
        diagnoses: [{ ref: "icd.hfpef", diagnosis: true, onset: null, text: "Heart failure exacerbation" }],
        observations: [{ ref: "lab.ntprobnp", category: "laboratory", categoryDisplay: "Laboratory", value: 1650, unit: "pg/mL", unitCode: "pg/mL" }] },
      { type: "encounter", start: 90, class: "EMER", days: 1, typeText: "Encounter for Problem", visitType: "Encounter for Problem",
        diagnoses: [{ ref: "cond.oa_knee", diagnosis: true, onset: null, text: "Mechanical fall, no fracture" }],
        procedures: [{ ref: "proc.ct_head", text: "Head CT: chronic microvascular changes, no bleed" }] },
      { type: "procedure", ref: "proc.echo", start: 29 },
      { type: "procedure", ref: "proc.echo", start: 69 },
      { type: "procedure", ref: "proc.echo", start: 104 },
      { type: "procedure", ref: "proc.dexa", start: 52 },
      { type: "procedure", ref: "proc.dexa", start: 100 },
      { type: "procedure", ref: "proc.pt", start: 91 },
      { type: "procedure", ref: "proc.pt", start: 92 },
      { type: "procedure", ref: "proc.pt", start: 93 },
      { type: "encounter", start: 116, typeText: "Annual Visit", visitType: "Annual Visit" },
      ...fluShots(4, 10), ...covidShots(57, 4),
      { type: "immunization", ref: "vac.zoster_recomb", start: 48, day: 12 },
      { type: "immunization", ref: "vac.pneumococcal23", start: 12, day: 12 },
      { type: "immunization", ref: "vac.tdap", start: 47, day: 12 }
    ]
  }
];
