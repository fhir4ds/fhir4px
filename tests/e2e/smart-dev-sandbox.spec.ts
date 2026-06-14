import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const FHIR_BASE_URL = "http://localhost:4004/hapi-fhir-jpaserver/fhir";
const RUN_SANDBOX_E2E = process.env.SMART_DEV_SANDBOX_E2E === "1";
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
  const deleteEntries: Array<{ request: { method: "DELETE"; url: string } }> = [];

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
      nextUrl = bundle.link?.find((link: { relation?: string; url?: string }) => link.relation === "next")?.url ?? null;
      if (nextUrl?.startsWith(FHIR_BASE_URL)) nextUrl = nextUrl.slice(FHIR_BASE_URL.length);
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

async function loadSandboxFixture(fixtureName = "smart-dev-sandbox-patient-r4.json") {
  const fixture = JSON.parse(await readFile(resolve(process.cwd(), "tests/fixtures/fhir", fixtureName), "utf8")) as {
    entry?: Array<{ request: { method: string; url: string }; resource?: unknown }>;
  };
  const patientId =
    (fixture.entry?.find((entry) => (entry.resource as { resourceType?: string })?.resourceType === "Patient")
      ?.resource as { id?: string } | undefined)?.id ?? "fhir4px-sandbox-patient";
  await purgeSandboxPatientResources(patientId);
  await postTransactionEntries(fixture.entry ?? []);
}

test.describe("SMART Dev Sandbox", () => {
  test.skip(!RUN_SANDBOX_E2E, "Set SMART_DEV_SANDBOX_E2E=1 when the local Docker sandbox is running.");

  test("records explorer fetches from local HAPI R4 and shows source vaccine records before refinement", async ({ page }) => {
    const metadata = await fetch(`${FHIR_BASE_URL}/metadata`);
    expect(metadata.status).toBe(200);

    await loadSandboxFixture();

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", {
        configurable: true,
        get: () => false
      });
      Object.defineProperty(navigator, "gpu", {
        configurable: true,
        value: {
          requestAdapter: async () => {
            throw new Error("Mock WebGPU unavailable");
          }
        }
      });
    });

    await page.goto("/providers");
    await expect(page.getByRole("heading", { name: "SMART Dev Sandbox" })).toBeVisible();
    await expect(page.getByText(FHIR_BASE_URL)).toBeVisible();
    await page.getByRole("button", { name: "Use sandbox" }).click();
    await expect(page).toHaveURL(/\/records$/);

    await page.getByRole("button", { name: "Refresh all" }).click();
    await expect(page.getByText(/Records (loaded|grouped locally)/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("View: source records")).toBeVisible();
    await page.getByRole("tab", { name: /Vaccines \(5\)/ }).click();

    await expect(page.getByText("Flu shot")).toBeVisible();
    await expect(page.getByText("DTaP, 5 pertussis antigens")).toBeVisible();
    await expect(page.getByText("Diphtheria, tetanus toxoids and acellular pertussis vaccine")).toBeVisible();
    await expect(page.getByText("MMR II")).toBeVisible();
    await expect(page.getByText("Measles, mumps and rubella virus vaccine")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Flu" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "DTaP" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "MMR" })).toHaveCount(0);
  });

  test("grouping report loads large sandbox data and resolves Medication references", async ({ page }) => {
    const metadata = await fetch(`${FHIR_BASE_URL}/metadata`);
    expect(metadata.status).toBe(200);

    await loadSandboxFixture("large-patient-r4.json");

    await page.goto("/grouping-report");
    await page.getByRole("button", { name: "Load sandbox records" }).click();
    await expect(page.getByText("Sandbox records loaded")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("MedicationRequest: 11")).toBeVisible();
    await expect(page.getByText("Condition: 3")).toBeVisible();
    await expect(page.getByText("Observation: 425")).toBeVisible();
    await expect(page.getByText("Immunization: 5")).toBeVisible();
    await expect(page.getByText("References fetched: 5")).toBeVisible();
  });
});
