import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent } from "../../src/agent/run.js";
import { exportSpec } from "../../src/export/spec.js";
import { createProvider } from "../../src/llm/index.js";
import { startMiniApp } from "../helpers/mini-app.js";

// Calls a real model, so it only runs with QA_PILOT_LIVE=1 and a key in the
// environment (or in the repository's .env). Pick the provider with
// QA_PILOT_LIVE_PROVIDER=anthropic|gemini.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));

const provider = process.env.QA_PILOT_LIVE_PROVIDER ?? "anthropic";
const keyVar = provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
const enabled = process.env.QA_PILOT_LIVE === "1" && Boolean(process.env[keyVar]);

describe.skipIf(!enabled)(`live model (${provider})`, () => {
  let app: Awaited<ReturnType<typeof startMiniApp>>;
  let outputDir: string;

  beforeAll(async () => {
    app = await startMiniApp();
    outputDir = await mkdtemp(path.join(tmpdir(), "qa-pilot-live-"));
  });
  afterAll(async () => {
    await app.close();
    await rm(outputDir, { recursive: true, force: true });
  });

  it("tests a small cart flow, passes, and exports a replayable spec", async () => {
    const { record } = await runAgent({
      instruction:
        "Add the trail mug to the cart, open the cart, set the quantity to 3 and check that the total is $54.00.",
      url: app.url,
      provider: createProvider({ provider }),
      outputDir,
      video: false,
      limits: { maxSteps: 12, maxCostUsd: 0.3 },
    });
    expect(record.verdict, record.summary).toBe("pass");
    expect(record.totals.costUsd).toBeLessThan(0.3);
    const code = exportSpec(record);
    expect(code).toContain('getByRole("button", { name: "Add to cart", exact: true })');
    expect(code).toContain("selectOption(");
  });
});
