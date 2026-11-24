import { expect, test } from "@playwright/test";
import { FHIR_BASE_URL, loadSandboxFixture } from "./helpers/sandbox-fixture";

const RUN_SANDBOX_E2E = process.env.SMART_DEV_SANDBOX_E2E === "1";

/** Every CMS measure the app translates live (public/fhir4ds/measures/manifest.json). */
const MEASURE_IDS = ["CMS122", "CMS124", "CMS125", "CMS130", "CMS159", "CMS349", "CMS74", "CMS75"];

/**
 * The Quality and Cohorts areas run off the dataset evaluation that happens
 * when a patient loads, and all three pages share one connection chip.
 *
 * This is also the regression for CMS159 (card FHIR4-15): its translated SQL
 * failed to bind until translation started pre-calling translate_library, and
 * a wheel bump can bring that back. It needs the real engine, so it is
 * opt-in like the sandbox spec and takes a cold engine boot plus the
 * translations.
 *
 * On the Quality measures view an executed measure's row carries a
 * "measurement year" chip and a failed one a "failed" chip — so the row shape
 * tells execution apart from failure.
 */
test.describe("Quality and Cohorts", () => {
  test.skip(!RUN_SANDBOX_E2E, "Set SMART_DEV_SANDBOX_E2E=1 when the local Docker sandbox is running.");

  test("quality opens on care gaps, every CMS measure executes, cohorts are calculated on load", async ({ page }) => {
    test.setTimeout(300_000);
    const metadata = await fetch(`${FHIR_BASE_URL}/metadata`);
    expect(metadata.status).toBe(200);

    await loadSandboxFixture();

    await page.goto("/providers");
    await page.getByRole("button", { name: "Use sandbox" }).click();
    await expect(page).toHaveURL(/\/records$/);

    // Quality opens on its Care gaps view; the navigation offers both views.
    const navigation = page.getByRole("navigation", { name: "Main navigation" });
    await page.goto("/quality");
    await expect(page.getByRole("heading", { name: "Care gaps", exact: true })).toBeVisible();
    await expect(navigation.getByRole("button", { name: /^Care gaps/ })).toBeVisible();
    await expect(navigation.getByRole("button", { name: /^Quality measures/ })).toBeVisible();

    // The same connection chip the Records page shows, once the evaluation is done.
    await expect(page.getByText(/SMART Dev Sandbox · .* · \d+ records?/).first()).toBeVisible({ timeout: 180_000 });
    await expect(page.getByText(/From the CDC adult immunization schedule and the CMS quality measures/)).toBeVisible();

    // Nothing may end on an error branch: not the conformance checks, not a measure.
    await expect(page.getByText("failed", { exact: true })).toHaveCount(0);
    await expect(page.getByText("error", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Binder Error|TranslationError|ParseError/)).toHaveCount(0);

    // US Core data presence lives in the connection menu.
    await page.getByText(/SMART Dev Sandbox · .* · \d+ records?/).first().click();
    await expect(page.getByRole("button", { name: "US Core data presence" })).toContainText(/US Core data: \d+ of \d+ checks passed/);
    await page.getByRole("button", { name: "US Core data presence" }).click();
    await expect(page.getByRole("heading", { name: "US Core data presence" })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();

    // Quality measures: by default only the measures that apply, so list them all.
    await navigation.getByRole("button", { name: /^Quality measures/ }).click();
    await expect(page.getByRole("heading", { name: "Quality measures", exact: true })).toBeVisible();
    const showAll = page.getByRole("button", { name: /^Show all \d+$/ });
    await expect(showAll).toBeVisible({ timeout: 180_000 });
    await showAll.click();
    await expect(page.getByText("failed", { exact: true })).toHaveCount(0);

    for (const measureId of MEASURE_IDS) {
      const row = page.getByText(measureId, { exact: true }).locator("xpath=..");
      await expect(row).toBeVisible();
      await expect(row.getByText(/measurement year \d{4}/)).toBeVisible();
    }

    // Cohorts are calculated with the quality measures; there is no button to run them.
    await page.goto("/cohorts");
    await expect(page.getByRole("button", { name: /run cohort/i })).toHaveCount(0);
    await expect(page.getByText(/\d+ of 5 cohorts match this patient/)).toBeVisible({ timeout: 180_000 });
  });
});
