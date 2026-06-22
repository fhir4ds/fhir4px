/**
 * Test the Epic SMART callback flow.
 * Simulates: connect to Epic sandbox → login → redirect back → save connection.
 *
 * Requires dev server running at http://localhost:3000
 */
import { chromium } from "playwright";

async function main() {
  console.log("Launching Chromium...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  const consoleMsgs = [];

  page.on("console", (msg) => {
    const text = msg.text();
    consoleMsgs.push({ type: msg.type(), text });
    if (msg.type() === "error") {
      errors.push(text);
      console.log(`  [CONSOLE ERROR] ${text}`);
    }
  });

  page.on("pageerror", (err) => {
    errors.push(err.message);
    console.log(`  [PAGE ERROR] ${err.message}`);
  });

  page.on("requestfailed", (req) => {
    console.log(`  [REQ FAILED] ${req.url()} - ${req.failure()?.errorText}`);
  });

  console.log("Navigating to http://localhost:3000...");
  await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

  // Check what providers are available
  console.log("\nChecking for Epic Sandbox provider...");
  const pageText = await page.textContent("body");
  const hasEpic = pageText?.includes("Epic") || pageText?.includes("epic");
  console.log(`  Epic mentioned on page: ${hasEpic}`);

  // Take a screenshot of the landing page
  await page.screenshot({ path: "/tmp/epic-test-landing.png" });
  console.log("  Screenshot: /tmp/epic-test-landing.png");

  // Try to navigate to providers page
  console.log("\nNavigating to /providers...");
  await page.goto("http://localhost:3000/providers", { waitUntil: "networkidle" });
  await page.screenshot({ path: "/tmp/epic-test-providers.png" });

  // Check for provider buttons
  const buttons = await page.$$eval("button", (els) =>
    els.map((e) => e.textContent?.trim()).filter(Boolean)
  );
  console.log("  Buttons found:", buttons);

  // Look for Epic Sandbox specifically
  const epicButton = await page.$("button:has-text('Epic')");
  if (epicButton) {
    console.log("  Found Epic button. Clicking...");

    // Set up a popup handler
    const popupPromise = page.waitForEvent("popup", { timeout: 10000 }).catch(() => null);

    await epicButton.click();
    console.log("  Clicked. Waiting for popup or redirect...");

    const popup = await popupPromise;
    if (popup) {
      console.log("  Popup opened. URL:", popup.url());

      // Wait a bit and check the popup state
      await popup.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      console.log("  Popup URL after load:", popup.url());

      const popupText = await popup.textContent("body").catch(() => "(no body)");
      console.log("  Popup text (first 200):", popupText?.slice(0, 200));

      await popup.screenshot({ path: "/tmp/epic-test-popup.png" });
    } else {
      console.log("  No popup. Checking if page navigated...");
      console.log("  Current URL:", page.url());
    }
  } else {
    // Maybe it's a local test session flow
    const sandboxButton = await page.$("button:has-text('Sandbox')");
    if (sandboxButton) {
      console.log("  Found Sandbox button instead");
    }

    // Check if there's a test patient dropdown
    const selects = await page.$$eval("select", (els) =>
      els.map((e) => ({ id: e.id, options: Array.from(e.options).map((o) => o.textContent) }))
    );
    console.log("  Selects:", JSON.stringify(selects, null, 2));
  }

  // Wait a bit and capture any delayed errors
  console.log("\nWaiting 5s for delayed errors...");
  await page.waitForTimeout(5000);

  // Check localStorage and IndexedDB for quota issues
  const storageInfo = await page.evaluate(() => {
    let lsSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) lsSize += (localStorage.getItem(key) || "").length;
    }
    return {
      localStorageKeys: localStorage.length,
      localStorageBytes: lsSize,
      sessionStorageKeys: sessionStorage.length,
      origin: window.location.origin
    };
  });
  console.log("\nStorage info:", JSON.stringify(storageInfo, null, 2));

  // Check for QuotaExceededError specifically
  const quotaErrors = errors.filter((e) =>
    e.includes("QuotaExceeded") || e.includes("quota") || e.includes("exceeded")
  );
  console.log("\n=== RESULTS ===");
  console.log(`Total errors: ${errors.length}`);
  console.log(`Quota errors: ${quotaErrors.length}`);
  if (quotaErrors.length > 0) {
    console.log("Quota error details:", quotaErrors);
  }
  if (errors.length > 0 && quotaErrors.length === 0) {
    console.log("Other errors:", errors.slice(0, 5));
  }

  // Print relevant console messages
  const fhir4pxLogs = consoleMsgs.filter((m) => m.text.includes("fhir4px"));
  if (fhir4pxLogs.length > 0) {
    console.log("\nFhir4px log events:");
    fhir4pxLogs.forEach((m) => console.log(`  [${m.type}] ${m.text.slice(0, 200)}`));
  }

  await browser.close();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
