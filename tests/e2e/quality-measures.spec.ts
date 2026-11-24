import { expect, test } from "@playwright/test";
import { FHIR_BASE_URL, loadSandboxFixture } from "./helpers/sandbox-fixture";

const RUN_SANDBOX_E2E = process.env.SMART_DEV_SANDBOX_E2E === "1";

/** Every CMS measure the app translates live (public/fhir4ds/measures/manifest.json). */
const MEASURE_IDS = ["CMS122", "CMS124", "CMS125", "CMS130", "CMS159", "CMS349", "CMS74", "CMS75"];

/**
 * Quality measures run through live CQL -> SQL translation in the browser.
 * This is the regression for CMS159 (card FHIR4-15): its translated SQL failed
 * to bind until translation started pre-calling translate_library, and a wheel
 * bump can bring that back. It needs the real engine, so it is opt-in like the
 * sandbox spec and takes a cold engine boot plus eight translations.
 *
 * On the Quality page an executed measure's row carries a "measurement year"
 * chip and a failed one a "failed" chip — so the row shape tells execution
 * apart from failure.
 */
test.describe("Quality measures", () => {
  test.skip(!RUN_SANDBOX_E2E, "Set SMART_DEV_SANDBOX_E2E=1 when the local Docker sandbox is running.");

  test("every CMS measure executes, CMS159 included", async ({ page }) => {
    test.setTimeout(240_000);
    const metadata = await fetch(`${FHIR_BASE_URL}/metadata`);
    expect(metadata.status).toBe(200);

    await loadSandboxFixture();

    await page.goto("/providers");
    await page.getByRole("button", { name: "Use sandbox" }).click();
    await expect(page).toHaveURL(/\/records$/);

    await page.goto("/quality");
    await expect(
      page.getByText(/Completed — \d+ conformance checks and \d+ measures over \d+ resources/)
    ).toBeVisible({ timeout: 180_000 });

    // Nothing may end on an error branch: not the conformance checks, not a measure.
    await expect(page.getByText("failed", { exact: true })).toHaveCount(0);
    await expect(page.getByText("error", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Binder Error|TranslationError|ParseError/)).toHaveCount(0);

    for (const measureId of MEASURE_IDS) {
      const row = page.getByText(measureId, { exact: true }).locator("xpath=..");
      await expect(row).toBeVisible();
      await expect(row.getByText(/measurement year \d{4}/)).toBeVisible();
    }
  });
});
