import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_BASE_URL = "http://localhost:4004/hapi-fhir-jpaserver/fhir";
const DEFAULT_FIXTURES = [
  "tests/fixtures/fhir/smart-dev-sandbox-patient-r4.json",
  "tests/fixtures/fhir/large-patient-r4.json",
  "tests/fixtures/fhir/large-cardiorenal-patient-r4.json",
  "tests/fixtures/fhir/large-respiratory-immune-patient-r4.json"
];
const TRANSACTION_BATCH_SIZE = 25;
const PATIENT_RESOURCE_TYPES = [
  "MedicationRequest",
  "AllergyIntolerance",
  "Condition",
  "Observation",
  "DiagnosticReport",
  "Encounter",
  "Procedure",
  "Immunization"
];

const baseUrl = (process.env.FHIR_BASE_URL || process.argv[2] || DEFAULT_BASE_URL).replace(/\/$/, "");
const fixtureInputs = (process.env.FHIR_FIXTURES || process.env.FHIR_FIXTURE || process.argv[3] || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const fixturePaths = (fixtureInputs.length ? fixtureInputs : DEFAULT_FIXTURES).map((fixture) =>
  resolve(process.cwd(), fixture)
);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fhirFetch(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/fhir+json",
      "Content-Type": "application/fhir+json",
      ...init.headers
    }
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`FHIR ${init.method || "GET"} ${path} failed (${response.status}): ${body.slice(0, 1000)}`);
  }
  return body ? JSON.parse(body) : null;
}

async function countPatientResources(resourceType, patientId) {
  return fhirFetch(
    `/${resourceType}?patient=${encodeURIComponent(patientId)}&_summary=count&_cacheBuster=${Date.now()}`
  );
}

async function countPatientResourcesWhenIndexed(resourceType, patientId, expected) {
  let latest;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    latest = await countPatientResources(resourceType, patientId);
    if ((latest.total ?? 0) >= expected) return latest;
    await sleep(500);
  }
  return latest;
}

async function fetchPatientResourceIds(resourceType, patientId) {
  const resourceIds = [];
  let url = `/${resourceType}?patient=${encodeURIComponent(patientId)}&_count=100`;
  let pages = 0;

  while (url && pages < 20) {
    const bundle = await fhirFetch(url);
    resourceIds.push(
      ...((bundle.entry ?? [])
        .map((entry) => entry.resource?.id)
        .filter(Boolean)
        .map((id) => ({ resourceType, id })))
    );
    url = bundle.link?.find((link) => link.relation === "next")?.url;
    if (url?.startsWith(baseUrl)) url = url.slice(baseUrl.length);
    pages += 1;
  }

  return resourceIds;
}

async function purgePatientResources(patientId) {
  const resourceIds = (
    await Promise.all(PATIENT_RESOURCE_TYPES.map((resourceType) => fetchPatientResourceIds(resourceType, patientId)))
  ).flat();
  if (resourceIds.length === 0) return 0;

  const deleteEntries = resourceIds.map(({ resourceType, id }) => ({
    request: {
      method: "DELETE",
      url: `${resourceType}/${id}`
    }
  }));

  await postTransactionEntries(deleteEntries);
  return resourceIds.length;
}

async function postTransactionEntries(entries) {
  for (let index = 0; index < entries.length; index += TRANSACTION_BATCH_SIZE) {
    await fhirFetch("", {
      method: "POST",
      body: JSON.stringify({
        resourceType: "Bundle",
        type: "transaction",
        entry: entries.slice(index, index + TRANSACTION_BATCH_SIZE)
      })
    });
  }
}

const results = [];

for (const fixturePath of fixturePaths) {
  const bundle = await readJson(fixturePath);
  if (bundle.resourceType !== "Bundle" || bundle.type !== "transaction") {
    throw new Error(`Expected a FHIR R4 transaction Bundle in ${fixturePath}`);
  }
  const patientId =
    bundle.entry?.find((entry) => entry.resource?.resourceType === "Patient")?.resource?.id ??
    "fhir4px-sandbox-patient";

  const purged = process.env.SKIP_PURGE === "1" ? 0 : await purgePatientResources(patientId);
  const expectedCounts = Object.fromEntries(
    PATIENT_RESOURCE_TYPES.map((resourceType) => [
      resourceType,
      (bundle.entry ?? []).filter((entry) => entry.resource?.resourceType === resourceType).length
    ])
  );

  await postTransactionEntries(bundle.entry ?? []);

  const patient = await fhirFetch(`/Patient/${encodeURIComponent(patientId)}`);
  const [medications, conditions, observations, reports, encounters, immunizations] = await Promise.all([
    countPatientResourcesWhenIndexed("MedicationRequest", patientId, expectedCounts.MedicationRequest ?? 0),
    countPatientResourcesWhenIndexed("Condition", patientId, expectedCounts.Condition ?? 0),
    countPatientResourcesWhenIndexed("Observation", patientId, expectedCounts.Observation ?? 0),
    countPatientResourcesWhenIndexed("DiagnosticReport", patientId, expectedCounts.DiagnosticReport ?? 0),
    countPatientResourcesWhenIndexed("Encounter", patientId, expectedCounts.Encounter ?? 0),
    countPatientResourcesWhenIndexed("Immunization", patientId, expectedCounts.Immunization ?? 0)
  ]);

  results.push({
    fixture: fixturePath,
    purged,
    patient: `${patient.resourceType}/${patient.id}`,
    counts: {
      medicationRequests: medications.total ?? 0,
      conditions: conditions.total ?? 0,
      observations: observations.total ?? 0,
      diagnosticReports: reports.total ?? 0,
      encounters: encounters.total ?? 0,
      immunizations: immunizations.total ?? 0
    }
  });
}

console.log(JSON.stringify({ baseUrl, loaded: results }, null, 2));
