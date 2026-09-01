/**
 * Generate the 25-patient chronic-condition cohort fixtures.
 *
 * Every code comes from scripts/chronic-cohort/catalog.resolved.json, which is
 * produced by resolve-catalog.py against UMLS 2026AA via medterm4ds — the
 * generator never invents a code or display string.
 *
 *   node scripts/generate-chronic-cohort.mjs
 *
 * Outputs:
 *   tests/fixtures/fhir/chronic/<patient-id>.json
 *   tests/fixtures/fhir/chronic/manifest.json   (counts + centroid ground truth)
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = resolve(__dirname, "chronic-cohort", "catalog.resolved.json");
const OUT_DIR = resolve(__dirname, "..", "tests", "fixtures", "fhir", "chronic");

const US_CORE = {
  patient: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient",
  race: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-race",
  ethnicity: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity",
  condition: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-condition",
  medication: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-medication",
  medicationRequest: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-medicationrequest",
  observationLab: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-observation-lab",
  vitalSigns: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-vital-signs",
  smokingStatus: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-smokingstatus",
  procedure: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-procedure",
  encounter: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-encounter",
  immunization: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-immunization",
  allergy: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-allergyintolerance",
  reportLab: "http://hl7.org/fhir/us/core/StructureDefinition/us-core-diagnosticreport-lab"
};

const OBS_CATEGORY = "http://terminology.hl7.org/CodeSystem/observation-category";
const OMB_RACE = "urn:oid:2.16.840.1.113883.6.238";
const OMB_ETH = "urn:oid:2.16.840.1.113883.6.238";

const RACE_CODES = {
  white: ["2106-3", "White"],
  black: ["2054-5", "Black or African American"],
  asian: ["2028-9", "Asian"],
  ai: ["1002-5", "American Indian or Alaska Native"],
  pi: ["2076-8", "Native Hawaiian or Other Pacific Islander"]
};
const ETH_CODES = {
  hispanic: ["2135-2", "Hispanic or Latino"],
  non_hispanic: ["2186-5", "Not Hispanic or Latino"]
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function addMonths(year, month, day, offset) {
  const d = new Date(Date.UTC(year, month, day));
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d;
}

function rounded(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function stableHash(value) {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function fitId(value) {
  if (value.length <= 64) return value;
  return `${value.slice(0, 54)}-${stableHash(value)}`;
}

function codeableConcept(catalogEntry, text) {
  return {
    coding: [
      { system: catalogEntry.fhirSystem, code: catalogEntry.code, display: catalogEntry.display }
    ],
    text: text ?? catalogEntry.display
  };
}

class PatientBuilder {
  constructor(spec, catalog) {
    this.spec = spec;
    this.catalog = catalog;
    this.rng = mulberry32(spec.seed);
    this.resources = [];
    this.groundTruth = { observations: [], allergies: [], encounters: [] };
    this.encounterByMonth = new Map();
    this.obsByMonth = new Map();
    this.medResources = new Map();
    this.counter = 0;
    this.nextId = (prefix) => `${spec.id}-${prefix}-${String(++this.counter).padStart(4, "0")}`;
    this.patientRef = { reference: `Patient/${spec.id}` };
  }

  push(resource) {
    this.resources.push(resource);
    return resource;
  }

  // ---- demographics -------------------------------------------------------
  buildPatient() {
    const race = RACE_CODES[this.spec.race];
    const eth = ETH_CODES[this.spec.ethnicity];
    this.push({
      resourceType: "Patient",
      id: this.spec.id,
      meta: { profile: [US_CORE.patient] },
      extension: [
        {
          url: US_CORE.race,
          extension: [
            { url: "ombCategory", valueCoding: { system: OMB_RACE, code: race[0], display: race[1] } },
            { url: "text", valueString: race[1] }
          ]
        },
        {
          url: US_CORE.ethnicity,
          extension: [
            { url: "ombCategory", valueCoding: { system: OMB_ETH, code: eth[0], display: eth[1] } },
            { url: "text", valueString: eth[1] }
          ]
        }
      ],
      identifier: [
        { system: `https://fhir4px.local/chronic-cohort/${this.spec.tier}`, value: `MRN-${this.spec.mrn}` }
      ],
      name: [{ use: "official", family: this.spec.family, given: this.spec.given }],
      gender: this.spec.gender,
      birthDate: this.spec.birthDate
    });
  }

  // ---- helpers ------------------------------------------------------------
  entry(ref) {
    const e = this.catalog.get(ref);
    if (!e) throw new Error(`catalog ref not found: ${ref}`);
    return e;
  }

  monthDate(month, dayOverride) {
    const [y, m, d] = this.spec.anchor;
    return iso(addMonths(y, m - 1, dayOverride ?? d, month));
  }

  registerEncounter(id, month, klass, typeText) {
    if (!this.encounterByMonth.has(month)) this.encounterByMonth.set(month, []);
    this.encounterByMonth.get(month).push(id);
  }

  // ---- clinical resources -------------------------------------------------
  condition(def) {
    const entry = this.entry(def.ref);
    const resource = {
      resourceType: "Condition",
      id: this.nextId("cond"),
      meta: { profile: [US_CORE.condition] },
      clinicalStatus: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
            code: def.clinicalStatus ?? "active"
          }
        ]
      },
      verificationStatus: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
            code: def.verificationStatus ?? "confirmed"
          }
        ]
      },
      category: [
        {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/condition-category",
              code: def.diagnosis ? "encounter-diagnosis" : "problem-list-item",
              display: def.diagnosis ? "Encounter Diagnosis" : "Problem List Item"
            }
          ]
        }
      ],
      code: codeableConcept(entry, def.text),
      subject: this.patientRef,
      ...(def.onset ? { onsetDateTime: def.onset } : {})
    };
    if (def.abatement) resource.abatementDateTime = def.abatement;
    if (def.encounterId) resource.encounter = { reference: `Encounter/${def.encounterId}` };
    return this.push(resource);
  }

  medication(ref) {
    if (this.medResources.has(ref)) return this.medResources.get(ref);
    const entry = this.entry(ref);
    const resource = this.push({
      resourceType: "Medication",
      id: fitId(`${this.spec.id}-med-${entry.id.split(".")[1].replaceAll("_", "-")}`),
      meta: { profile: [US_CORE.medication] },
      code: codeableConcept(entry)
    });
    this.medResources.set(ref, resource);
    return resource;
  }

  medicationRequest(def) {
    const med = this.medication(def.ref);
    const resource = this.push({
      resourceType: "MedicationRequest",
      id: this.nextId("medreq"),
      meta: { profile: [US_CORE.medicationRequest] },
      status: def.status ?? "active",
      intent: "order",
      medicationReference: { reference: `Medication/${med.id}` },
      subject: this.patientRef,
      authoredOn: def.date,
      requester: { reference: `Practitioner/${this.practitionerIds[0]}` },
      dosageInstruction: def.sig ? [{ text: def.sig }] : undefined,
      encounter: def.encounterId ? { reference: `Encounter/${def.encounterId}` } : undefined
    });
    if (def.stop) {
      this.push({
        ...resource,
        id: this.nextId("medreq-stop"),
        status: "stopped"
        // authoredOn stays the original; stop modeled as a separate stopped request below
      });
    }
    return resource;
  }

  stoppedMedicationRequest(ref, startDate, stopDate, sig, encounterId) {
    const med = this.medication(ref);
    this.push({
      resourceType: "MedicationRequest",
      id: this.nextId("medreq"),
      meta: { profile: [US_CORE.medicationRequest] },
      status: "stopped",
      intent: "order",
      medicationReference: { reference: `Medication/${med.id}` },
      subject: this.patientRef,
      requester: { reference: `Practitioner/${this.practitionerIds[0]}` },
      authoredOn: stopDate,
      dosageInstruction: sig ? [{ text: sig }] : undefined,
      encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined
    });
  }

  encounter(def) {
    const resource = this.push({
      resourceType: "Encounter",
      id: this.nextId("enc"),
      meta: { profile: [US_CORE.encounter] },
      identifier: [{ system: "https://fhir4px.local/encounter", value: `ENC-${this.spec.mrn}-${this.counter}` }],
      status: "finished",
      class: {
        system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
        code: def.class,
        display: { AMB: "ambulatory", EMER: "emergency", IMP: "inpatient encounter", VR: "virtual", SS: "short stay" }[def.class] ?? "ambulatory"
      },
      type: [{ text: def.typeText }],
      subject: this.patientRef,
      period: { start: def.start, end: def.end }
    });
    this.groundTruth.encounters.push({
      text: def.typeText,
      expected: def.visitType,
      class: def.class,
      id: resource.id
    });
    this.registerEncounter(resource.id, def.month, def.class, def.typeText);
    return resource;
  }

  observation(def) {
    const entry = this.entry(def.ref);
    if (def.isBpPanel) {
      const systolic = this.entry("vital.sbp");
      const diastolic = this.entry("vital.dbp");
      const dropCode = this.rng() < (def.codelessRate ?? this.spec.messyRate);
      const concept = dropCode ? { text: "Blood pressure panel" } : codeableConcept(entry);
      const resource = this.push({
        resourceType: "Observation",
        id: this.nextId("obs"),
        status: "final",
        category: [
          {
            coding: [{ system: OBS_CATEGORY, code: "vital-signs", display: "Vital Signs" }],
            text: "Vital Signs"
          }
        ],
        code: concept,
        subject: this.patientRef,
        effectiveDateTime: def.date,
        encounter: def.encounterId ? { reference: `Encounter/${def.encounterId}` } : undefined,
        component: [
          {
            code: codeableConcept(systolic),
            valueQuantity: { value: def.sbpValue, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" }
          },
          {
            code: codeableConcept(diastolic),
            valueQuantity: { value: def.dbpValue, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" }
          }
        ]
      });
      this.groundTruth.observations.push({
        id: resource.id,
        text: concept.text ?? entry.display,
        coded: !dropCode,
        expected: "vital",
        month: def.month
      });
      if (!this.obsByMonth.has(def.month)) this.obsByMonth.set(def.month, []);
      this.obsByMonth.get(def.month).push(resource.id);
      return resource;
    }
    const categoryProfile =
      def.category === "laboratory" ? US_CORE.observationLab
      : def.category === "social-history" ? US_CORE.smokingStatus
      : undefined;
    const dropCode = !def.keepCode && this.rng() < (def.codelessRate ?? this.spec.messyRate);
    const concept = dropCode
      ? { text: def.text ?? entry.display }
      : codeableConcept(entry, def.text);
    const categories = [
      {
        coding: [{ system: OBS_CATEGORY, code: def.category, display: def.categoryDisplay }],
        text: def.categoryDisplay
      }
    ];
    const value = {
      valueQuantity: {
        value: def.value,
        unit: def.unit,
        system: "http://unitsofmeasure.org",
        code: def.unitCode ?? def.unit
      }
    };
    const resource = this.push({
      resourceType: "Observation",
      id: this.nextId("obs"),
      ...(categoryProfile ? { meta: { profile: [categoryProfile] } } : {}),
      status: "final",
      category: def.category === "social-history" ? undefined : categories,
      code: concept,
      subject: this.patientRef,
      effectiveDateTime: def.date,
      encounter: def.encounterId ? { reference: `Encounter/${def.encounterId}` } : undefined,
      ...(def.valueCodeableConcept ? { valueCodeableConcept: def.valueCodeableConcept } : value)
    });
    this.groundTruth.observations.push({
      id: resource.id,
      text: concept.text ?? entry.display,
      coded: !dropCode,
      expected: def.category === "vital-signs" ? "vital" : def.category === "laboratory" ? "lab" : "other",
      month: def.month
    });
    if (!this.obsByMonth.has(def.month)) this.obsByMonth.set(def.month, []);
    this.obsByMonth.get(def.month).push(resource.id);
    return resource;
  }

  procedure(def) {
    const entry = this.entry(def.ref);
    return this.push({
      resourceType: "Procedure",
      id: this.nextId("proc"),
      meta: { profile: [US_CORE.procedure] },
      status: "completed",
      code: codeableConcept(entry, def.text),
      subject: this.patientRef,
      performedPeriod: def.end ? { start: def.date, end: def.end } : undefined,
      performedDateTime: def.end ? undefined : def.date,
      encounter: def.encounterId ? { reference: `Encounter/${def.encounterId}` } : undefined
    });
  }

  immunization(def) {
    const entry = this.entry(def.ref);
    return this.push({
      resourceType: "Immunization",
      id: this.nextId("imm"),
      meta: { profile: [US_CORE.immunization] },
      status: "completed",
      vaccineCode: codeableConcept(entry),
      patient: this.patientRef,
      occurrenceDateTime: def.date,
      primarySource: true
    });
  }

  allergy(def) {
    const entry = this.entry(def.ref);
    this.push({
      resourceType: "AllergyIntolerance",
      id: this.nextId("alg"),
      meta: { profile: [US_CORE.allergy] },
      clinicalStatus: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" }]
      },
      verificationStatus: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", code: "confirmed" }]
      },
      category: [def.allergyCategory],
      code: codeableConcept(entry),
      patient: this.patientRef,
      recordedDate: def.date
    });
    this.groundTruth.allergies.push({
      text: entry.display,
      expected: def.allergyExpected
    });
  }

  diagnosticReport(def) {
    return this.push({
      resourceType: "DiagnosticReport",
      id: this.nextId("rpt"),
      meta: { profile: [US_CORE.reportLab] },
      status: "final",
      category: [
        { coding: [{ system: OBS_CATEGORY, code: "laboratory", display: "Laboratory" }], text: "Laboratory" }
      ],
      code: { text: def.text },
      subject: this.patientRef,
      effectiveDateTime: def.date,
      encounter: def.encounterId ? { reference: `Encounter/${def.encounterId}` } : undefined,
      result: def.observationIds.map((id) => ({ reference: `Observation/${id}` }))
    });
  }

  // ---- longitudinal engine ------------------------------------------------
  runPanels() {
    const months = this.spec.months;
    for (const panel of this.spec.panels) {
      const every = panel.every ?? 1;
      for (let month = panel.from ?? 0; month < Math.min(panel.to ?? months, months); month += every) {
        const t = months <= 1 ? 0 : month / (months - 1);
        const seasonal = panel.seasonal ? Math.sin((month / 12) * 2 * Math.PI + (panel.phase ?? 0)) : 0;
        const value =
          lerp(panel.start, panel.end ?? panel.start, panel.drift === false ? 0 : t) +
          seasonal * (panel.seasonal ?? 0) +
          gauss(this.rng) * (panel.noise ?? 0);
        const clamped = panel.clamp ? Math.max(panel.clamp[0], Math.min(panel.clamp[1], value)) : value;
        if (panel.isBpPanel) {
          const dbpValue = lerp(panel.dbp[0], panel.dbp[1], t) + gauss(this.rng) * 5;
          this.observation({
            ref: panel.ref,
            isBpPanel: true,
            month,
            date: this.monthDate(month, panel.day),
            category: "vital-signs",
            categoryDisplay: "Vital Signs",
            sbpValue: rounded(clamped, 0),
            dbpValue: rounded(dbpValue, 0)
          });
          continue;
        }
        this.observation({
          ref: panel.ref,
          month,
          date: this.monthDate(month, panel.day),
          category: panel.category,
          categoryDisplay: panel.categoryDisplay,
          value: rounded(clamped, panel.decimals ?? 1),
          unit: panel.unit,
          unitCode: panel.unitCode,
          text: panel.text
        });
      }
    }
  }

  runSchedule() {
    const sched = this.spec.schedule ?? [];
    for (const item of sched) {
      switch (item.type) {
        case "condition":
          this.condition(item);
          break;
        case "med": {
          this.medicationRequest({
            ref: item.ref,
            date: this.monthDate(item.start),
            sig: item.sig,
            encounterId: item.encounterMonth !== undefined ? this.pickEncounter(item.encounterMonth) : undefined
          });
          if (item.stop !== undefined && !item.ongoing) {
            this.stoppedMedicationRequest(item.ref, null, this.monthDate(item.stop), item.sig);
          }
          break;
        }
        case "encounter":
          this.buildEncounter(item);
          break;
        case "procedure":
          this.procedure({
            ref: item.ref,
            date: this.monthDate(item.start, item.day),
            end: item.days ? iso(new Date(new Date(this.monthDate(item.start, item.day)).getTime() + item.days * 86400000)) : undefined,
            encounterId: item.encounterMonth !== undefined ? this.pickEncounter(item.encounterMonth) : undefined
          });
          break;
        case "immunization":
          this.immunization({
            ref: item.ref,
            date: this.monthDate(item.start, item.day ?? 20)
          });
          break;
        case "allergy":
          this.allergy({
            ref: item.ref,
            allergyCategory: item.allergyCategory,
            allergyExpected: item.allergyExpected,
            date: this.monthDate(item.start ?? 0)
          });
          break;
        default:
          throw new Error(`unknown schedule item type: ${item.type}`);
      }
    }
  }

  pickEncounter(month) {
    const ids = this.encounterByMonth.get(month);
    return ids && ids.length ? ids[ids.length - 1] : undefined;
  }

  buildEncounter(item) {
    const start = this.monthDate(item.start, item.day);
    const end = item.days
      ? iso(new Date(new Date(start).getTime() + item.days * 86400000))
      : start;
    const enc = this.encounter({
      class: item.class ?? "AMB",
      typeText: item.typeText,
      visitType: item.visitType,
      start,
      end,
      month: item.start
    });
    if (item.observations) {
      for (const obs of item.observations) {
        this.observation({
          ...obs,
          month: item.start,
          date: start,
          encounterId: enc.id,
          keepCode: true
        });
      }
    }
    if (item.meds) {
      for (const med of item.meds) {
        this.medicationRequest({
          ref: med.ref,
          date: start,
          sig: med.sig,
          encounterId: enc.id
        });
      }
    }
    if (item.procedures) {
      for (const proc of item.procedures) {
        this.procedure({
          ref: proc.ref,
          date: start,
          encounterId: enc.id,
          text: proc.text
        });
      }
    }
    if (item.diagnoses) {
      for (const dx of item.diagnoses) {
        this.condition({
          ...dx,
          encounterId: enc.id
        });
      }
    }
    if (item.report) {
      const ids = this.obsByMonth.get(item.start) ?? [];
      if (ids.length) {
        this.diagnosticReport({
          text: item.report,
          date: start,
          encounterId: enc.id,
          observationIds: ids.slice(-8)
        });
      }
    }
    return enc;
  }

  buildSmoking(status, months) {
    const entry = this.entry("social.smoking_status");
    this.push({
      resourceType: "Observation",
      id: this.nextId("obs"),
      meta: { profile: [US_CORE.smokingStatus] },
      status: "final",
      category: [
        {
          coding: [{ system: OBS_CATEGORY, code: "social-history", display: "Social History" }],
          text: "Social History"
        }
      ],
      code: codeableConcept(entry),
      subject: this.patientRef,
      effectiveDateTime: this.monthDate(0),
      valueCodeableConcept: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: status.code,
            display: status.display
          }
        ],
        text: status.display
      }
    });
    this.groundTruth.observations.push({
      id: "smoking",
      text: entry.display,
      coded: true,
      expected: "other",
      month: 0
    });
  }

  buildPractitioners() {
    const pres = this.spec.practitioners ?? [
      { npi: `1${String(this.spec.seed).padStart(9, "0")}`, family: "Primrose", given: ["Quinn"] }
    ];
    this.practitionerIds = [];
    for (const p of pres) {
      const id = `${this.spec.id}-pract-${p.family.toLowerCase()}`.slice(0, 64);
      this.practitionerIds.push(id);
      this.push({
        resourceType: "Practitioner",
        id,
        meta: { profile: ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-practitioner"] },
        identifier: [{ system: "http://hl7.org/fhir/sid/us-npi", value: p.npi }],
        name: [{ family: p.family, given: p.given }]
      });
    }
  }

  build() {
    this.buildPatient();
    this.buildPractitioners();
    if (this.spec.smoking) this.buildSmoking(this.spec.smoking);
    this.runSchedule();
    this.runPanels();
    return this;
  }

  toBundle() {
    return {
      resourceType: "Bundle",
      type: "transaction",
      entry: this.resources.map((resource) => ({
        fullUrl: `https://fhir4px.local/r4/${resource.resourceType}/${resource.id}`,
        resource,
        request: { method: "PUT", url: `${resource.resourceType}/${resource.id}` }
      }))
    };
  }

  counts() {
    const counts = {};
    for (const r of this.resources) counts[r.resourceType] = (counts[r.resourceType] ?? 0) + 1;
    return counts;
  }
}

async function main() {
  const raw = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
  const catalog = new Map(raw.entries.map((e) => [e.id, e]));
  const { PATIENTS } = await import("./chronic-cohort/patients.mjs");

  await mkdir(OUT_DIR, { recursive: true });
  const manifest = { generated: new Date().toISOString(), patients: [] };

  for (const spec of PATIENTS) {
    const builder = new PatientBuilder(spec, catalog).build();
    const bundle = builder.toBundle();
    const path = resolve(OUT_DIR, `${spec.id}.json`);
    await writeFile(path, JSON.stringify(bundle, null, 1) + "\n", "utf8");
    manifest.patients.push({
      id: spec.id,
      name: `${spec.given.join(" ")} ${spec.family}`,
      tier: spec.tier,
      focus: spec.focus,
      total: bundle.entry.length,
      counts: builder.counts(),
      groundTruth: builder.groundTruth
    });
    console.log(`${spec.id.padEnd(34)} ${String(bundle.entry.length).padStart(5)} entries`);
  }

  await writeFile(resolve(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n", "utf8");
  const total = manifest.patients.reduce((s, p) => s + p.total, 0);
  console.log(`\n${manifest.patients.length} patients, ${total} total resources -> ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
