import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent } from "../../src/agent/run.js";
import { FakeProvider, fake } from "../../src/llm/fake.js";
import { LLMError } from "../../src/llm/types.js";
import type { RunRecord } from "../../src/types.js";
import { startMiniApp } from "../helpers/mini-app.js";

describe("runAgent with the fake provider", () => {
  let browser: Browser;
  let app: Awaited<ReturnType<typeof startMiniApp>>;
  let outputDir: string;

  beforeAll(async () => {
    browser = await chromium.launch();
    app = await startMiniApp();
    outputDir = await mkdtemp(path.join(tmpdir(), "qa-pilot-agent-"));
  });
  afterAll(async () => {
    await browser.close();
    await app.close();
    await rm(outputDir, { recursive: true, force: true });
  });

  const run = (provider: FakeProvider, extra: Partial<Parameters<typeof runAgent>[0]> = {}) =>
    runAgent({
      instruction: "Add the mug to the cart and check the total for three",
      url: app.url,
      provider,
      browser,
      outputDir,
      video: false,
      limits: { actionTimeoutMs: 1_500 },
      runToken: "qatest1",
      ...extra,
    });

  it("passes a full flow and records evidence for every step", async () => {
    const provider = new FakeProvider([
      fake.click({ role: "button", name: "Add to cart" }, "Add the mug to the cart"),
      fake.assertText("Added to cart", "Confirm it was added"),
      fake.click({ role: "link", name: /^Cart/ }, "Open the cart"),
      fake.assertUrl("/cart", "Check the cart page opened"),
      fake.select({ role: "combobox", name: "Quantity" }, "3", "Set quantity to 3"),
      fake.assertText("$54.00", "Check the total"),
      fake.done("pass", "Total updates to $54.00 for three mugs."),
    ]);
    const { record, runDir } = await run(provider);

    expect(record.verdict).toBe("pass");
    expect(record.summary).toBe("Total updates to $54.00 for three mugs.");
    expect(record.steps).toHaveLength(7);
    expect(record.steps.every((s) => s.outcome === "ok")).toBe(true);
    expect(record.steps[0]?.action).toEqual({
      type: "click",
      locator: { kind: "role", role: "button", name: "Add to cart", exact: true },
    });
    expect(record.steps[4]?.action).toEqual({
      type: "select",
      locator: { kind: "label", text: "Quantity", exact: true },
      option: "3",
    });
    expect(record.totals).toMatchObject({ steps: 7, llmCalls: 7, inputTokens: 7_000 });

    // Evidence: run.json on disk, a screenshot per step, console error and failed request captured.
    const saved = JSON.parse(await readFile(path.join(runDir, "run.json"), "utf8")) as RunRecord;
    expect(saved.id).toBe(record.id);
    const shots = await readdir(path.join(runDir, "steps"));
    expect(shots).toContain("00-start.png");
    expect(shots).toContain("07.png");
    expect(record.console.some((c) => c.text.includes("cart widget warning"))).toBe(true);
    expect(record.network.some((n) => n.url.endsWith("/api/missing") && n.status === 404)).toBe(
      true,
    );

    // Each model request carried the system prompt, the tools and the current snapshot.
    const first = provider.requests[0]!;
    expect(first.tools.map((t) => t.name)).toEqual([
      "click",
      "type",
      "select",
      "navigate",
      "assert",
      "done",
    ]);
    expect(first.messages[0]?.content).toContain("Run token: qatest1");
    expect(first.messages[0]?.content).toMatch(/button "Add to cart" \[ref=e\d+\]/);
    expect(provider.requests[3]?.messages[0]?.content).toContain("3. click link");
  });

  it("fails the run when an assertion does not hold", async () => {
    const provider = new FakeProvider([
      fake.click({ role: "button", name: "Add to cart" }),
      fake.assertText("Added to wishlist", "Check the wishlist message"),
    ]);
    const { record } = await run(provider);
    expect(record.verdict).toBe("fail");
    expect(record.summary).toMatch(/Assertion failed at step 2 \(Check the wishlist message\)/);
    expect(record.steps[1]?.outcome).toBe("failed");
  });

  it("feeds action errors back and lets the model recover", async () => {
    const provider = new FakeProvider([
      fake.click({ role: "button", name: "Checkout" }),
      fake.click({ role: "button", name: "Add to cart" }),
      fake.assertText("Added to cart"),
      fake.done("pass", "Recovered."),
    ]);
    const { record } = await run(provider);
    expect(record.verdict).toBe("pass");
    expect(record.steps[0]?.outcome).toBe("error");
    expect(provider.requests[1]?.messages[0]?.content).toContain("Step 1 could not be carried out");
  });

  it("rejects done(pass) before any assertion", async () => {
    const provider = new FakeProvider([
      fake.done("pass", "Looks fine."),
      fake.assertText("Trail mug"),
      fake.done("pass", "Verified."),
    ]);
    const { record } = await run(provider);
    expect(record.verdict).toBe("pass");
    expect(record.steps[0]?.error).toMatch(/before any assertion/);
  });

  it("nudges the model when it answers without a tool call", async () => {
    const provider = new FakeProvider([
      { text: "Let me think." },
      fake.assertText("Trail mug"),
      fake.done("pass", "ok"),
    ]);
    const { record } = await run(provider);
    expect(record.verdict).toBe("pass");
    expect(provider.requests[1]?.messages[0]?.content).toContain("did not call a tool");
  });

  it("stops at the step limit", async () => {
    const provider = new FakeProvider(
      Array.from({ length: 5 }, () => fake.assertText("Trail mug")),
    );
    const { record } = await run(provider, { limits: { maxSteps: 3, actionTimeoutMs: 1_500 } });
    expect(record.verdict).toBe("error");
    expect(record.stopReason).toBe("step limit reached (3 steps)");
    expect(record.steps).toHaveLength(3);
  });

  it("stops before crossing the cost limit", async () => {
    const turns = Array.from({ length: 6 }, () => ({
      ...(fake.assertText("Trail mug") as { tool: string; input: Record<string, unknown> }),
      usage: { inputTokens: 1_000_000, outputTokens: 0 },
    }));
    const provider = new FakeProvider(turns);
    const { record } = await run(provider, {
      prices: { fake: { input: 0.3, output: 0 } },
      limits: { maxCostUsd: 1, actionTimeoutMs: 1_500 },
    });
    expect(record.verdict).toBe("error");
    expect(record.stopReason).toMatch(/cost limit reached \(\$0\.90 spent, limit \$1\.00\)/);
    expect(record.totals.llmCalls).toBe(3);
  });

  it("retries retryable provider errors and records the attempts", async () => {
    const provider = new FakeProvider([
      { error: new LLMError("overloaded", { retryable: true, status: 529, retryAfterMs: 1 }) },
      fake.assertText("Trail mug"),
      fake.done("pass", "ok"),
    ]);
    const { record } = await run(provider, { limits: { llmRetries: 2, actionTimeoutMs: 1_500 } });
    expect(record.verdict).toBe("pass");
    expect(record.steps[0]?.llm?.attempts).toBe(2);
  });

  it("saves a video when recording is on", async () => {
    const provider = new FakeProvider([fake.assertText("Trail mug"), fake.done("pass", "ok")]);
    const { record, runDir } = await run(provider, { video: true });
    expect(record.video).toBe("video.webm");
    const files = await readdir(runDir);
    expect(files).toContain("video.webm");
    expect(files).not.toContain(".video");
  });

  it("ends with an error when the provider gives up", async () => {
    const provider = new FakeProvider([
      {
        error: new LLMError("the model declined the request (cyber)", {
          retryable: false,
          refusal: true,
        }),
      },
    ]);
    const { record } = await run(provider);
    expect(record.verdict).toBe("error");
    expect(record.stopReason).toContain("declined");
  });
});
