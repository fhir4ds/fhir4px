import { defineConfig, devices } from "@playwright/test";

// The port is overridable so the suite can target an already-running dev
// server when 3000 is taken (e.g. PLAYWRIGHT_PORT=46201).
const PORT = process.env.PLAYWRIGHT_PORT ?? "3000";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry"
  },
  webServer: {
    command: `npm run dev -- --host localhost --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
