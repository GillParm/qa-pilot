import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { runAgent } from "../../src/agent/run.js";
import { exportRun } from "../../src/export/spec.js";
import { healSpec } from "../../src/heal/heal.js";
import { FakeProvider, fake, type FakeTurn } from "../../src/llm/fake.js";
import { generatedDir, runPlaywrightTest } from "../helpers/playwright-test.js";

// The fake provider plays the part of the model; everything else is real:
// the Next.js demo shop, Chromium, locator resolution, export and healing.

const bugsOn = inject("demoBugsOn");
const bugsOff = inject("demoBugsOff");
const renamed = inject("demoRenamed");

const cartTotalScript = (): FakeTurn[] => [
  fake.click({ role: "button", name: "Add to cart" }, "Add the trail mug to the cart"),
  fake.assertText("Added to cart", "Check the mug was added"),
  fake.click({ role: "link", name: /^Cart/ }, "Open the cart"),
  fake.select({ role: "combobox", name: "Quantity for Trail mug" }, "3", "Set the quantity to 3"),
  fake.assertText("Order total $54.00", "Check the order total is $54.00"),
  fake.done("pass", "The order total follows the quantity."),
];

const signupScript = (token: string): FakeTurn[] => [
  fake.type({ role: "textbox", name: "Name" }, "Ada", "Enter the name"),
  fake.type(
    { role: "textbox", name: "Email" },
    `ada+${token}@example.com`,
    "Enter an email with a plus",
  ),
  fake.type({ role: "textbox", name: "Password" }, "correct horse", "Enter a password"),
  fake.click({ role: "button", name: "Create account" }, "Create the account"),
  fake.assertText("Welcome, Ada", "Check the welcome message"),
  fake.done("pass", "Sign-up accepts an email with a plus sign."),
];

describe("demo shop with the fake provider", () => {
  let browser: Browser;
  let outputDir: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    outputDir = await mkdtemp(path.join(tmpdir(), "qa-pilot-demo-"));
  });
  afterAll(async () => {
    await browser.close();
    await rm(outputDir, { recursive: true, force: true });
  });

  const run = (
    base: string,
    pathname: string,
    turns: FakeTurn[],
    name: string,
    runToken?: string,
  ) =>
    runAgent({
      instruction: name,
      name,
      url: `${base}${pathname}`,
      provider: new FakeProvider(turns),
      browser,
      outputDir,
      video: false,
      limits: { actionTimeoutMs: 4_000 },
      ...(runToken ? { runToken } : {}),
    });

  describe("seeded bug 1: the order total ignores quantity changes", () => {
    it("passes with bugs off", async () => {
      const { record } = await run(
        bugsOff,
        "/products/trail-mug",
        cartTotalScript(),
        "Cart total off",
      );
      expect(record.verdict).toBe("pass");
      expect(record.steps[3]?.action).toEqual({
        type: "select",
        locator: { kind: "label", text: "Quantity for Trail mug", exact: true },
        option: "3",
      });
    });

    it("fails at the total with bugs on", async () => {
      const { record } = await run(
        bugsOn,
        "/products/trail-mug",
        cartTotalScript(),
        "Cart total on",
      );
      expect(record.verdict).toBe("fail");
      expect(record.summary).toMatch(
        /Check the order total is \$54\.00.*"Order total \$54\.00" was not visible/,
      );
    });
  });

  describe("seeded bug 2: sign-up rejects emails with a plus", () => {
    it("passes with bugs off", async () => {
      const token = `qa${Date.now().toString(36)}`;
      const { record } = await run(bugsOff, "/signup", signupScript(token), "Signup off", token);
      expect(record.verdict).toBe("pass");
    });

    it("fails with bugs on, and the evidence shows the error", async () => {
      const token = `qa${Date.now().toString(36)}b`;
      const { record, runDir } = await run(
        bugsOn,
        "/signup",
        signupScript(token),
        "Signup on",
        token,
      );
      expect(record.verdict).toBe("fail");
      expect(record.steps.at(-1)?.intent).toBe("Check the welcome message");
      const report = await readFile(path.join(runDir, "report.html"), "utf8");
      expect(report).toContain("Failed");
    });
  });

  describe("export and heal", () => {
    let specDir: string;
    let cartSpec: string;

    beforeAll(async () => {
      specDir = await generatedDir("demo-shop");
      const { record, runDir } = await run(
        bugsOff,
        "/products/trail-mug",
        cartTotalScript(),
        "Demo cart total",
      );
      expect(record.verdict).toBe("pass");
      cartSpec = (await exportRun(runDir, specDir)).file;
    });

    it("the exported cart spec passes with bugs off and catches bug 1 with bugs on", async () => {
      const off = await runPlaywrightTest(specDir, cartSpec, { QA_PILOT_BASE_URL: bugsOff });
      expect(off.output).toContain("1 passed");
      const on = await runPlaywrightTest(specDir, cartSpec, { QA_PILOT_BASE_URL: bugsOn });
      expect(on.code).not.toBe(0);
      expect(on.output).toContain("Order total $54.00");
    });

    it("the exported sign-up spec uses a fresh email on every replay", async () => {
      const token = `qa${Date.now().toString(36)}x`;
      const { runDir } = await run(bugsOff, "/signup", signupScript(token), "Demo signup", token);
      const { file, code } = await exportRun(runDir, specDir);
      expect(code).toContain("fill(`ada+${RUN}@example.com`)");
      // Twice in a row: a fixed email would hit "An account with this email already exists."
      for (let i = 0; i < 2; i++) {
        const replay = await runPlaywrightTest(specDir, file, { QA_PILOT_BASE_URL: bugsOff });
        expect(replay.output).toContain("1 passed");
      }
    });

    it("heals the renamed add button and the healed spec passes", async () => {
      const healed = path.join(specDir, "demo-cart-total-healed.spec.ts");
      await import("node:fs/promises").then((fs) => fs.copyFile(cartSpec, healed));
      const broken = await runPlaywrightTest(specDir, healed, { QA_PILOT_BASE_URL: renamed });
      expect(broken.code).not.toBe(0);

      const result = await healSpec({
        specFile: healed,
        baseUrl: renamed,
        provider: new FakeProvider([fake.propose({ role: "button", name: "Add to bag" })]),
        browser,
        write: true,
        limits: { actionTimeoutMs: 4_000 },
      });
      expect(result.status).toBe("healed");
      expect(result.diff).toContain(
        '+    await page.getByRole("button", { name: "Add to bag", exact: true }).click();',
      );

      const fixed = await runPlaywrightTest(specDir, healed, { QA_PILOT_BASE_URL: renamed });
      expect(fixed.output).toContain("1 passed");
    });
  });
});
