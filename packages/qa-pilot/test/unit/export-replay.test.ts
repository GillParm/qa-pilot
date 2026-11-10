import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent } from "../../src/agent/run.js";
import { exportRun } from "../../src/export/spec.js";
import { FakeProvider, fake } from "../../src/llm/fake.js";
import { startMiniApp } from "../helpers/mini-app.js";
import { generatedDir, runPlaywrightTest } from "../helpers/playwright-test.js";

// The point of export: a passing agent run becomes a test that passes again
// under `npx playwright test`, with no model and against a different server.
describe("an exported spec replays green with plain Playwright", () => {
  let recordApp: Awaited<ReturnType<typeof startMiniApp>>;
  let replayApp: Awaited<ReturnType<typeof startMiniApp>>;
  let outputDir: string;

  beforeAll(async () => {
    recordApp = await startMiniApp();
    replayApp = await startMiniApp();
    outputDir = await mkdtemp(path.join(tmpdir(), "qa-pilot-export-"));
  });
  afterAll(async () => {
    await recordApp.close();
    await replayApp.close();
    await rm(outputDir, { recursive: true, force: true });
  });

  it("records, exports and replays a cart flow", async () => {
    const provider = new FakeProvider([
      fake.click({ role: "button", name: "Add to cart" }, "Add the mug to the cart"),
      fake.assertText("Added to cart", "Confirm it was added"),
      fake.click({ role: "link", name: /^Cart/ }, "Open the cart"),
      fake.assertUrl("/cart", "Check the cart page opened"),
      fake.select({ role: "combobox", name: "Quantity" }, "3", "Set the quantity to 3"),
      fake.assertValue({ role: "combobox", name: "Quantity" }, "3", "Check the quantity"),
      fake.assertText("$54.00", "Check the total is $54.00"),
      fake.done("pass", "The total follows the quantity."),
    ]);
    const { record, runDir } = await runAgent({
      instruction: "Add the mug, open the cart, set quantity 3 and check the total",
      name: "Mini cart total",
      url: recordApp.url,
      provider,
      outputDir,
      video: false,
      report: false,
      limits: { actionTimeoutMs: 2_000 },
    });
    expect(record.verdict).toBe("pass");

    const dir = await generatedDir("export-replay");
    const { file, code } = await exportRun(runDir, dir);
    expect(path.basename(file)).toBe("mini-cart-total.spec.ts");
    expect(code).toContain(
      `page.getByRole("button", { name: "Add to cart", exact: true }).click()`,
    );

    // Replay against a second server on another port via QA_PILOT_BASE_URL.
    const result = await runPlaywrightTest(dir, file, { QA_PILOT_BASE_URL: replayApp.url });
    expect(result.output).toContain("1 passed");
    expect(result.code).toBe(0);
  });

  it("fails the replay when the app breaks the flow", async () => {
    const broken = await startMiniApp({ renamed: true });
    try {
      const dir = await generatedDir("export-replay");
      const result = await runPlaywrightTest(dir, "mini-cart-total.spec.ts", {
        QA_PILOT_BASE_URL: broken.url,
      });
      expect(result.code).not.toBe(0);
      expect(result.output).toContain("1 failed");
    } finally {
      await broken.close();
    }
  });
});
