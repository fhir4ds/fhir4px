import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const BASE_FIXTURE = "tests/fixtures/fhir/smart-dev-sandbox-patient-r4.json";
const BASE_PATIENT_ID = "fhir4px-sandbox-patient";
const PATIENT_SCOPED_RESOURCE_TYPES = new Set([
  "AllergyIntolerance",
  "Condition",
  "DiagnosticReport",
  "Encounter",
  "Immunization",
  "MedicationRequest",
  "Observation",
  "Procedure"
]);

function transactionEntry(resource) {
  return {
    resource,
    request: {
      method: "PUT",
      url: `${resource.resourceType}/${resource.id}`
    }
  };
}

function codeableConcept({ system, code, display, text }) {
  const concept = {};
  if (system || code || display) concept.coding = [{ system, code, display }].filter(Boolean);
  if (text) concept.text = text;
  return concept;
}

function escapeXhtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function narrative(value) {
  return {
    status: "generated",
    div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeXhtml(value)}</div>`
  };
}

function patientReference(profile) {
  return {
    reference: `Patient/${profile.patientId}`
  };
}

function observation(
  profile,
  {
    id,
    date,
    categoryCode,
    categoryDisplay,
    code,
    value,
    unit,
    unitCode,
    text,
    display,
    codeSystem = "http://loinc.org",
    absentReason,
    encounterId
  }
) {
  return transactionEntry({
    resourceType: "Observation",
    id,
    status: "final",
    category: categoryCode
      ? [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: categoryCode,
                display: categoryDisplay
              }
            ],
            text: categoryDisplay
          }
        ]
      : undefined,
    code: code
      ? codeableConcept({ system: codeSystem, code, display, text })
      : {
          text
        },
    subject: patientReference(profile),
    effectiveDateTime: date,
    encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
    ...(absentReason
      ? {
          dataAbsentReason: {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/data-absent-reason",
                code: absentReason,
                display: absentReason
              }
            ],
            text: absentReason
          }
        }
      : {
          valueQuantity: {
            value,
            unit,
            system: "http://unitsofmeasure.org",
            code: unitCode || unit
          }
        })
  });
}

function condition(
  profile,
  {
    id,
    code,
    display,
    text,
    system = "http://snomed.info/sct",
    onsetDateTime = "2024-01-15",
    clinicalStatus = "active"
  }
) {
  return transactionEntry({
    resourceType: "Condition",
    id,
    clinicalStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
          code: clinicalStatus
        }
      ]
    },
    verificationStatus: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
          code: "confirmed"
        }
      ]
    },
    code: codeableConcept({ system, code, display, text }),
    subject: patientReference(profile),
    onsetDateTime
  });
}

function encounter(profile, { id, date, text, classCode = "AMB", classDisplay = "ambulatory" }) {
  return transactionEntry({
    resourceType: "Encounter",
    id,
    status: "finished",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: classCode,
      display: classDisplay
    },
    type: [
      {
        text
      }
    ],
    subject: patientReference(profile),
    period: {
      start: date,
      end: date
    }
  });
}

function medication({ id, code, display, text, system = "http://www.nlm.nih.gov/research/umls/rxnorm" }) {
  return transactionEntry({
    resourceType: "Medication",
    id,
    code: codeableConcept({ system, code, display, text })
  });
}

function medicationRequest(profile, { id, medicationId, authoredOn, status = "active", encounterId }) {
  return transactionEntry({
    resourceType: "MedicationRequest",
    id,
    status,
    intent: "order",
    medicationReference: {
      reference: `Medication/${medicationId}`
    },
    subject: patientReference(profile),
    authoredOn,
    encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined
  });
}

function diagnosticReport(profile, { id, date, text, resultIds, encounterId }) {
  return transactionEntry({
    resourceType: "DiagnosticReport",
    id,
    text: narrative(text),
    status: "final",
    code: {
      text
    },
    subject: patientReference(profile),
    effectiveDateTime: date,
    encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
    result: resultIds.map((resultId) => ({
      reference: `Observation/${resultId}`
    }))
  });
}

function addMonths(date, months) {
  const copy = new Date(date);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function rounded(value, places = 1) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function baseScopedId(profile, resourceType, id) {
  if (resourceType === "Patient") return profile.patientId;
  if (!PATIENT_SCOPED_RESOURCE_TYPES.has(resourceType)) return id;
  return `${profile.baseIdPrefix}-${id.replace(/^fhir4px-/, "")}`;
}

function cloneBaseEntries(baseEntries, profile) {
  const referenceMap = new Map([[`Patient/${BASE_PATIENT_ID}`, `Patient/${profile.patientId}`]]);

  for (const entry of baseEntries) {
    const resource = entry.resource;
    if (!resource?.id || !PATIENT_SCOPED_RESOURCE_TYPES.has(resource.resourceType)) continue;
    referenceMap.set(
      `${resource.resourceType}/${resource.id}`,
      `${resource.resourceType}/${baseScopedId(profile, resource.resourceType, resource.id)}`
    );
  }

  return baseEntries.map((entry) => {
    let serialized = JSON.stringify(entry);
    for (const [from, to] of referenceMap) serialized = serialized.replaceAll(from, to);

    const cloned = JSON.parse(serialized);
    const resource = cloned.resource;
    if (resource?.id) {
      resource.id = baseScopedId(profile, resource.resourceType, entry.resource.id);
      if (resource.resourceType === "Patient") {
        resource.name = [
          {
            use: "official",
            family: profile.family,
            given: profile.given
          }
        ];
      } else if (resource.resourceType === "DiagnosticReport" && !resource.text) {
        resource.text = narrative(resource.code?.text ?? resource.id);
      }
    }
    if (cloned.request?.url && resource?.resourceType && resource?.id) {
      cloned.request.url = `${resource.resourceType}/${resource.id}`;
    }
    return cloned;
  });
}

function generateJordanEntries(profile) {
  const generatedEntries = [];
  const start = new Date(Date.UTC(2023, 0, 15));
  const months = 41;

  for (let month = 0; month < months; month += 1) {
    const date = isoDate(addMonths(start, month));
    const seasonal = Math.sin(month / 3);
    const drift = month / months;

    generatedEntries.push(
      observation(profile, {
        id: `large-obs-sbp-${month + 1}`,
        date,
        categoryCode: "vital-signs",
        categoryDisplay: "Vital Signs",
        code: month % 10 === 0 ? undefined : "8480-6",
        text: month % 10 === 0 ? "systolic BP home reading" : month % 3 === 0 ? "Systolic BP" : undefined,
        display: "Systolic blood pressure",
        value: Math.round(132 - 10 * drift + seasonal * 4),
        unit: "mmHg",
        unitCode: "mm[Hg]",
        codeSystem: month % 7 === 0 ? "urn:oid:2.16.840.1.113883.6.1" : "http://loinc.org"
      }),
      observation(profile, {
        id: `large-obs-dbp-${month + 1}`,
        date,
        categoryCode: "vital-signs",
        categoryDisplay: "Vital Signs",
        code: "8462-4",
        text: month % 4 === 0 ? "Diastolic BP" : undefined,
        display: "Diastolic blood pressure",
        value: Math.round(82 - 6 * drift + seasonal * 3),
        unit: "mmHg",
        unitCode: "mm[Hg]"
      }),
      observation(profile, {
        id: `large-obs-weight-${month + 1}`,
        date,
        categoryCode: "vital-signs",
        categoryDisplay: "Vital Signs",
        code: "29463-7",
        text: month % 6 === 0 ? "Body weight measured" : undefined,
        display: "Body weight",
        value: rounded(188 - month * 0.35 + seasonal, 1),
        unit: "lb",
        unitCode: "[lb_av]"
      }),
      observation(profile, {
        id: `large-obs-bmi-${month + 1}`,
        date,
        categoryCode: "vital-signs",
        categoryDisplay: "Vital Signs",
        code: "39156-5",
        display: "Body mass index",
        value: rounded(30.4 - month * 0.05, 1),
        unit: "kg/m2",
        unitCode: "kg/m2"
      }),
      observation(profile, {
        id: `large-obs-heart-rate-${month + 1}`,
        date,
        categoryCode: "vital-signs",
        categoryDisplay: "Vital Signs",
        code: "8867-4",
        text: month % 8 === 0 ? "Pulse" : undefined,
        display: "Heart rate",
        value: Math.round(76 + seasonal * 5),
        unit: "beats/minute",
        unitCode: "{beats}/min"
      }),
      observation(profile, {
        id: `large-obs-spo2-${month + 1}`,
        date,
        categoryCode: "vital-signs",
        categoryDisplay: "Vital Signs",
        code: month % 9 === 0 ? undefined : "59408-5",
        text: month % 9 === 0 ? "pulse ox" : undefined,
        display: "Oxygen saturation in Arterial blood by Pulse oximetry",
        value: Math.round(96 + Math.cos(month / 2)),
        unit: "%",
        unitCode: "%"
      })
    );

    generatedEntries.push(
      observation(profile, {
        id: `large-obs-glucose-${month + 1}`,
        date,
        categoryCode: "laboratory",
        categoryDisplay: "Laboratory",
        code: month % 11 === 0 ? undefined : "2339-0",
        text: month % 11 === 0 ? "Blood glucose lab" : undefined,
        display: "Glucose [Mass/volume] in Blood",
        value: Math.round(128 - month * 0.4 + seasonal * 8),
        unit: "mg/dL",
        unitCode: "mg/dL"
      }),
      observation(profile, {
        id: `large-obs-creatinine-${month + 1}`,
        date,
        categoryCode: "laboratory",
        categoryDisplay: "Laboratory",
        code: "2160-0",
        text: month % 5 === 0 ? "Creatinine serum" : undefined,
        display: "Creatinine [Mass/volume] in Serum or Plasma",
        value: rounded(0.9 + seasonal * 0.08, 2),
        unit: "mg/dL",
        unitCode: "mg/dL",
        codeSystem: month % 6 === 0 ? "oid:2.16.840.1.113883.6.1" : "http://loinc.org"
      })
    );

    if (month % 3 === 0) {
      generatedEntries.push(
        observation(profile, {
          id: `large-obs-a1c-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: month % 12 === 0 ? undefined : "4548-4",
          text: month % 12 === 0 ? "HbA1c lab value" : month % 6 === 0 ? "A1c" : undefined,
          display: "Hemoglobin A1c/Hemoglobin.total in Blood",
          value: rounded(8.1 - month * 0.035 + seasonal * 0.2, 1),
          unit: "%",
          unitCode: "%"
        }),
        observation(profile, {
          id: `large-obs-ldl-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "18262-6",
          text: month % 9 === 0 ? "LDL cholesterol calculated" : undefined,
          display: "Cholesterol in LDL [Mass/volume] in Serum or Plasma by Direct assay",
          value: Math.round(142 - month * 0.9 + seasonal * 5),
          unit: "mg/dL",
          unitCode: "mg/dL"
        }),
        observation(profile, {
          id: `large-obs-hdl-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "2085-9",
          display: "Cholesterol in HDL [Mass/volume] in Serum or Plasma",
          value: Math.round(44 + drift * 4 + seasonal * 2),
          unit: "mg/dL",
          unitCode: "mg/dL"
        }),
        observation(profile, {
          id: `large-obs-triglycerides-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "2571-8",
          display: "Triglyceride [Mass/volume] in Serum or Plasma",
          value: Math.round(188 - month * 1.2 + seasonal * 12),
          unit: "mg/dL",
          unitCode: "mg/dL"
        }),
        observation(profile, {
          id: `large-obs-vitamin-d-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: month % 15 === 0 ? undefined : "62292-8",
          text: month % 15 === 0 ? "Vitamin D level" : undefined,
          display: "25-hydroxyvitamin D [Mass/volume] in Serum or Plasma",
          value: Math.round(23 + drift * 12 + seasonal * 3),
          unit: "ng/mL",
          unitCode: "ng/mL"
        })
      );
    }

    if (month % 6 === 0) {
      generatedEntries.push(
        observation(profile, {
          id: `large-obs-egfr-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "33914-3",
          display: "Glomerular filtration rate/1.73 sq M.predicted",
          value: Math.round(88 - drift * 6 + seasonal * 2),
          unit: "mL/min/1.73m2",
          unitCode: "mL/min/{1.73_m2}"
        }),
        observation(profile, {
          id: `large-obs-tsh-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "3016-3",
          display: "Thyrotropin [Units/volume] in Serum or Plasma",
          value: rounded(2.1 + seasonal * 0.2, 2),
          unit: "uIU/mL",
          unitCode: "u[IU]/mL"
        })
      );
    }
  }

  generatedEntries.push(
    observation(profile, {
      id: "large-obs-lab-pending-no-value",
      date: "2026-05-20",
      categoryCode: "laboratory",
      categoryDisplay: "Laboratory",
      code: "718-7",
      display: "Hemoglobin [Mass/volume] in Blood",
      text: "Hemoglobin",
      absentReason: "asked-declined"
    }),
    medicationRequest(profile, {
      id: "large-medreq-metformin-2023",
      medicationId: "fhir4px-med-metformin",
      authoredOn: "2023-01-15",
      status: "stopped"
    }),
    medicationRequest(profile, {
      id: "large-medreq-metformin-2024",
      medicationId: "fhir4px-med-metformin",
      authoredOn: "2024-01-15"
    }),
    medicationRequest(profile, {
      id: "large-medreq-metformin-er-2025",
      medicationId: "fhir4px-med-metformin-er",
      authoredOn: "2025-03-15"
    }),
    medicationRequest(profile, {
      id: "large-medreq-albuterol-inhaler-2024",
      medicationId: "fhir4px-med-albuterol-inhaler",
      authoredOn: "2024-04-10"
    }),
    medicationRequest(profile, {
      id: "large-medreq-albuterol-solution-2024",
      medicationId: "fhir4px-med-albuterol-solution",
      authoredOn: "2024-11-20"
    }),
    medicationRequest(profile, {
      id: "large-medreq-atorvastatin-2024",
      medicationId: "fhir4px-med-atorvastatin",
      authoredOn: "2024-02-01"
    })
  );

  return generatedEntries;
}

function generateCardiorenalEntries(profile) {
  const entries = [
    condition(profile, {
      id: "cardiorenal-condition-heart-failure",
      code: "84114007",
      display: "Heart failure",
      text: "Heart failure"
    }),
    condition(profile, {
      id: "cardiorenal-condition-atrial-fibrillation",
      code: "49436004",
      display: "Atrial fibrillation",
      text: "Atrial fibrillation"
    }),
    condition(profile, {
      id: "cardiorenal-condition-ckd-stage-3",
      code: "433144002",
      display: "Chronic kidney disease stage 3",
      text: "Chronic kidney disease stage 3"
    }),
    condition(profile, {
      id: "cardiorenal-condition-anticoagulant-use",
      system: "http://hl7.org/fhir/sid/icd-10-cm",
      code: "Z79.01",
      display: "Long term (current) use of anticoagulants",
      text: "Long-term anticoagulant therapy"
    }),
    condition(profile, {
      id: "cardiorenal-condition-hyperlipidemia",
      code: "55822004",
      display: "Hyperlipidemia",
      text: "Hyperlipidemia"
    }),
    condition(profile, {
      id: "cardiorenal-condition-sleep-apnea",
      code: "78275009",
      display: "Obstructive sleep apnea syndrome",
      text: "Obstructive sleep apnea"
    }),
    condition(profile, {
      id: "cardiorenal-condition-copd",
      code: "13645005",
      display: "Chronic obstructive lung disease",
      text: "Chronic obstructive pulmonary disease"
    }),
    encounter(profile, {
      id: "cardiorenal-encounter-cardiology",
      date: "2026-05-14",
      text: "Cardiology follow-up"
    }),
    medication({
      id: "fhir4px-med-warfarin",
      code: "855332",
      display: "warfarin sodium 5 MG Oral Tablet",
      text: "Warfarin 5 mg tablet"
    }),
    medication({
      id: "fhir4px-med-furosemide",
      code: "310429",
      display: "furosemide 40 MG Oral Tablet",
      text: "Furosemide 40 mg tablet"
    }),
    medication({
      id: "fhir4px-med-lisinopril",
      code: "314076",
      display: "lisinopril 10 MG Oral Tablet",
      text: "Lisinopril 10 mg tablet"
    }),
    medication({
      id: "fhir4px-med-carvedilol",
      code: "200031",
      display: "carvedilol 12.5 MG Oral Tablet",
      text: "Carvedilol 12.5 mg tablet"
    }),
    medicationRequest(profile, {
      id: "cardiorenal-medreq-warfarin-2024",
      medicationId: "fhir4px-med-warfarin",
      authoredOn: "2024-02-01",
      encounterId: "cardiorenal-encounter-cardiology"
    }),
    medicationRequest(profile, {
      id: "cardiorenal-medreq-furosemide-2024",
      medicationId: "fhir4px-med-furosemide",
      authoredOn: "2024-02-01",
      encounterId: "cardiorenal-encounter-cardiology"
    }),
    medicationRequest(profile, {
      id: "cardiorenal-medreq-lisinopril-2024",
      medicationId: "fhir4px-med-lisinopril",
      authoredOn: "2024-02-01",
      encounterId: "cardiorenal-encounter-cardiology"
    }),
    medicationRequest(profile, {
      id: "cardiorenal-medreq-carvedilol-2025",
      medicationId: "fhir4px-med-carvedilol",
      authoredOn: "2025-01-15",
      encounterId: "cardiorenal-encounter-cardiology"
    })
  ];
  const start = new Date(Date.UTC(2023, 5, 10));
  const months = 36;

  for (let month = 0; month < months; month += 1) {
    const date = isoDate(addMonths(start, month));
    const seasonal = Math.sin(month / 4);
    const drift = month / months;

    entries.push(
      observation(profile, {
        id: `cardiorenal-obs-sbp-${month + 1}`,
        date,
        categoryCode: "vital-signs",
        categoryDisplay: "Vital Signs",
        code: month % 8 === 0 ? undefined : "8480-6",
        text: month % 8 === 0 ? "home systolic blood pressure" : "Systolic blood pressure",
        display: "Systolic blood pressure",
        value: Math.round(146 - 12 * drift + seasonal * 5),
        unit: "mmHg",
        unitCode: "mm[Hg]"
      }),
      observation(profile, {
        id: `cardiorenal-obs-dbp-${month + 1}`,
        date,
        categoryCode: "vital-signs",
        categoryDisplay: "Vital Signs",
        code: "8462-4",
        text: month % 6 === 0 ? "home diastolic blood pressure" : undefined,
        display: "Diastolic blood pressure",
        value: Math.round(88 - 8 * drift + seasonal * 4),
        unit: "mmHg",
        unitCode: "mm[Hg]"
      }),
      observation(profile, {
        id: `cardiorenal-obs-weight-${month + 1}`,
        date,
        categoryCode: "vital-signs",
        categoryDisplay: "Vital Signs",
        code: "29463-7",
        text: month % 4 === 0 ? "Daily heart failure weight" : undefined,
        display: "Body weight",
        value: rounded(214 - month * 0.25 + Math.cos(month / 3) * 2, 1),
        unit: "lb",
        unitCode: "[lb_av]"
      }),
      observation(profile, {
        id: `cardiorenal-obs-heart-rate-${month + 1}`,
        date,
        categoryCode: "vital-signs",
        categoryDisplay: "Vital Signs",
        code: "8867-4",
        display: "Heart rate",
        value: Math.round(84 + seasonal * 7),
        unit: "beats/minute",
        unitCode: "{beats}/min"
      }),
      observation(profile, {
        id: `cardiorenal-obs-spo2-${month + 1}`,
        date,
        categoryCode: "vital-signs",
        categoryDisplay: "Vital Signs",
        code: "59408-5",
        display: "Oxygen saturation in Arterial blood by Pulse oximetry",
        value: Math.round(94 + Math.cos(month / 4)),
        unit: "%",
        unitCode: "%"
      }),
      observation(profile, {
        id: `cardiorenal-obs-creatinine-${month + 1}`,
        date,
        categoryCode: "laboratory",
        categoryDisplay: "Laboratory",
        code: "2160-0",
        text: month % 5 === 0 ? "Serum creatinine" : undefined,
        display: "Creatinine [Mass/volume] in Serum or Plasma",
        value: rounded(1.45 + seasonal * 0.12 - drift * 0.08, 2),
        unit: "mg/dL",
        unitCode: "mg/dL"
      }),
      observation(profile, {
        id: `cardiorenal-obs-egfr-${month + 1}`,
        date,
        categoryCode: "laboratory",
        categoryDisplay: "Laboratory",
        code: "33914-3",
        text: month % 7 === 0 ? "eGFR kidney function" : undefined,
        display: "Glomerular filtration rate/1.73 sq M.predicted",
        value: Math.round(48 + drift * 6 + seasonal * 3),
        unit: "mL/min/1.73m2",
        unitCode: "mL/min/{1.73_m2}"
      }),
      observation(profile, {
        id: `cardiorenal-obs-potassium-${month + 1}`,
        date,
        categoryCode: "laboratory",
        categoryDisplay: "Laboratory",
        code: "2823-3",
        display: "Potassium [Moles/volume] in Serum or Plasma",
        value: rounded(4.6 + seasonal * 0.22, 1),
        unit: "mmol/L",
        unitCode: "mmol/L"
      }),
      observation(profile, {
        id: `cardiorenal-obs-sodium-${month + 1}`,
        date,
        categoryCode: "laboratory",
        categoryDisplay: "Laboratory",
        code: "2951-2",
        display: "Sodium [Moles/volume] in Serum or Plasma",
        value: Math.round(137 + Math.cos(month / 6)),
        unit: "mmol/L",
        unitCode: "mmol/L"
      }),
      observation(profile, {
        id: `cardiorenal-obs-inr-${month + 1}`,
        date,
        categoryCode: "laboratory",
        categoryDisplay: "Laboratory",
        code: month % 9 === 0 ? undefined : "6301-6",
        text: month % 9 === 0 ? "PT/INR anticoagulation check" : "INR",
        display: "INR in Platelet poor plasma by Coagulation assay",
        value: rounded(2.35 + seasonal * 0.28, 1),
        unit: "ratio",
        unitCode: "{ratio}"
      })
    );

    if (month % 2 === 0) {
      entries.push(
        observation(profile, {
          id: `cardiorenal-obs-bnp-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: month % 10 === 0 ? undefined : "30934-4",
          text: month % 10 === 0 ? "BNP heart failure marker" : undefined,
          display: "Natriuretic peptide B [Mass/volume] in Serum or Plasma",
          value: Math.round(410 - month * 4 + seasonal * 35),
          unit: "pg/mL",
          unitCode: "pg/mL"
        })
      );
    }

    if (month % 3 === 0) {
      entries.push(
        observation(profile, {
          id: `cardiorenal-obs-uacr-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "9318-7",
          text: month % 12 === 0 ? "Urine albumin creatinine ratio" : undefined,
          display: "Albumin/Creatinine [Mass Ratio] in Urine",
          value: Math.round(86 - drift * 18 + seasonal * 6),
          unit: "mg/g",
          unitCode: "mg/g"
        }),
        observation(profile, {
          id: `cardiorenal-obs-a1c-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "4548-4",
          text: month % 9 === 0 ? "HbA1c" : undefined,
          display: "Hemoglobin A1c/Hemoglobin.total in Blood",
          value: rounded(7.6 - drift * 0.5 + seasonal * 0.15, 1),
          unit: "%",
          unitCode: "%"
        })
      );
    }

    if (month % 6 === 0) {
      entries.push(
        observation(profile, {
          id: `cardiorenal-obs-ldl-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "18262-6",
          display: "Cholesterol in LDL [Mass/volume] in Serum or Plasma by Direct assay",
          value: Math.round(124 - month * 0.8 + seasonal * 7),
          unit: "mg/dL",
          unitCode: "mg/dL"
        })
      );
    }
  }

  entries.push(
    diagnosticReport(profile, {
      id: "cardiorenal-report-anticoagulation",
      date: "2026-05-14",
      text: "Anticoagulation monitoring report",
      encounterId: "cardiorenal-encounter-cardiology",
      resultIds: ["cardiorenal-obs-inr-36", "cardiorenal-obs-creatinine-36", "cardiorenal-obs-potassium-36"]
    }),
    diagnosticReport(profile, {
      id: "cardiorenal-report-heart-failure",
      date: "2026-05-14",
      text: "Heart failure monitoring report",
      encounterId: "cardiorenal-encounter-cardiology",
      resultIds: ["cardiorenal-obs-bnp-35", "cardiorenal-obs-weight-36", "cardiorenal-obs-sodium-36"]
    })
  );

  return entries;
}

function generateRespiratoryImmuneEntries(profile) {
  const entries = [
    condition(profile, {
      id: "respimmune-condition-asthma",
      code: "195967001",
      display: "Asthma",
      text: "Asthma"
    }),
    condition(profile, {
      id: "respimmune-condition-copd",
      code: "13645005",
      display: "Chronic obstructive lung disease",
      text: "Chronic obstructive pulmonary disease"
    }),
    condition(profile, {
      id: "respimmune-condition-hiv",
      code: "86406008",
      display: "Human immunodeficiency virus infection",
      text: "HIV infection"
    }),
    condition(profile, {
      id: "respimmune-condition-bipolar",
      code: "13746004",
      display: "Bipolar disorder",
      text: "Bipolar disorder"
    }),
    condition(profile, {
      id: "respimmune-condition-iron-deficiency-anemia",
      code: "87522002",
      display: "Iron deficiency anemia",
      text: "Iron deficiency anemia"
    }),
    condition(profile, {
      id: "respimmune-condition-hypothyroidism",
      code: "40930008",
      display: "Hypothyroidism",
      text: "Hypothyroidism"
    }),
    condition(profile, {
      id: "respimmune-condition-osteoporosis",
      code: "64859006",
      display: "Osteoporosis",
      text: "Osteoporosis"
    }),
    encounter(profile, {
      id: "respimmune-encounter-pulmonary",
      date: "2026-05-22",
      text: "Pulmonary and infectious disease follow-up"
    }),
    medication({
      id: "fhir4px-med-fluticasone-salmeterol",
      code: "896001",
      display: "fluticasone propionate 0.25 MG/ACTUAT / salmeterol 0.05 MG/ACTUAT Dry Powder Inhaler",
      text: "Fluticasone salmeterol inhaler"
    }),
    medication({
      id: "fhir4px-med-biktarvy",
      code: "1999673",
      display: "bictegravir 50 MG / emtricitabine 200 MG / tenofovir alafenamide 25 MG Oral Tablet",
      text: "Bictegravir emtricitabine tenofovir tablet"
    }),
    medication({
      id: "fhir4px-med-lithium",
      code: "197528",
      display: "lithium carbonate 300 MG Oral Capsule",
      text: "Lithium carbonate 300 mg capsule"
    }),
    medication({
      id: "fhir4px-med-levothyroxine",
      code: "966222",
      display: "levothyroxine sodium 50 MCG Oral Tablet",
      text: "Levothyroxine 50 mcg tablet"
    }),
    medication({
      id: "fhir4px-med-ferrous-sulfate",
      code: "310325",
      display: "ferrous sulfate 325 MG Oral Tablet",
      text: "Ferrous sulfate 325 mg tablet"
    }),
    medicationRequest(profile, {
      id: "respimmune-medreq-fluticasone-salmeterol-2024",
      medicationId: "fhir4px-med-fluticasone-salmeterol",
      authoredOn: "2024-03-01",
      encounterId: "respimmune-encounter-pulmonary"
    }),
    medicationRequest(profile, {
      id: "respimmune-medreq-biktarvy-2024",
      medicationId: "fhir4px-med-biktarvy",
      authoredOn: "2024-03-01",
      encounterId: "respimmune-encounter-pulmonary"
    }),
    medicationRequest(profile, {
      id: "respimmune-medreq-lithium-2024",
      medicationId: "fhir4px-med-lithium",
      authoredOn: "2024-03-01",
      encounterId: "respimmune-encounter-pulmonary"
    }),
    medicationRequest(profile, {
      id: "respimmune-medreq-levothyroxine-2024",
      medicationId: "fhir4px-med-levothyroxine",
      authoredOn: "2024-03-01",
      encounterId: "respimmune-encounter-pulmonary"
    }),
    medicationRequest(profile, {
      id: "respimmune-medreq-ferrous-sulfate-2024",
      medicationId: "fhir4px-med-ferrous-sulfate",
      authoredOn: "2024-09-01",
      encounterId: "respimmune-encounter-pulmonary"
    })
  ];
  const start = new Date(Date.UTC(2023, 6, 5));
  const months = 36;

  for (let month = 0; month < months; month += 1) {
    const date = isoDate(addMonths(start, month));
    const seasonal = Math.sin(month / 3);
    const drift = month / months;

    entries.push(
      observation(profile, {
        id: `respimmune-obs-peak-flow-${month + 1}`,
        date,
        categoryCode: "procedure",
        categoryDisplay: "Procedure",
        code: month % 8 === 0 ? undefined : "33452-4",
        text: month % 8 === 0 ? "Peak flow home reading" : "Peak expiratory flow",
        display: "Peak expiratory flow rate",
        value: Math.round(340 + drift * 45 + seasonal * 18),
        unit: "L/min",
        unitCode: "L/min"
      }),
      observation(profile, {
        id: `respimmune-obs-fev1-${month + 1}`,
        date,
        categoryCode: "procedure",
        categoryDisplay: "Procedure",
        code: "20150-9",
        text: month % 9 === 0 ? "FEV1 spirometry" : undefined,
        display: "FEV1",
        value: rounded(1.85 + drift * 0.25 + seasonal * 0.08, 2),
        unit: "L",
        unitCode: "L"
      }),
      observation(profile, {
        id: `respimmune-obs-spo2-${month + 1}`,
        date,
        categoryCode: "vital-signs",
        categoryDisplay: "Vital Signs",
        code: "59408-5",
        display: "Oxygen saturation in Arterial blood by Pulse oximetry",
        value: Math.round(95 + Math.cos(month / 5)),
        unit: "%",
        unitCode: "%"
      }),
      observation(profile, {
        id: `respimmune-obs-respiratory-rate-${month + 1}`,
        date,
        categoryCode: "vital-signs",
        categoryDisplay: "Vital Signs",
        code: "9279-1",
        display: "Respiratory rate",
        value: Math.round(18 + seasonal * 2),
        unit: "breaths/minute",
        unitCode: "{breaths}/min"
      })
    );

    if (month % 2 === 0) {
      entries.push(
        observation(profile, {
          id: `respimmune-obs-cd4-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "8122-4",
          text: month % 10 === 0 ? "CD4 count" : undefined,
          display: "CD3+CD4+ (T4 helper) cells [#/volume] in Blood",
          value: Math.round(420 + drift * 90 + seasonal * 22),
          unit: "cells/uL",
          unitCode: "{cells}/uL"
        }),
        observation(profile, {
          id: `respimmune-obs-hiv-viral-load-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: month % 12 === 0 ? undefined : "20447-9",
          text: month % 12 === 0 ? "HIV viral load" : undefined,
          display: "HIV 1 RNA [#/volume] (viral load) in Serum or Plasma by NAA with probe detection",
          value: Math.max(20, Math.round(160 - drift * 130 + seasonal * 12)),
          unit: "copies/mL",
          unitCode: "{copies}/mL"
        }),
        observation(profile, {
          id: `respimmune-obs-lithium-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "14334-7",
          text: month % 8 === 0 ? "Lithium level" : undefined,
          display: "Lithium [Moles/volume] in Serum or Plasma",
          value: rounded(0.72 + seasonal * 0.08, 2),
          unit: "mmol/L",
          unitCode: "mmol/L"
        })
      );
    }

    if (month % 3 === 0) {
      entries.push(
        observation(profile, {
          id: `respimmune-obs-tsh-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "3016-3",
          text: month % 12 === 0 ? "Thyroid stimulating hormone" : undefined,
          display: "Thyrotropin [Units/volume] in Serum or Plasma",
          value: rounded(4.2 - drift * 1.1 + seasonal * 0.2, 2),
          unit: "uIU/mL",
          unitCode: "u[IU]/mL"
        }),
        observation(profile, {
          id: `respimmune-obs-ferritin-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "2276-4",
          text: month % 9 === 0 ? "Ferritin iron stores" : undefined,
          display: "Ferritin [Mass/volume] in Serum or Plasma",
          value: Math.round(18 + drift * 22 + seasonal * 4),
          unit: "ng/mL",
          unitCode: "ng/mL"
        }),
        observation(profile, {
          id: `respimmune-obs-hemoglobin-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "718-7",
          display: "Hemoglobin [Mass/volume] in Blood",
          value: rounded(10.8 + drift * 1.4 + seasonal * 0.2, 1),
          unit: "g/dL",
          unitCode: "g/dL"
        }),
        observation(profile, {
          id: `respimmune-obs-vitamin-d-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "62292-8",
          display: "25-hydroxyvitamin D [Mass/volume] in Serum or Plasma",
          value: Math.round(29 + seasonal * 4),
          unit: "ng/mL",
          unitCode: "ng/mL"
        }),
        observation(profile, {
          id: `respimmune-obs-crp-${month + 1}`,
          date,
          categoryCode: "laboratory",
          categoryDisplay: "Laboratory",
          code: "1988-5",
          text: month % 12 === 0 ? "C reactive protein" : undefined,
          display: "C reactive protein [Mass/volume] in Serum or Plasma",
          value: rounded(4.8 + seasonal * 1.4, 1),
          unit: "mg/L",
          unitCode: "mg/L"
        })
      );
    }
  }

  entries.push(
    diagnosticReport(profile, {
      id: "respimmune-report-hiv-monitoring",
      date: "2026-05-22",
      text: "HIV monitoring report",
      encounterId: "respimmune-encounter-pulmonary",
      resultIds: ["respimmune-obs-cd4-35", "respimmune-obs-hiv-viral-load-35"]
    }),
    diagnosticReport(profile, {
      id: "respimmune-report-respiratory-function",
      date: "2026-05-22",
      text: "Respiratory function monitoring report",
      encounterId: "respimmune-encounter-pulmonary",
      resultIds: ["respimmune-obs-peak-flow-36", "respimmune-obs-fev1-36", "respimmune-obs-spo2-36"]
    }),
    diagnosticReport(profile, {
      id: "respimmune-report-medication-monitoring",
      date: "2026-05-22",
      text: "Medication safety monitoring report",
      encounterId: "respimmune-encounter-pulmonary",
      resultIds: ["respimmune-obs-lithium-35", "respimmune-obs-tsh-34", "respimmune-obs-ferritin-34"]
    })
  );

  return entries;
}

const fixtureProfiles = [
  {
    patientId: "fhir4px-large-sandbox-patient",
    outputFixture: "tests/fixtures/fhir/large-patient-r4.json",
    baseIdPrefix: "jordan",
    family: "Longitudinal",
    given: ["Jordan"],
    generateEntries: generateJordanEntries
  },
  {
    patientId: "fhir4px-large-cardiorenal-patient",
    outputFixture: "tests/fixtures/fhir/large-cardiorenal-patient-r4.json",
    baseIdPrefix: "cardiorenal-base",
    family: "Cardiorenal",
    given: ["Riley"],
    generateEntries: generateCardiorenalEntries
  },
  {
    patientId: "fhir4px-large-respiratory-immune-patient",
    outputFixture: "tests/fixtures/fhir/large-respiratory-immune-patient-r4.json",
    baseIdPrefix: "respimmune-base",
    family: "Respiratory-Immune",
    given: ["Morgan"],
    generateEntries: generateRespiratoryImmuneEntries
  }
];

const baseBundle = JSON.parse(await readFile(resolve(process.cwd(), BASE_FIXTURE), "utf8"));
const summaries = [];

for (const profile of fixtureProfiles) {
  const baseEntries = cloneBaseEntries(baseBundle.entry ?? [], profile);
  const bundle = {
    ...baseBundle,
    entry: [...baseEntries, ...profile.generateEntries(profile)]
  };

  const outputPath = resolve(process.cwd(), profile.outputFixture);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");

  const counts = bundle.entry.reduce((summary, entry) => {
    const type = entry.resource?.resourceType ?? "Unknown";
    summary[type] = (summary[type] ?? 0) + 1;
    return summary;
  }, {});

  summaries.push({
    output: outputPath,
    patientId: profile.patientId,
    totalResources: bundle.entry.length,
    counts
  });
}

console.log(JSON.stringify(summaries, null, 2));
