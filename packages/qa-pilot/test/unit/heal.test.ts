import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { healSpec } from "../../src/heal/heal.js";
import { FakeProvider, fake } from "../../src/llm/fake.js";
import { startMiniApp } from "../helpers/mini-app.js";
import { generatedDir, runPlaywrightTest } from "../helpers/playwright-test.js";

const SPEC = `// Exported by qa-pilot 0.1.0 from run 20261110-000000-mini.
// qa-pilot: {"generator":"qa-pilot","version":"0.1.0","run":"20261110-000000-mini","instruction":"Add the mug to the cart and check the cart count","startUrl":"http://127.0.0.1:1/","model":"fake/fake"}
import { expect, test } from "@playwright/test";

const BASE_URL = process.env.QA_PILOT_BASE_URL ?? "http://127.0.0.1:1";

test("Mini add to cart", async ({ page }) => {
  await page.goto(new URL("/", BASE_URL).toString());

  await test.step("Add the mug to the cart", async () => {
    await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  });

  await test.step("Check the cart count", async () => {
    await expect(page.getByText("Cart (1)")).toBeVisible();
  });
});
`;

describe("healSpec", () => {
  let browser: Browser;
  let renamed: Awaited<ReturnType<typeof startMiniApp>>;
  let original: Awaited<ReturnType<typeof startMiniApp>>;
  let dir: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    renamed = await startMiniApp({ renamed: true });
    original = await startMiniApp();
    dir = await generatedDir("heal");
  });
  afterAll(async () => {
    await browser.close();
    await renamed.close();
    await original.close();
  });

  async function specFile(name: string) {
    const file = path.join(dir, name);
    await writeFile(file, SPEC);
    return file;
  }

  const limits = { actionTimeoutMs: 1_500 };

  it("reports nothing to heal when the spec still passes", async () => {
    const file = await specFile("passing.spec.ts");
    const provider = new FakeProvider([]);
    const result = await healSpec({
      specFile: file,
      baseUrl: original.url,
      provider,
      browser,
      limits,
    });
    expect(result.status).toBe("passed");
    expect(result.diff).toBe("");
    expect(provider.requests).toHaveLength(0);
  });

  it("repairs a renamed button, shows a diff and leaves the file alone without --write", async () => {
    const file = await specFile("renamed.spec.ts");
    const provider = new FakeProvider([
      fake.propose(
        { role: "button", name: "Add to bag" },
        "The add button was renamed to Add to bag.",
      ),
    ]);
    const events: string[] = [];
    const result = await healSpec({
      specFile: file,
      baseUrl: renamed.url,
      provider,
      browser,
      limits,
      onEvent: (e) => events.push(e.type),
    });

    expect(result.status).toBe("healed");
    expect(result.changes).toEqual([
      {
        line: 11,
        stepTitle: "Add the mug to the cart",
        before: 'page.getByRole("button", { name: "Add to cart", exact: true })',
        after: 'page.getByRole("button", { name: "Add to bag", exact: true })',
        reasoning: "The add button was renamed to Add to bag.",
      },
    ]);
    expect(result.diff).toContain(
      '-    await page.getByRole("button", { name: "Add to cart", exact: true }).click();',
    );
    expect(result.diff).toContain(
      '+    await page.getByRole("button", { name: "Add to bag", exact: true }).click();',
    );
    expect(events).toEqual(["step", "broken", "proposal", "step", "verify"]);
    expect(result.written).toBe(false);
    expect(await readFile(file, "utf8")).toBe(SPEC);

    // The heal prompt carried the step intent, the old locator and the snapshot.
    const prompt = provider.requests[0]!.messages[0]!.content;
    expect(prompt).toContain("Broken step: Add the mug to the cart");
    expect(prompt).toContain(
      'Old locator: page.getByRole("button", { name: "Add to cart", exact: true })',
    );
    expect(prompt).toMatch(/button "Add to bag" \[ref=e\d+\]/);
    expect(provider.requests[0]!.tools.map((t) => t.name)).toEqual(["propose_locator", "give_up"]);
  });

  it("writes the healed spec with write: true, and it runs green under playwright test", async () => {
    const file = await specFile("written.spec.ts");
    const provider = new FakeProvider([fake.propose({ role: "button", name: "Add to bag" })]);
    const result = await healSpec({
      specFile: file,
      baseUrl: renamed.url,
      provider,
      browser,
      limits,
      write: true,
    });
    expect(result.written).toBe(true);
    expect(await readFile(file, "utf8")).toContain('name: "Add to bag"');

    const run = await runPlaywrightTest(dir, file, { QA_PILOT_BASE_URL: renamed.url });
    expect(run.output).toContain("1 passed");
  });

  it("retries when a proposal does not work, then gives up cleanly", async () => {
    const file = await specFile("give-up.spec.ts");
    const provider = new FakeProvider([
      fake.propose({ role: "heading", name: "Nothing here" }),
      { tool: "give_up", input: { reasoning: "No button adds the mug to the cart." } },
    ]);
    const result = await healSpec({
      specFile: file,
      baseUrl: renamed.url,
      provider,
      browser,
      limits,
    });
    expect(result.status).toBe("failed");
    expect(result.failure?.message).toMatch(/model gave up: No button adds the mug/);
    expect(provider.requests[1]!.messages[0]!.content).toContain(
      "Previous proposal: ref e-missing",
    );
  });

  it("does not heal failed assertions", async () => {
    const file = path.join(dir, "assert.spec.ts");
    await writeFile(file, SPEC.replace('page.getByText("Cart (1)")', 'page.getByText("Cart (9)")'));
    const provider = new FakeProvider([]);
    const result = await healSpec({
      specFile: file,
      baseUrl: original.url,
      provider,
      browser,
      limits,
    });
    expect(result.status).toBe("failed");
    expect(result.failure?.message).toMatch(/Assertions are not healed/);
    expect(provider.requests).toHaveLength(0);
  });
});
