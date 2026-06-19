/**
 * Browser-based accuracy test using Playwright's Chromium.
 * Tests the ACTUAL q8 model in the browser — same as production.
 *
 *   node scripts/test-embedding-browser.mjs
 *
 * Requires dev server running at http://localhost:3000
 */
import { chromium } from "playwright";

async function main() {
  console.log("Launching Chromium (headless)...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const allOutput = [];
  page.on("console", (msg) => {
    const text = msg.text();
    allOutput.push(text);
    console.log(text);
  });

  console.log("Navigating to embedding test page...");
  await page.goto("http://localhost:3000/embedding-test.html", {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });

  console.log("Waiting for test to complete (timeout 5 min)...\n");
  await page.waitForFunction(() => window.__testComplete === true, { timeout: 300000 })
    .catch(() => console.log("(timeout — check output above)"));

  await browser.close();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
