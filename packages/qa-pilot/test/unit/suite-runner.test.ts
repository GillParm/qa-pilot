import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeProvider, fake } from "../../src/llm/fake.js";
import { parseSuite } from "../../src/suite/config.js";
import { cell, renderSuiteMarkdown } from "../../src/suite/markdown.js";
import { runSuite, summarize, type TestResult } from "../../src/suite/runner.js";
import { startMiniApp } from "../helpers/mini-app.js";

const suiteYaml = `
name: Mini shop
tests:
  - name: Adding updates the badge
    path: /
    instruction: Add the mug to the cart and check the cart shows 1 item.
    tags: [cart]
  - name: Known wishlist gap
    path: /
    instruction: Add the mug to the wishlist.
    expect: fail
    tags: [wishlist]
  - name: Total for three
    path: /cart
    instruction: Set quantity to 3 and check the total is $54.00.
    tags: [cart]
`;

describe("runSuite", () => {
  let app: Awaited<ReturnType<typeof startMiniApp>>;
  let outputDir: string;

  beforeAll(async () => {
    app = await startMiniApp();
    outputDir = await mkdtemp(path.join(tmpdir(), "qa-pilot-suite-"));
  });
  afterAll(async () => {
    await app.close();
    await rm(outputDir, { recursive: true, force: true });
  });

  it("runs each test, compares with expect and writes summaries", async () => {
    const provider = new FakeProvider([
      // Test 1: passes.
      fake.click({ role: "button", name: "Add to cart" }),
      fake.assertText("Cart (1)"),
      fake.done("pass", "Badge shows one item."),
      // Test 2: expected to fail, and does.
      fake.done("fail", "There is no wishlist button."),
      // Test 3: the total is wrong on purpose here, so it fails unexpectedly.
      fake.select({ role: "combobox", name: "Quantity" }, "3"),
      fake.assertText("$45.00", "Check the total"),
    ]);
    const ended: string[] = [];
    const { summary, suiteDir } = await runSuite({
      suite: parseSuite(suiteYaml),
      provider,
      baseUrl: app.url,
      outputDir,
      video: false,
      limits: { actionTimeoutMs: 1_500 },
      exportDir: path.join(outputDir, "specs"),
      onTestEnd: (r) => ended.push(`${r.name}: ${r.verdict}`),
    });

    expect(ended).toEqual([
      "Adding updates the badge: pass",
      "Known wishlist gap: fail",
      "Total for three: fail",
    ]);
    expect(summary.totals).toMatchObject({
      tests: 3,
      passed: 1,
      failed: 2,
      asExpected: 2,
      unexpected: 1,
    });
    expect(summary.ok).toBe(false);
    expect(summary.results[2]?.failedStep).toMatchObject({ index: 2, intent: "Check the total" });
    expect(summary.results[0]?.exported).toMatch(/adding-updates-the-badge\.spec\.ts$/);
    expect(summary.results[1]?.exported).toBeUndefined();

    const files = await readdir(suiteDir);
    expect(files).toEqual(expect.arrayContaining(["summary.json", "summary.md", "index.html"]));
    const md = await readFile(path.join(suiteDir, "summary.md"), "utf8");
    expect(md).toContain("**1 of 3 tests did not end as expected.**");
    const html = await readFile(path.join(suiteDir, "index.html"), "utf8");
    expect(html).toContain(`href="${summary.results[0]!.runDir}/report.html"`);
  });

  it("filters by tag and skips tests once the suite budget is spent", async () => {
    // Each call costs $0.20 at the price below; the suite may spend $0.15.
    const turns = [fake.assertText("Trail mug"), fake.done("pass", "ok")].map((t) => ({
      ...(t as { tool: string; input: Record<string, unknown> }),
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    }));
    const provider = new FakeProvider(turns);
    const { summary } = await runSuite({
      suite: parseSuite(suiteYaml),
      provider,
      baseUrl: app.url,
      outputDir,
      video: false,
      tags: ["cart"],
      maxSuiteCostUsd: 0.15,
      prices: { fake: { input: 0.2, output: 0 } },
      limits: { actionTimeoutMs: 1_500 },
    });
    expect(summary.results.map((r) => [r.name, r.verdict])).toEqual([
      ["Adding updates the badge", "error"],
      ["Total for three", "skipped"],
    ]);
    expect(summary.results[0]?.summary).toMatch(/cost limit reached/);
    expect(summary.results[1]?.summary).toMatch(/suite cost limit \(\$0\.15\)/);
    expect(summary.totals.costUsd).toBeCloseTo(0.2);
  });
});

describe("renderSuiteMarkdown", () => {
  const result = (over: Partial<TestResult>): TestResult => ({
    name: "Test",
    instruction: "Do it",
    tags: [],
    expect: "pass",
    startUrl: "http://x/",
    verdict: "pass",
    asExpected: true,
    summary: "Fine.",
    steps: 4,
    costUsd: 0.05,
    durationMs: 12_000,
    ...over,
  });

  it("renders a table, bolding unexpected results", () => {
    const summary = summarize(
      [
        result({ name: "Cart | total" }),
        result({
          name: "Sign-up",
          verdict: "fail",
          asExpected: false,
          summary: "Assertion failed\nat step 5",
        }),
      ],
      {
        name: "Demo shop",
        provider: "anthropic",
        model: "claude-opus-5-5",
        startedAt: "2026-11-10T00:00:00Z",
        finishedAt: "2026-11-10T00:01:00Z",
        durationMs: 60_000,
      },
    );
    const md = renderSuiteMarkdown(summary);
    expect(md).toContain("### qa-pilot: Demo shop");
    expect(md).toContain("**1 of 2 tests did not end as expected.** 1 passed, 1 failed.");
    expect(md).toContain("| Cart \\| total | pass | pass | 4 | $0.05 | Fine. |");
    expect(md).toContain("| Sign-up | pass | **fail** | 4 | $0.05 | Assertion failed at step 5 |");
  });

  it("escapes table cells", () => {
    expect(cell("a|b\nc <img>")).toBe("a\\|b c &lt;img>");
    expect(cell("x".repeat(300), 10)).toBe("xxxxxxxxx…");
  });
});
