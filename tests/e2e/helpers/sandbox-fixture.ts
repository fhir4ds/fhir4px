/**
 * Shared e2e helper: load a repo FHIR fixture for the SMART Dev Sandbox
 * patient into the local HAPI R4 server (tests/e2e/smart-dev-sandbox.spec.ts
 * and tests/e2e/quality-measures.spec.ts both start from a known dataset).
 *
 * Requires the local Docker sandbox (build/test-harness/smart-dev-sandbox);
 * callers gate their specs on SMART_DEV_SANDBOX_E2E=1.
 */

import { expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const FHIR_BASE_URL = "http://localhost:4004/hapi-fhir-jpaserver/fhir";
const FHIR_BASE_PATH = new URL(FHIR_BASE_URL).pathname;

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

async function fhirGet(path: string) {
  const response = await fetch(`${FHIR_BASE_URL}${path}`, {
    headers: {
      Accept: "application/fhir+json"
    }
  });
  expect(response.ok).toBe(true);
  return response.json();
}

async function purgeSandboxPatientResources(patientId: string) {
  const deleteEntries: Array<{ request: { method: string; url: string } }> = [];

  for (const resourceType of PATIENT_RESOURCE_TYPES) {
    let nextUrl: string | null = `/${resourceType}?patient=${encodeURIComponent(patientId)}&_count=100`;
    let pages = 0;
    while (nextUrl && pages < 20) {
      const bundle = await fhirGet(nextUrl);
      for (const entry of bundle.entry ?? []) {
        if (entry.resource?.id) {
          deleteEntries.push({
            request: {
              method: "DELETE",
              url: `${resourceType}/${entry.resource.id}`
            }
          });
        }
      }
      const nextLink = bundle.link?.find((link: { relation?: string; url?: string }) => link.relation === "next")?.url;
      if (!nextLink) {
        nextUrl = null;
      } else {
        // HAPI builds next-links on its container-internal origin (port 8080,
        // the R2 server on this host), so keep only the path and query and
        // request them from FHIR_BASE_URL.
        const next = new URL(nextLink);
        nextUrl = `${next.pathname}${next.search}`.slice(FHIR_BASE_PATH.length);
      }
      pages += 1;
    }
  }

  if (deleteEntries.length === 0) return;

  await postTransactionEntries(deleteEntries);
}

async function postTransactionEntries(entries: Array<{ request: { method: string; url: string }; resource?: unknown }>) {
  for (let index = 0; index < entries.length; index += TRANSACTION_BATCH_SIZE) {
    const response = await fetch(FHIR_BASE_URL, {
      method: "POST",
      headers: {
        Accept: "application/fhir+json",
        "Content-Type": "application/fhir+json"
      },
      body: JSON.stringify({
        resourceType: "Bundle",
        type: "transaction",
        entry: entries.slice(index, index + TRANSACTION_BATCH_SIZE)
      })
    });
    expect(response.ok).toBe(true);
  }
}

export async function loadSandboxFixture(fixtureName = "smart-dev-sandbox-patient-r4.json") {
  const fixture = JSON.parse(await readFile(resolve(process.cwd(), "tests/fixtures/fhir", fixtureName), "utf8")) as {
    entry?: Array<{ request: { method: string; url: string }; resource?: unknown }>;
  };
  const patientId =
    (fixture.entry?.find((entry) => (entry.resource as { resourceType?: string })?.resourceType === "Patient")
      ?.resource as { id?: string } | undefined)?.id ?? "fhir4px-sandbox-patient";
  await purgeSandboxPatientResources(patientId);
  await postTransactionEntries(fixture.entry ?? []);
}
