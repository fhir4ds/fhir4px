import { expect, test, type Page } from "@playwright/test";

async function refreshAll(page: Page) {
  await page.getByRole("button", { name: "Data" }).click();
  await page.getByRole("menuitem", { name: "Refresh all" }).click();
}

test("app shell loads without exposing credential fields", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "fhir4px" })).toBeVisible();
  await expect(page.getByText("Patient-friendly health records")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("EPIC_NON_PROD_TEST_USER1_PASS");
  await expect(page.locator("body")).not.toContainText("CERNER_TEST_USER1_PASS");
});

test("patient explorer renders in a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/records");
  await expect(page.getByRole("button", { name: "Data" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Medications/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("access_token");
});

test("local LLM playground exposes editable prompts and schema", async ({ page }) => {
  await page.goto("/llm-playground");
  await expect(page.getByRole("heading", { name: "Local LLM Playground" })).toBeVisible();
  await expect(page.getByLabel("Test case")).toBeVisible();
  await expect(page.getByRole("heading", { name: "System Prompt" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "User Payload" })).toBeVisible();
  await expect(page.locator("body")).toContainText("Lab Prompt Overrides");
  await expect(page.getByRole("heading", { name: "Response Schema" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run" })).toBeVisible();
  await expect(page.locator("body")).toContainText("Apply Overrides");
  await expect(page.locator("body")).toContainText("Clear Overrides");
  await expect(page.locator("body")).toContainText("Load From Case");
  await expect(page.locator("body")).toContainText("associations");
  await expect(page.locator("body")).toContainText(/INR \+ .*anticoagulant therapy/i);
});

test("patient explorer adds a type-specific local allergy record", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      get: () => true
    });
  });

  await page.goto("/records");
  await page.getByRole("button", { name: "Add record" }).click();
  await page.getByLabel("Record type").click();
  await page.getByRole("option", { name: "Allergy" }).click();
  await page.getByRole("textbox", { name: "Allergy" }).fill("Peanuts");
  await page.getByLabel("Criticality").click();
  await page.getByRole("option", { name: "High" }).click();
  await page.getByLabel("Reaction").fill("Hives");
  await page.getByRole("button", { name: "Add record" }).click();

  await page.getByRole("button", { name: "Add record" }).click();
  await page.getByRole("textbox", { name: "Allergy" }).fill("Shellfish");
  await page.getByLabel("Clinical status").click();
  await page.getByRole("option", { name: "Inactive" }).click();
  await page.getByRole("button", { name: "Add record" }).click();

  await expect(page.getByRole("tab", { name: /Allergies \(2\)/ })).toBeVisible();
  await page.getByRole("tab", { name: /Allergies \(2\)/ }).click();
  await expect(page.getByRole("button", { name: "Active allergies" })).toContainText("Active (1)");
  await expect(page.getByRole("button", { name: "All allergies" })).toContainText("All (2)");
  await expect(page.getByRole("heading", { name: "Peanuts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shellfish" })).toHaveCount(0);
  await page.getByRole("button", { name: "All allergies" }).click();
  await expect(page.getByRole("heading", { name: "Shellfish" })).toBeVisible();
  await page.getByRole("button", { name: /Peanuts Active Patient added/ }).click();
  await expect(page.getByText("Patient added").first()).toBeVisible();
  await expect(page.getByText(/high/i).first()).toBeVisible();
});

test("patient explorer shows patient profile, visits, procedures, and reports", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      get: () => true
    });
  });

  await page.goto("/records");
  await page.evaluate(async () => {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    const [{ getOrCreateSessionVaultKey }, { localVault }] = await Promise.all([
      dynamicImport("/src/lib/vault/keys.ts"),
      dynamicImport("/src/lib/vault/store.ts")
    ]);
    const key = await getOrCreateSessionVaultKey();
    const sourceId = "src-profile-expanded-records";
    const now = Date.now();
    const patient = {
      resourceType: "Patient",
      id: "patient-expanded",
      name: [{ use: "official", given: ["Jordan"], family: "Rivera" }],
      gender: "female",
      birthDate: "1984-02-03",
      address: [{ line: ["100 Main St"], city: "Chicago", state: "IL", postalCode: "60601" }],
      telecom: [{ system: "phone", use: "mobile", value: "312-555-1212" }]
    };
    const encounter = {
      resourceType: "Encounter",
      id: "enc-1",
      status: "finished",
      class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB", display: "Ambulatory" },
      type: [
        {
          text: "Annual wellness visit",
          coding: [{ system: "http://snomed.info/sct", code: "444971000124105", display: "Annual wellness visit" }]
        }
      ],
      period: { start: "2025-04-01T14:00:00Z", end: "2025-04-01T14:30:00Z" },
      serviceProvider: { display: "Lakeview Primary Care" }
    };
    const procedure = {
      resourceType: "Procedure",
      id: "proc-1",
      status: "completed",
      code: {
        text: "Electrocardiogram",
        coding: [{ system: "http://www.ama-assn.org/go/cpt", code: "93000", display: "Electrocardiogram" }]
      },
      performedDateTime: "2025-04-01T14:10:00Z"
    };
    const report = {
      resourceType: "DiagnosticReport",
      id: "report-1",
      status: "final",
      category: [{ text: "Laboratory" }],
      code: {
        text: "Comprehensive metabolic panel",
        coding: [{ system: "http://loinc.org", code: "24323-8", display: "Comprehensive metabolic panel" }]
      },
      effectiveDateTime: "2025-04-01T13:00:00Z",
      result: [{ reference: "Observation/glucose-1", display: "Glucose" }]
    };

    await localVault.clear();
    await localVault.putJson(
      key,
      { type: "smart-source", id: sourceId },
      {
        id: sourceId,
        displayName: "Expanded Portal",
        providerName: "Expanded Portal",
        patientName: "Jordan Rivera",
        fhirBaseUrl: "https://ehr.example.test/fhir",
        vendor: "epic",
        clientId: "mock-client-id",
        patientId: "patient-expanded",
        tokenRef: sourceId,
        sessionRef: sourceId,
        connectedAt: now,
        updatedAt: now,
        lastFetchedAt: now,
        recordCount: 4,
        status: "ready"
      }
    );
    await localVault.putJson(
      key,
      { type: "source-dataset", id: sourceId },
      {
        patient,
        resources: [patient, encounter, procedure, report],
        fetchedAt: now,
        vendor: "epic"
      }
    );
  });

  await refreshAll(page);
  await expect(page.getByRole("heading", { name: "Jordan Rivera" })).toBeVisible();
  await expect(page.getByText("Patient profile")).toBeVisible();
  await expect(page.getByText(/DOB 1984-02-03/)).toBeVisible();
  await expect(page.getByRole("tab", { name: /Visits \(1\)/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Procedures \(1\)/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Reports \(1\)/ })).toBeVisible();

  await page.getByRole("tab", { name: /Visits \(1\)/ }).click();
  await expect(page.getByRole("heading", { name: "Annual wellness visit" })).toBeVisible();
  await page.getByRole("tab", { name: /Procedures \(1\)/ }).click();
  await expect(page.getByRole("heading", { name: "Electrocardiogram" })).toBeVisible();
  await page.getByRole("tab", { name: /Reports \(1\)/ }).click();
  await expect(page.getByRole("heading", { name: "Comprehensive metabolic panel" })).toBeVisible();
});

test("patient explorer shows source vaccine records before WebLLM refinement", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      get: () => true
    });
  });

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, epic-client-id, accept, content-type"
  };

  await page.route("https://ehr.example.test/fhir/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    const url = new URL(route.request().url());
    const path = url.pathname.replace("/fhir/", "");
    const body =
      path === "Patient/patient-123"
        ? { resourceType: "Patient", id: "patient-123" }
        : path === "Immunization"
          ? {
              resourceType: "Bundle",
              entry: [
                {
                  resource: {
                    resourceType: "Immunization",
                    id: "dtap-1",
                    status: "completed",
                    vaccineCode: { text: "DTaP, 5 pertussis antigens" },
                    occurrenceDateTime: "2010-01-01"
                  }
                },
                {
                  resource: {
                    resourceType: "Immunization",
                    id: "dtap-2",
                    status: "completed",
                    vaccineCode: {
                      text: "Diphtheria, tetanus toxoids and acellular pertussis vaccine"
                    },
                    occurrenceDateTime: "2010-03-01"
                  }
                },
                {
                  resource: {
                    resourceType: "Immunization",
                    id: "mmr-1",
                    status: "completed",
                    vaccineCode: { text: "Measles, mumps and rubella virus vaccine" },
                    occurrenceDateTime: "2011-01-01"
                  }
                },
                {
                  resource: {
                    resourceType: "Immunization",
                    id: "mmr-2",
                    status: "completed",
                    vaccineCode: { text: "MMR II" },
                    occurrenceDateTime: "2015-01-01"
                  }
                }
              ]
            }
          : { resourceType: "Bundle", entry: [] };

    await route.fulfill({
      contentType: "application/fhir+json",
      headers: corsHeaders,
      body: JSON.stringify(body)
    });
  });

  await page.goto("/records");
  await page.evaluate(async () => {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    const [{ getOrCreateSessionVaultKey }, { localVault }] = await Promise.all([
      dynamicImport("/src/lib/vault/keys.ts"),
      dynamicImport("/src/lib/vault/store.ts")
    ]);
    const key = await getOrCreateSessionVaultKey();
    await localVault.clear();
    await localVault.putJson(
      key,
      { type: "smart-token", id: "current" },
      {
        accessToken: "mock-access-token",
        tokenType: "Bearer",
        expiresAt: Date.now() + 60_000,
        patientId: "patient-123",
        scope: "patient/Patient.read patient/Immunization.read"
      }
    );
    await localVault.putJson(
      key,
      { type: "smart-session", id: "current" },
      {
        fhirBaseUrl: "https://ehr.example.test/fhir",
        vendor: "epic",
        clientId: "mock-client-id"
      }
    );
  });

  await refreshAll(page);
  await expect(page.getByText(/ehr\.example\.test.*5 records/)).toBeVisible();
  await page.getByRole("tab", { name: /Vaccines \(4\)/ }).click();
  await expect(page.getByRole("button", { name: "Date view" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Grouped view" })).toBeEnabled();
  await page.getByRole("button", { name: "Compact density" }).click();
  await expect(page.getByRole("button", { name: "Compact density" })).toHaveAttribute("aria-pressed", "true");

  await expect(page.getByRole("heading", { name: "DTaP, 5 pertussis antigens" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Diphtheria, tetanus toxoids and acellular pertussis vaccine" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Measles, mumps and rubella virus vaccine" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "MMR II" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "DTaP", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "MMR", exact: true })).toHaveCount(0);
});

test("patient explorer accepts fenced JSON from local grouping model", async ({ page }) => {
  const consoleWarnings: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("Encountered two children with the same key")) consoleWarnings.push(text);
  });

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      get: () => false
    });
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {}
    });
  });

  await page.route("**/node_modules/.vite/deps/@mlc-ai_web-llm.js**", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        export async function CreateMLCEngine() {
          return {
            chat: {
              completions: {
                async create(input) {
                  const parsed = JSON.parse(input.messages[1].content);
                  const records = parsed.records || [parsed.record];
                  const items = records.map((record) => {
                    const sourceText = JSON.stringify(record.concept || {});
                    const label = sourceText.includes("MMR") ? "MMR" : "MMR";
                    return {
                      id: record.id,
                      patientFriendlyName: label,
                      confidence: 0.95,
                      fallback: false
                    };
                  });
                  const output = parsed.records ? { items } : items[0];
                  return {
                    choices: [{
                      message: {
                        content: String.fromCharCode(96, 96, 96) + "json\\n" + JSON.stringify(output) + "\\n" + String.fromCharCode(96, 96, 96)
                      }
                    }]
                  };
                }
              }
            }
          };
        }
      `
    });
  });

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, epic-client-id, accept, content-type"
  };

  await page.route("https://ehr.example.test/fhir/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    const url = new URL(route.request().url());
    const path = url.pathname.replace("/fhir/", "");
    const body =
      path === "Patient/patient-123"
        ? { resourceType: "Patient", id: "patient-123" }
        : path === "Immunization"
          ? {
              resourceType: "Bundle",
              entry: [
                {
                  resource: {
                    resourceType: "Immunization",
                    id: "mmr-1",
                    status: "completed",
                    vaccineCode: { text: "Measles, mumps and rubella virus vaccine" },
                    occurrenceDateTime: "2011-01-01"
                  }
                },
                {
                  resource: {
                    resourceType: "Immunization",
                    id: "mmr-2",
                    status: "completed",
                    vaccineCode: { text: "MMR II" },
                    occurrenceDateTime: "2015-01-01"
                  }
                }
              ]
            }
          : { resourceType: "Bundle", entry: [] };

    await route.fulfill({
      contentType: "application/fhir+json",
      headers: corsHeaders,
      body: JSON.stringify(body)
    });
  });

  await page.goto("/records");
  await page.evaluate(async () => {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    const [{ getOrCreateSessionVaultKey }, { localVault }] = await Promise.all([
      dynamicImport("/src/lib/vault/keys.ts"),
      dynamicImport("/src/lib/vault/store.ts")
    ]);
    const key = await getOrCreateSessionVaultKey();
    await localVault.clear();
    await localVault.putJson(
      key,
      { type: "smart-token", id: "current" },
      {
        accessToken: "mock-access-token",
        tokenType: "Bearer",
        expiresAt: Date.now() + 60_000,
        patientId: "patient-123",
        scope: "patient/Patient.read patient/Immunization.read"
      }
    );
    await localVault.putJson(
      key,
      { type: "smart-session", id: "current" },
      {
        fhirBaseUrl: "https://ehr.example.test/fhir",
        vendor: "epic",
        clientId: "mock-client-id"
      }
    );
  });

  await refreshAll(page);
  await page.getByRole("tab", { name: /Vaccines \(2\)/ }).click();
  await expect(page.getByRole("heading", { name: "MMR", exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("body")).not.toContainText("Unexpected token");
  await expect(page.locator("body")).not.toContainText("Local grouping model failed");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  expect(consoleWarnings).toEqual([]);
});

test("patient explorer renders completed local grouping batches before later batches finish", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      get: () => false
    });
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {}
    });
  });

  await page.route("**/node_modules/.vite/deps/@mlc-ai_web-llm.js**", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        let medicationBatchCount = 0;
        export async function CreateMLCEngine() {
          return {
            chat: {
              completions: {
                async create(input) {
                  const parsed = JSON.parse(input.messages[1].content);
                  const records = parsed.records || [parsed.record];
                  const isMedicationBatch = records.some((record) => record.resourceType === "MedicationRequest");
                  if (isMedicationBatch) medicationBatchCount += 1;
                  window.__FHIR4PX_PROGRESSIVE_BATCH_COUNT__ = medicationBatchCount;
                  if (isMedicationBatch && medicationBatchCount === 2) {
                    window.__FHIR4PX_EARLY_BATCH_RENDERED__ = document.body.textContent.includes("Early Medication");
                    if (!window.__FHIR4PX_EARLY_BATCH_RENDERED__) {
                      const end = Date.now() + 2000;
                      while (Date.now() < end) {}
                    }
                  }
                  const label = medicationBatchCount === 1 ? "Early Medication" : "Later Medication";
                  return {
                    choices: [{
                      message: {
                        content: JSON.stringify({
                          items: records.map((record) => ({
                            id: record.id,
                            patientFriendlyName: label,
                            confidence: 0.95,
                            fallback: false
                          }))
                        })
                      }
                    }]
                  };
                }
              }
            }
          };
        }
      `
    });
  });
  await page.route("**/terminology/patient-friendly/rxnorm.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: 1,
        system: "rxnorm",
        entries: {
          "860975": ["Lookup Metformin", "RXNORM", "ingredient"]
        }
      })
    });
  });

  await page.goto("/records");
  await page.evaluate(async () => {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    const [{ getOrCreateSessionVaultKey }, { localVault }] = await Promise.all([
      dynamicImport("/src/lib/vault/keys.ts"),
      dynamicImport("/src/lib/vault/store.ts")
    ]);
    const key = await getOrCreateSessionVaultKey();
    const sourceId = "src-progressive-local-model";
    const now = Date.now();
    const patient = { resourceType: "Patient", id: "patient-progressive" };
    const medications = Array.from({ length: 6 }, (_value, index) => ({
      resourceType: "MedicationRequest",
      id: `med-${index + 1}`,
      status: "active",
      authoredOn: `2024-01-${String(index + 1).padStart(2, "0")}`,
      medicationCodeableConcept: {
        text: `Medication ${index + 1} tablet`,
        coding: [
          {
            system: "http://www.nlm.nih.gov/research/umls/rxnorm",
            code: `progressive-${index + 1}`,
            display: `Medication ${index + 1} tablet`
          }
        ]
      }
    }));

    await localVault.clear();
    await localVault.putJson(
      key,
      { type: "smart-source", id: sourceId },
      {
        id: sourceId,
        displayName: "Progressive Test Portal",
        providerName: "Progressive Test Portal",
        fhirBaseUrl: "https://ehr.example.test/fhir",
        vendor: "epic",
        clientId: "mock-client-id",
        patientId: "patient-progressive",
        tokenRef: sourceId,
        sessionRef: sourceId,
        connectedAt: now,
        updatedAt: now,
        lastFetchedAt: now,
        recordCount: medications.length + 1,
        status: "ready"
      }
    );
    await localVault.putJson(
      key,
      { type: "source-dataset", id: sourceId },
      {
        patient,
        resources: [patient, ...medications],
        fetchedAt: now,
        vendor: "epic"
      }
    );
  });

  await refreshAll(page);
  await expect(page.getByRole("tab", { name: /Medications \(6\)/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Early Medication" })).toBeVisible({ timeout: 1500 });
  await expect
    .poll(() => page.evaluate(() => Boolean((window as any).__FHIR4PX_EARLY_BATCH_RENDERED__)))
    .toBe(true);
  await expect(page.getByRole("heading", { name: "Later Medication" })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});

test("patient explorer restores cached groupings without loading WebLLM", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      get: () => false
    });
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {}
    });
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { saveData: true }
    });
  });

  await page.route("**/node_modules/.vite/deps/@mlc-ai_web-llm.js**", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        window.__FHIR4PX_WEBLLM_IMPORTED__ = true;
        export async function CreateMLCEngine() {
          throw new Error("WebLLM should not load for cached groupings");
        }
      `
    });
  });

  await page.goto("/records");
  await page.evaluate(async () => {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    const [
      { getOrCreateSessionVaultKey },
      { localVault },
      { buildReferralSummary },
      { buildGroupableRecords, compactRecordsForModel },
      { GROUPING_CACHE_ID, emptyGroupingCache, upsertGroupingCacheEntries },
      { WEBLLM_GROUPING_MODEL }
    ] = await Promise.all([
      dynamicImport("/src/lib/vault/keys.ts"),
      dynamicImport("/src/lib/vault/store.ts"),
      dynamicImport("/src/lib/fhir/normalize.ts"),
      dynamicImport("/src/lib/fhir/patient-groups.ts"),
      dynamicImport("/src/lib/fhir/grouping-cache.ts"),
      dynamicImport("/src/lib/llm/webllm.ts")
    ]);
    const key = await getOrCreateSessionVaultKey();
    const sourceId = "src-cached-local-model";
    const now = Date.now();
    const patient = { resourceType: "Patient", id: "patient-cached" };
    const medications = [
      {
        resourceType: "MedicationRequest",
        id: "cached-med-1",
        status: "active",
        medicationCodeableConcept: {
          text: "Cached medication tablet",
          coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "860975" }]
        }
      }
    ];
    const summary = buildReferralSummary([patient, ...medications]);
    const sourceSummary = {
      ...summary,
      medications: summary.medications.map((medication: any) => ({
        ...medication,
        id: `${sourceId}:${medication.id}`,
        portalSourceId: sourceId,
        portalSourceName: "Cached Portal"
      }))
    };
    const compact = compactRecordsForModel(buildGroupableRecords(sourceSummary));
    const cache = upsertGroupingCacheEntries(
      emptyGroupingCache(now),
      compact.map((record: any) => ({
        compactRecordId: record.id,
        resourceType: record.resourceType,
        patientFriendlyName: "Cached Medication",
        confidence: 0.93,
        fallback: false,
        model: WEBLLM_GROUPING_MODEL,
        updatedAt: now
      })),
      now
    );

    await localVault.clear();
    await localVault.putJson(
      key,
      { type: "smart-source", id: sourceId },
      {
        id: sourceId,
        displayName: "Cached Portal",
        providerName: "Cached Portal",
        fhirBaseUrl: "https://ehr.example.test/fhir",
        vendor: "epic",
        clientId: "mock-client-id",
        patientId: "patient-cached",
        tokenRef: sourceId,
        sessionRef: sourceId,
        connectedAt: now,
        updatedAt: now,
        lastFetchedAt: now,
        recordCount: medications.length + 1,
        status: "ready"
      }
    );
    await localVault.putJson(
      key,
      { type: "source-dataset", id: sourceId },
      {
        patient,
        resources: [patient, ...medications],
        fetchedAt: now,
        vendor: "epic"
      }
    );
    await localVault.putJson(key, { type: "grouping-cache", id: GROUPING_CACHE_ID }, cache);
  });

  await refreshAll(page);
  await expect(page.getByRole("heading", { name: "Cached Medication" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lookup Metformin" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__FHIR4PX_WEBLLM_IMPORTED__))).toBe(false);
});

test("patient explorer seeds local model choices with patient-friendly lookup names", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      get: () => false
    });
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {}
    });
  });

  await page.route("**/terminology/patient-friendly/loinc.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: 1,
        system: "loinc",
        entries: {
          "2339-0": ["Lookup Glucose", "CHV", "broader"]
        }
      })
    });
  });

  await page.route("**/node_modules/.vite/deps/@mlc-ai_web-llm.js**", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        window.__FHIR4PX_WEBLLM_IMPORTED__ = true;
        window.__FHIR4PX_LAST_WEBLLM_NAMING_REQUESTS__ = [];
        export async function CreateMLCEngine() {
          return {
            chat: {
              completions: {
                async create(input) {
                  const parsed = JSON.parse(input.messages[1].content);
                  window.__FHIR4PX_LAST_WEBLLM_NAMING_REQUESTS__.push(parsed);
                  const records = parsed.records || [parsed.record];
                  const preferredName = Array.isArray(parsed.availableNames) && parsed.availableNames.includes("Lookup Glucose")
                    ? "Lookup Glucose"
                    : "Missing Lookup Seed";
                  const items = records.map((record) => ({
                    id: record.id,
                    patientFriendlyName: preferredName,
                    observationBucket: "labs",
                    confidence: 0.94,
                    fallback: false
                  }));
                  return {
                    choices: [{
                      message: {
                        content: JSON.stringify(parsed.records ? { items } : items[0])
                      }
                    }]
                  };
                }
              }
            }
          };
        }
      `
    });
  });

  await page.goto("/records");
  await page.evaluate(async () => {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    const [{ getOrCreateSessionVaultKey }, { localVault }] = await Promise.all([
      dynamicImport("/src/lib/vault/keys.ts"),
      dynamicImport("/src/lib/vault/store.ts")
    ]);
    const key = await getOrCreateSessionVaultKey();
    const sourceId = "src-lookup-seeded-model";
    const now = Date.now();
    const patient = { resourceType: "Patient", id: "patient-lookup-model" };
    const labCategory = [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "laboratory",
            display: "Laboratory"
          }
        ]
      }
    ];
    const codedObservation = {
      resourceType: "Observation",
      id: "glucose-coded",
      status: "final",
      category: labCategory,
      code: {
        coding: [{ system: "http://loinc.org", code: "2339-0", display: "Glucose [Mass/volume] in Blood" }],
        text: "Glucose"
      },
      effectiveDateTime: "2025-01-01T12:00:00Z",
      valueQuantity: { value: 101, unit: "mg/dL", system: "http://unitsofmeasure.org", code: "mg/dL" }
    };
    const uncodedObservation = {
      resourceType: "Observation",
      id: "glucose-uncoded",
      status: "final",
      category: labCategory,
      code: {
        text: "Blood glucose lab"
      },
      effectiveDateTime: "2025-02-01T12:00:00Z",
      valueQuantity: { value: 108, unit: "mg/dL", system: "http://unitsofmeasure.org", code: "mg/dL" }
    };

    await localVault.clear();
    await localVault.putJson(
      key,
      { type: "smart-source", id: sourceId },
      {
        id: sourceId,
        displayName: "Lookup Portal",
        providerName: "Lookup Portal",
        fhirBaseUrl: "https://ehr.example.test/fhir",
        vendor: "epic",
        clientId: "mock-client-id",
        patientId: "patient-lookup-model",
        tokenRef: sourceId,
        sessionRef: sourceId,
        connectedAt: now,
        updatedAt: now,
        lastFetchedAt: now,
        recordCount: 3,
        status: "ready"
      }
    );
    await localVault.putJson(
      key,
      { type: "source-dataset", id: sourceId },
      {
        patient,
        resources: [patient, codedObservation, uncodedObservation],
        fetchedAt: now,
        vendor: "epic"
      }
    );
  });

  await refreshAll(page);
  await page.getByRole("tab", { name: /Labs & Vitals \(2\)/ }).click();
  await expect(page.getByRole("heading", { name: "Lookup Glucose" })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Missing Lookup Seed" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__FHIR4PX_WEBLLM_IMPORTED__))).toBe(true);
  const namingRequests = await page.evaluate(() => (window as any).__FHIR4PX_LAST_WEBLLM_NAMING_REQUESTS__ ?? []);
  expect(namingRequests).toHaveLength(1);
  expect(namingRequests[0].availableNames).toContain("Lookup Glucose");
  const requestedRecords = namingRequests[0].records ?? [namingRequests[0].record];
  expect(requestedRecords).toHaveLength(1);
  expect(JSON.stringify(requestedRecords[0])).toContain("Blood glucose lab");
});

test("patient explorer filters observations and opens vitals details", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      get: () => false
    });
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {}
    });
  });

  await page.route("**/node_modules/.vite/deps/@mlc-ai_web-llm.js**", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        export async function CreateMLCEngine() {
          return {
            chat: {
              completions: {
                async create(input) {
                  const parsed = JSON.parse(input.messages[1].content);
                  const records = parsed.records || [parsed.record];
                  const items = records.map((record) => {
                    const sourceText = JSON.stringify(record || {});
                    let label = "Other Observation";
	                    if (sourceText.includes("8480-6") || sourceText.toLowerCase().includes("systolic")) label = "Systolic Blood Pressure";
	                    if (sourceText.includes("8302-2") || sourceText.toLowerCase().includes("body height")) label = "Height";
	                    if (sourceText.includes("4548-4") || sourceText.toLowerCase().includes("hemoglobin a1c")) label = "Hemoglobin A1c";
	                    if (sourceText.includes("72166-2") || sourceText.toLowerCase().includes("tobacco")) label = "Tobacco Smoking Status";
                    return {
                      id: record.id,
                      patientFriendlyName: label,
                      confidence: 0.94,
                      fallback: false
                    };
                  });
                  const output = parsed.records ? { items } : items[0];
                  return {
                    choices: [{
                      message: {
                        content: JSON.stringify(output)
                      }
                    }]
                  };
                }
              }
            }
          };
        }
      `
    });
  });

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, epic-client-id, accept, content-type"
  };

  await page.route("https://ehr.example.test/fhir/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    const url = new URL(route.request().url());
    const path = url.pathname.replace("/fhir/", "");
    const category = (code: string, display: string) => ({
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code, display }]
    });
    const code = (loinc: string, display: string) => ({
      coding: [{ system: "http://loinc.org", code: loinc, display }],
      text: display
    });
    const body =
      path === "Patient/patient-123"
        ? { resourceType: "Patient", id: "patient-123" }
        : path === "Observation"
          ? {
              resourceType: "Bundle",
              entry: [
                {
                  resource: {
                    resourceType: "Observation",
                    id: "systolic-1",
                    status: "final",
                    category: [category("vital-signs", "Vital Signs")],
                    code: code("8480-6", "Systolic blood pressure"),
                    effectiveDateTime: "2024-01-01T12:00:00Z",
                    valueQuantity: { value: 118, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" }
                  }
                },
                {
                  resource: {
                    resourceType: "Observation",
                    id: "systolic-2",
                    status: "final",
                    category: [category("vital-signs", "Vital Signs")],
                    code: code("8480-6", "Systolic blood pressure"),
                    effectiveDateTime: "2024-03-01T12:00:00Z",
                    valueQuantity: { value: 122, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" }
                  }
                },
                {
                  resource: {
                    resourceType: "Observation",
                    id: "height-1",
                    status: "final",
                    category: [category("vital-signs", "Vital Signs")],
                    code: code("8302-2", "Body height"),
                    effectiveDateTime: "2024-01-01T12:00:00Z",
                    valueQuantity: { value: 170, unit: "cm", system: "http://unitsofmeasure.org", code: "cm" }
                  }
                },
                {
                  resource: {
                    resourceType: "Observation",
                    id: "a1c-1",
                    status: "final",
                    category: [category("laboratory", "Laboratory")],
                    code: code("4548-4", "Hemoglobin A1c"),
                    effectiveDateTime: "2024-01-01T12:00:00Z",
                    valueQuantity: { value: 7.2, unit: "%", system: "http://unitsofmeasure.org", code: "%" }
                  }
                },
                {
                  resource: {
                    resourceType: "Observation",
                    id: "a1c-2",
                    status: "final",
                    category: [category("laboratory", "Laboratory")],
                    code: code("4548-4", "Hemoglobin A1c"),
                    effectiveDateTime: "2024-02-01T12:00:00Z",
                    valueQuantity: { value: 7.4, unit: "%", system: "http://unitsofmeasure.org", code: "%" }
                  }
                },
                {
                  resource: {
                    resourceType: "Observation",
                    id: "a1c-3",
                    status: "final",
                    category: [category("laboratory", "Laboratory")],
                    code: code("4548-4", "Hemoglobin A1c"),
                    effectiveDateTime: "2024-03-01T12:00:00Z",
                    valueQuantity: { value: 7.0, unit: "%", system: "http://unitsofmeasure.org", code: "%" }
                  }
                },
                {
                  resource: {
                    resourceType: "Observation",
                    id: "a1c-4",
                    status: "final",
                    category: [category("laboratory", "Laboratory")],
                    code: code("4548-4", "Hemoglobin A1c"),
                    effectiveDateTime: "2024-04-01T12:00:00Z",
                    valueQuantity: { value: 6.9, unit: "%", system: "http://unitsofmeasure.org", code: "%" }
                  }
                },
                {
                  resource: {
                    resourceType: "Observation",
                    id: "tobacco-1",
                    status: "final",
                    category: [category("social-history", "Social History")],
                    code: code("72166-2", "Tobacco smoking status"),
                    effectiveDateTime: "2024-02-15T12:00:00Z",
                    valueString: "Never smoker"
                  }
                }
              ]
            }
          : { resourceType: "Bundle", entry: [] };

    await route.fulfill({
      contentType: "application/fhir+json",
      headers: corsHeaders,
      body: JSON.stringify(body)
    });
  });

  await page.goto("/records");
  await page.evaluate(async () => {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    const [{ getOrCreateSessionVaultKey }, { localVault }] = await Promise.all([
      dynamicImport("/src/lib/vault/keys.ts"),
      dynamicImport("/src/lib/vault/store.ts")
    ]);
    const key = await getOrCreateSessionVaultKey();
    await localVault.clear();
    await localVault.putJson(
      key,
      { type: "smart-token", id: "current" },
      {
        accessToken: "mock-access-token",
        tokenType: "Bearer",
        expiresAt: Date.now() + 60_000,
        patientId: "patient-123",
        scope: "patient/Patient.read patient/Observation.read"
      }
    );
    await localVault.putJson(
      key,
      { type: "smart-session", id: "current" },
      {
        fhirBaseUrl: "https://ehr.example.test/fhir",
        vendor: "epic",
        clientId: "mock-client-id"
      }
    );
  });

  await refreshAll(page);
  await page.getByRole("tab", { name: /Labs & Vitals \(8\)/ }).click();

  await expect(page.getByRole("button", { name: "Labs" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Hemoglobin A1c").first()).toBeVisible();
  await expect(page.getByText("Systolic blood pressure")).toHaveCount(0);

  await page.getByRole("button", { name: "Vitals" }).click();
  await expect(page.getByText("Intravascular Systolic").first()).toBeVisible({ timeout: 10_000 });
  await page.locator('[role="button"]').filter({ hasText: "122 mmHg" }).first().click();
  await expect(page.getByRole("heading", { name: "Systolic blood pressure" })).toBeVisible();
  await expect(page.getByText("FHIR details")).toBeVisible();
  await expect(page.getByText("loinc:8480-6")).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();
  await expect(page.getByRole("heading", { name: "Intravascular Systolic" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Intravascular Systolic trend chart" })).toBeVisible();

  await page.getByRole("button", { name: "Labs" }).click();
  await expect(page.getByRole("heading", { name: "Hemoglobin A1c/Hemoglobin.Total" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Hemoglobin A1c/Hemoglobin.Total trend chart" })).toBeVisible();
  await expect(page.locator('[role="button"]').filter({ hasText: "Hemoglobin A1c" })).toHaveCount(3);
  await page.getByRole("button", { name: "Show all 4" }).click();
  await expect(page.locator('[role="button"]').filter({ hasText: "Hemoglobin A1c" })).toHaveCount(4);
  await page.getByRole("button", { name: "Show fewer" }).click();
  await expect(page.locator('[role="button"]').filter({ hasText: "Hemoglobin A1c" })).toHaveCount(3);

  await page.getByRole("button", { name: "Other" }).click();
  await expect(page.getByRole("heading", { name: "Tobacco Smoking Status" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Intravascular Systolic" })).toHaveCount(0);
});

test("patient explorer collapses duplicate observations across portals without hiding source details", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      configurable: true,
      get: () => false
    });
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {}
    });
  });

  await page.route("**/node_modules/.vite/deps/@mlc-ai_web-llm.js**", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: `
        export async function CreateMLCEngine() {
          return {
            chat: {
              completions: {
                async create(input) {
                  const parsed = JSON.parse(input.messages[1].content);
                  const records = parsed.records || [parsed.record];
                  const items = records.map((record) => {
                    const text = JSON.stringify(record || {}).toLowerCase();
                    return {
                      id: record.id,
                      patientFriendlyName: text.includes("8480-6") ? "Systolic Blood Pressure" : "Hemoglobin A1c",
                      confidence: 0.95,
                      fallback: false
                    };
                  });
                  return {
                    choices: [{
                      message: {
                        content: JSON.stringify(parsed.records ? { items } : items[0])
                      }
                    }]
                  };
                }
              }
            }
          };
        }
      `
    });
  });

  await page.goto("/records");
  await page.evaluate(async () => {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    const [{ getOrCreateSessionVaultKey }, { localVault }] = await Promise.all([
      dynamicImport("/src/lib/vault/keys.ts"),
      dynamicImport("/src/lib/vault/store.ts")
    ]);
    const key = await getOrCreateSessionVaultKey();
    const now = Date.now();
    const patient = { resourceType: "Patient", id: "patient-dedup-ui" };
    const category = (code: string, display: string) => ({
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code, display }]
    });
    const code = (loinc: string, display: string, localCode: string) => ({
      coding: [
        { system: "http://loinc.org", code: loinc, display },
        { system: "https://local.example.test/lab", code: localCode, display }
      ],
      text: display
    });
    const source = (id: string, name: string) => ({
      id,
      displayName: name,
      providerName: name,
      fhirBaseUrl: `https://${id}.example.test/fhir`,
      vendor: "epic",
      clientId: "mock-client-id",
      patientId: patient.id,
      tokenRef: id,
      sessionRef: id,
      connectedAt: now,
      updatedAt: now,
      lastFetchedAt: now,
      recordCount: 3,
      status: "ready"
    });

    const portalAResources = [
      patient,
      {
        resourceType: "Observation",
        id: "a1c-a",
        status: "final",
        category: [category("laboratory", "Laboratory")],
        code: code("4548-4", "Hemoglobin A1c", "a1c-panel-a"),
        effectiveDateTime: "2024-01-01T09:30:15Z",
        valueQuantity: { value: 7.2, unit: "%", system: "http://unitsofmeasure.org", code: "%" }
      },
      {
        resourceType: "Observation",
        id: "sbp-a",
        status: "final",
        category: [category("vital-signs", "Vital Signs")],
        code: code("8480-6", "Systolic blood pressure", "sbp-a"),
        effectiveDateTime: "2024-01-01T09:31:00Z",
        valueQuantity: { value: 118, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" }
      }
    ];
    const portalBResources = [
      patient,
      {
        resourceType: "Observation",
        id: "a1c-b",
        status: "final",
        category: [category("laboratory", "Laboratory")],
        code: code("4548-4", "HbA1c", "hgba1c-legacy"),
        effectiveDateTime: "2024-01-01T13:30:15Z",
        valueQuantity: { value: 7.2, unit: "%", system: "http://unitsofmeasure.org", code: "%" }
      },
      {
        resourceType: "Observation",
        id: "sbp-b",
        status: "final",
        category: [category("vital-signs", "Vital Signs")],
        code: code("8480-6", "Systolic blood pressure", "sbp-b"),
        effectiveDateTime: "2024-01-01T09:31:00Z",
        valueQuantity: { value: 126, unit: "mmHg", system: "http://unitsofmeasure.org", code: "mm[Hg]" }
      }
    ];

    await localVault.clear();
    await localVault.putJson(key, { type: "smart-source", id: "portal-a" }, source("portal-a", "Portal A"));
    await localVault.putJson(key, { type: "smart-source", id: "portal-b" }, source("portal-b", "Portal B"));
    await localVault.putJson(key, { type: "source-dataset", id: "portal-a" }, {
      patient,
      resources: portalAResources,
      fetchedAt: now,
      vendor: "epic"
    });
    await localVault.putJson(key, { type: "source-dataset", id: "portal-b" }, {
      patient,
      resources: portalBResources,
      fetchedAt: now,
      vendor: "epic"
    });
  });

  await refreshAll(page);
  await page.getByRole("tab", { name: /Labs & Vitals \(4\)/ }).click();

  await page.getByRole("button", { name: "Labs" }).click();
  await expect(page.getByRole("heading", { name: "Hemoglobin A1c/Hemoglobin.Total" })).toBeVisible();
  await expect(page.getByText("1 matching records collapsed")).toBeVisible();
  await page.locator('[role="button"]').filter({ hasText: /Also in Portal|matching records/ }).first().click();
  await expect(page.getByText("Matching records", { exact: true })).toBeVisible();
  await expect(page.getByText("Portal A").last()).toBeVisible();
  await expect(page.getByText("Portal B").last()).toBeVisible();
  await expect(page.getByText("Source FHIR").first()).toBeVisible();
  await page.getByRole("button", { name: "Close details" }).click();

  await page.getByRole("button", { name: "Vitals" }).click();
  await expect(page.getByRole("heading", { name: "Intravascular Systolic" })).toBeVisible();
  await expect(page.getByText("2 results").first()).toBeVisible();
  await expect(page.getByText("2 matching records collapsed")).toHaveCount(0);
});

test("Epic launch mimics the accepted fhir4ds sandbox request", async ({ page, context }) => {
  let authorizationRequestUrl: string | null = null;

  await page.route("**/.well-known/smart-configuration", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        authorization_endpoint: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize",
        token_endpoint: "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token"
      })
    });
  });
  await context.route("https://fhir.epic.com/interconnect-fhir-oauth/oauth2/authorize**", async (route) => {
    authorizationRequestUrl = route.request().url();
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Epic Auth Intercepted</title><main>Epic Auth Intercepted</main>"
    });
  });

  await page.goto("/providers");
  await expect(page.getByRole("heading", { name: "Epic Sandbox" })).toBeVisible();
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("button", { name: "Add portal" }).first().click();
  const popup = await popupPromise;
  await expect(popup.getByText("Epic Auth Intercepted")).toBeVisible();
  await expect(page).toHaveURL(/\/providers$/);

  expect(authorizationRequestUrl).not.toBeNull();
  const authorizationUrl = new URL(authorizationRequestUrl!);
  expect(authorizationUrl.searchParams.get("redirect_uri")).toBe("http://localhost:3000");
  expect(authorizationUrl.searchParams.get("aud")).toBe(
    "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4"
  );
  expect(authorizationUrl.searchParams.get("scope")).not.toContain("launch/patient");
  expect(authorizationUrl.searchParams.get("scope")).toContain("patient/Patient.read");
});

test("SMART Dev Sandbox is available from provider search as a local test session", async ({ page }) => {
  await page.goto("/providers");
  const sandboxCard = page
    .getByRole("heading", { name: "SMART Dev Sandbox" })
    .locator("xpath=ancestor::div[contains(@class, 'MuiCardContent-root')]");
  await expect(sandboxCard).toBeVisible();
  await expect(sandboxCard.getByText("Local test session")).toBeVisible();
  await sandboxCard.getByRole("button", { name: "Details for SMART Dev Sandbox" }).click();
  await expect(sandboxCard.getByText("http://localhost:4004/hapi-fhir-jpaserver/fhir")).toBeVisible();
  await expect(sandboxCard.getByLabel("Patient")).toBeVisible();
  await expect(sandboxCard.getByText(/Pat Explorer/)).toBeVisible();
  await sandboxCard.getByLabel("Patient").click();
  await expect(page.getByRole("option", { name: /Riley Cardiorenal/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Morgan Respiratory-Immune/ })).toBeVisible();
  await page.getByRole("option", { name: /Jordan Longitudinal/ }).click();
  await sandboxCard.getByRole("button", { name: "Use sandbox" }).click();
  await expect(page).toHaveURL(/\/records$/);
  await expect(page.getByRole("button", { name: "Data" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Medications/ })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
        const [{ getOrCreateSessionVaultKey }, { listConnectedSources }] = await Promise.all([
          dynamicImport("/src/lib/vault/keys.ts"),
          dynamicImport("/src/lib/smart/sources.ts")
        ]);
        const key = await getOrCreateSessionVaultKey();
        return (await listConnectedSources(key)).map((source: any) => source.patientId);
      })
    )
    .toContain("fhir4px-large-sandbox-patient");
});

test("grouping report loads the Jordan Longitudinal fixture and reports lookup coverage", async ({ page }) => {
  await page.goto("/grouping-report");
  await page.getByRole("button", { name: "Load Jordan fixture" }).click();
  await expect(page.getByText("Jordan Longitudinal fixture loaded")).toBeVisible();
  await expect(page.getByText("MedicationRequest: 11")).toBeVisible();
  await expect(page.getByText("Condition: 3")).toBeVisible();
  await expect(page.getByText("Observation: 425")).toBeVisible();
  await expect(page.getByText("Immunization: 5")).toBeVisible();

  await page.getByLabel("Report mode").click();
  await page.getByRole("option", { name: "Lookup only" }).click();
  await page.getByRole("button", { name: "Run model report" }).click();
  await expect(page.getByText("Grouping report generated")).toBeVisible({ timeout: 15_000 });

  const report = await page.evaluate(() => (window as any).__FHIR4PX_GROUPING_REPORT__);
  const observationSection = report.sections.find((section: any) => section.resourceType === "Observation");
  const medicationSection = report.sections.find((section: any) => section.resourceType === "MedicationRequest");
  const observationLookupNames = JSON.stringify(observationSection.lookupHits);
  const medicationLookupNames = JSON.stringify(medicationSection.lookupHits);

  expect(report.mode).toBe("lookup-only");
  expect(observationSection.lookupHitCount).toBeGreaterThanOrEqual(19);
  expect(observationLookupNames).toContain("Glucose");
  expect(observationLookupNames).toContain("Hemoglobin A1c/Hemoglobin.Total");
  expect(observationLookupNames).toContain("25-Hydroxyvitamin D3+25-Hydroxyvitamin D2");
  expect(medicationLookupNames).toContain("Albuterol Inhalant Product");
  expect(medicationLookupNames).not.toContain("Hydroxychloroquine");
});

test("Cerner launch reaches a SMART authorization request", async ({ page, context }) => {
  let authorizationRequestUrl: string | null = null;

  await page.route("**/.well-known/smart-configuration", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        authorization_endpoint: "https://authorization.cerner.example.test/authorize",
        token_endpoint: "https://authorization.cerner.example.test/token"
      })
    });
  });
  await context.route("https://authorization.cerner.example.test/authorize**", async (route) => {
    authorizationRequestUrl = route.request().url();
    await route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Cerner Auth Intercepted</title><main>Cerner Auth Intercepted</main>"
    });
  });

  await page.goto("/providers");
  await page.getByLabel("Provider, organization, or specialty").fill("Cerner");
  const cernerCard = page
    .getByRole("heading", { name: "Cerner Sandbox" })
    .locator("xpath=ancestor::div[contains(@class, 'MuiCardContent-root')]");
  await expect(cernerCard).toBeVisible();
  const popupPromise = context.waitForEvent("page");
  await cernerCard.getByRole("button", { name: "Add portal" }).click();
  const popup = await popupPromise;
  await expect(popup.getByText("Cerner Auth Intercepted")).toBeVisible();
  await expect(page).toHaveURL(/\/providers$/);

  expect(authorizationRequestUrl).not.toBeNull();
  const authorizationUrl = new URL(authorizationRequestUrl!);
  expect(authorizationUrl.searchParams.get("redirect_uri")).toBe("http://localhost:3000");
  expect(authorizationUrl.searchParams.get("scope")).toContain("launch/patient");
  expect(authorizationUrl.searchParams.get("scope")).toContain("patient/Patient.read");
});

test("provider search reads the public directory artifact without enabling unregistered endpoints", async ({ page }) => {
  await page.route("**/directory-public/chicago-directory.json**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          npi: "1234567890",
          displayName: "JANE SMITH",
          providerType: "individual",
          specialty: "Cardiology",
          specialtyTerms: "cardiology,heart doctor",
          zip5: "60611",
          state: "IL",
          lat: 41.89,
          lon: -87.62,
          endpointOptions: [
            {
              accessBrand: "Northwestern Medicine",
              fhirBaseUrl: "https://epic.example.test/FHIR/R4",
              confidence: 0.9,
              matchMethod: "location_match",
              evidence: "Synthetic test record",
              evidencePathClass: "practice_location_endpoint",
              pathSummary: "Provider practice location matched an EHR location tied to this access brand."
            }
          ]
        }
      ])
    });
  });

  await page.goto("/providers");
  await page.getByLabel("Provider, organization, or specialty").fill("cardiology");

  await expect(page.getByText("JANE SMITH")).toBeVisible();
  await expect(page.getByText("Northwestern Medicine")).toBeVisible();
  await expect(page.getByText("Source: Practice location")).toBeVisible();
  await expect(page.getByText("Registration needed before launch")).toBeVisible();
  await page.getByRole("button", { name: "This is my portal" }).click();
  await expect(page.getByRole("heading", { name: "Selected portals" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registration needed" })).toBeDisabled();
});

test("SMART callback exchanges the authorization code only once", async ({ page }) => {
  let tokenRequestCount = 0;

  await page.route("https://ehr.example.test/token", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "content-type"
        }
      });
      return;
    }

    tokenRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: {
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        access_token: "mock-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        patient: "patient-123",
        scope: "patient/Patient.read"
      })
    });
  });

  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem(
      "fhir4px_smart_state",
      JSON.stringify({
        codeVerifier: "mock-code-verifier",
        state: "mock-state",
        fhirBaseUrl: "https://ehr.example.test/fhir",
        vendor: "epic",
        clientId: "mock-client-id",
        tokenEndpoint: "https://ehr.example.test/token",
        redirectUri: "http://localhost:3000",
        expiresAt: Date.now() + 60_000
      })
    );
  });

  await page.goto("/?code=mock-code&state=mock-state");
  await expect(page).toHaveURL(/\/records$/);
  expect(tokenRequestCount).toBe(1);

  const cacheSnapshot = await page.evaluate(async () => {
    const names = await caches.keys();
    const bodies: string[] = [];
    for (const name of names) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      for (const request of requests) {
        const response = await cache.match(request);
        if (response) bodies.push(await response.clone().text().catch(() => ""));
      }
    }
    return { names, bodies: bodies.join("\n") };
  });
  expect(JSON.stringify(cacheSnapshot)).not.toContain("mock-access-token");
  expect(JSON.stringify(cacheSnapshot)).not.toContain("patient-123");
});
