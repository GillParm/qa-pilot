import { defineConfig } from "vitest/config";

// Three projects: offline unit tests; integration tests that drive the demo
// shop in a real browser with the scripted fake provider; and live tests that
// call a real model, skipped unless QA_PILOT_LIVE=1 and a key is set.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          globalSetup: ["test/integration/global-setup.ts"],
          testTimeout: 120_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "live",
          include: ["test/live/**/*.test.ts"],
          testTimeout: 300_000,
        },
      },
    ],
  },
});
