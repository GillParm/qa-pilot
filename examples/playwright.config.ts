import { defineConfig } from "@playwright/test";

// Replays the specs that `qa-pilot export` wrote into ./specs. No model is involved.
// They target http://localhost:3200 unless QA_PILOT_BASE_URL points elsewhere:
//
//   QA_PILOT_BASE_URL=https://preview.example.com npx playwright test -c examples/playwright.config.ts
export default defineConfig({
  testDir: "./specs",
  workers: 1,
  reporter: process.env.CI ? "line" : "list",
  use: { trace: "retain-on-failure" },
});
