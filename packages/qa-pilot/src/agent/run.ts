import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { executeProposed, settle } from "../actions/execute.js";
import { ACTION_TOOLS, parseToolCall, ToolInputError } from "../actions/tools.js";
import { EvidenceRecorder } from "../evidence/recorder.js";
import { writeReport } from "../report/html.js";
import type { ModelPrice } from "../llm/pricing.js";
import { withRetries } from "../llm/retry.js";
import {
  LLMError,
  type ChatMessage,
  type LLMProvider,
  type ToolCallResponse,
} from "../llm/types.js";
import { captureSnapshot, type PageSnapshot } from "../snapshot/capture.js";
import type { LlmCallRecord, RunLimits, RunRecord, StepRecord, Verdict } from "../types.js";
import { playwrightVersion, VERSION } from "../version.js";
import { Budget, resolveLimits } from "./limits.js";
import {
  DONE_WITHOUT_ASSERT_FEEDBACK,
  NO_TOOL_FEEDBACK,
  renderStepPrompt,
  SYSTEM_PROMPT,
} from "./prompt.js";

export interface RunOptions {
  instruction: string;
  url: string;
  provider: LLMProvider;
  /** Name for the run folder and report; defaults to the instruction. */
  name?: string;
  limits?: Partial<RunLimits>;
  /** Parent folder for run folders. Default: ./qa-pilot-runs */
  outputDir?: string;
  headless?: boolean;
  viewport?: { width: number; height: number };
  video?: boolean;
  /** Reuse a browser (tests, suites). It is left open. */
  browser?: Browser;
  /** Price overrides, e.g. for a model missing from the table. */
  prices?: Record<string, ModelPrice>;
  /** Called after each step, for progress output. */
  onStep?: (step: StepRecord, run: { totals: RunRecord["totals"] }) => void;
  /** Called once the run folder exists. */
  onStart?: (runDir: string) => void;
  /** Write report.html next to run.json (default true). */
  report?: boolean;
  /** Hook to write extra artifacts once run.json and the report are written. */
  afterRun?: (record: RunRecord, runDir: string) => Promise<void>;
  /** Fixed run token (tests). */
  runToken?: string;
}

export interface RunResult {
  record: RunRecord;
  runDir: string;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

function newRunToken(): string {
  // Lowercase letters and digits only, so it is safe inside emails and usernames.
  return `qa${randomBytes(4).toString("hex").slice(0, 6)}`;
}

interface Decision {
  response?: ToolCallResponse;
  llm: LlmCallRecord;
  error?: string;
}

/**
 * The agent loop: snapshot → ask the model for one action → resolve and run
 * it → record evidence, until the model calls done, an assertion fails, or a
 * limit is hit.
 */
export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const limits = resolveLimits(opts.limits);
  const budget = new Budget(limits, opts.prices);
  const startedAt = new Date();
  const name = opts.name ?? opts.instruction;
  const runToken = opts.runToken ?? newRunToken();
  const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
  const headless = opts.headless ?? true;
  const recorder = await EvidenceRecorder.create(
    opts.outputDir ?? "qa-pilot-runs",
    name,
    startedAt,
  );
  opts.onStart?.(recorder.runDir);

  const steps: StepRecord[] = [];
  let verdict: Verdict = "error";
  let summary: string;
  let stopReason: string | undefined;
  let video: string | undefined;

  const abort = new AbortController();
  const runTimer = setTimeout(
    () => abort.abort(new Error("run timeout reached")),
    limits.runTimeoutMs,
  );

  let browser: Browser | undefined = opts.browser;
  const ownsBrowser = !browser;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  const videoDir = path.join(recorder.runDir, ".video");

  try {
    browser ??= await chromium.launch({ headless });
    context = await browser.newContext({
      viewport,
      ...(opts.video === false ? {} : { recordVideo: { dir: videoDir, size: viewport } }),
    });
    context.setDefaultTimeout(limits.actionTimeoutMs);
    page = await context.newPage();
    recorder.attach(page);

    await page.goto(opts.url, {
      waitUntil: "load",
      timeout: Math.max(limits.actionTimeoutMs, 30_000),
    });
    await settle(page);
    await recorder.screenshot(page, "00-start");

    let consecutiveErrors = 0;
    let assertionsPassed = 0;
    let feedback: string | undefined;

    for (;;) {
      const limitReason = budget.stopReasonBeforeStep();
      if (limitReason) {
        stopReason = limitReason;
        summary = `Stopped: ${limitReason}.`;
        break;
      }

      const index = steps.length + 1;
      const stepStarted = Date.now();
      const urlBefore = page.url();
      await settle(page);
      const snapshot = await captureSnapshot(page, { timeoutMs: limits.actionTimeoutMs });
      const evidence = recorder.drain();

      const decision = await decide(
        opts.provider,
        budget,
        {
          instruction: opts.instruction,
          startUrl: opts.url,
          runToken,
          stepNumber: index,
          maxSteps: limits.maxSteps,
          history: steps,
          snapshot,
          console: evidence.console,
          network: evidence.network,
          ...(feedback ? { feedback } : {}),
        },
        limits,
        abort.signal,
      );
      feedback = undefined;
      budget.countStep();

      const base = {
        index,
        urlBefore,
        startedAt: new Date(stepStarted).toISOString(),
        llm: decision.llm,
        console: evidence.console,
        network: evidence.network,
      };

      // The model could not be reached or refused: nothing more to do.
      if (!decision.response) {
        stopReason = decision.error ?? "model call failed";
        summary = `Stopped: ${stopReason}.`;
        steps.push(
          finishStep(base, {
            intent: "Ask the model for the next step",
            reasoning: "",
            proposed: { type: "done", status: "fail", summary: stopReason },
            outcome: "error",
            error: stopReason,
            urlAfter: page.url(),
            stepStarted,
          }),
        );
        break;
      }

      const call = decision.response.toolCall;
      let parsed: ReturnType<typeof parseToolCall> | undefined;
      let inputError: string | undefined;
      if (!call) {
        inputError = "the model replied without calling a tool";
        feedback = NO_TOOL_FEEDBACK;
      } else {
        try {
          parsed = parseToolCall(call.name, call.input);
        } catch (err) {
          inputError = err instanceof ToolInputError ? err.message : String(err);
          feedback = `Your last tool call was rejected: ${inputError}`;
        }
      }

      if (!parsed) {
        const step = finishStep(base, {
          intent: "Invalid model reply",
          reasoning: decision.response.text?.slice(0, 500) ?? "",
          proposed: { type: "done", status: "fail", summary: inputError ?? "invalid reply" },
          outcome: "error",
          error: inputError ?? "invalid reply",
          urlAfter: page.url(),
          stepStarted,
        });
        steps.push(step);
        opts.onStep?.(step, budget);
        if (++consecutiveErrors >= limits.maxConsecutiveErrors) {
          stopReason = `${consecutiveErrors} consecutive errors`;
          summary = `Stopped after ${consecutiveErrors} consecutive errors. Last: ${inputError}.`;
          break;
        }
        continue;
      }

      const { action: proposed, intent, reasoning } = parsed;

      // done(pass) is only accepted once something has been verified.
      if (proposed.type === "done" && proposed.status === "pass" && assertionsPassed === 0) {
        feedback = DONE_WITHOUT_ASSERT_FEEDBACK;
        const step = finishStep(base, {
          intent,
          reasoning,
          proposed,
          outcome: "error",
          error: "done(pass) before any assertion passed",
          urlAfter: page.url(),
          stepStarted,
        });
        steps.push(step);
        opts.onStep?.(step, budget);
        if (++consecutiveErrors >= limits.maxConsecutiveErrors) {
          stopReason = "the model kept finishing without verifying anything";
          summary = "Stopped: the model tried to pass without asserting anything.";
          break;
        }
        continue;
      }

      const result = await executeProposed(page, proposed, snapshot, {
        actionTimeoutMs: limits.actionTimeoutMs,
        actionRetries: limits.actionRetries,
      });
      const screenshot = await recorder.screenshot(page, String(index).padStart(2, "0"));
      const late = recorder.drain();
      const step = finishStep(
        {
          ...base,
          console: [...base.console, ...late.console],
          network: [...base.network, ...late.network],
        },
        {
          intent,
          reasoning,
          proposed,
          ...(result.action ? { action: result.action } : {}),
          ...(result.target ? { target: result.target } : {}),
          outcome: result.outcome,
          ...(result.error ? { error: result.error } : {}),
          urlAfter: page.url(),
          ...(screenshot ? { screenshot } : {}),
          stepStarted,
        },
      );
      steps.push(step);
      opts.onStep?.(step, budget);

      if (result.outcome === "failed") {
        verdict = "fail";
        summary = `Assertion failed at step ${index} (${intent}): ${result.error}`;
        break;
      }
      if (result.outcome === "error") {
        feedback = `Step ${index} could not be carried out: ${result.error}`;
        if (++consecutiveErrors >= limits.maxConsecutiveErrors) {
          stopReason = `${consecutiveErrors} consecutive errors`;
          summary = `Stopped after ${consecutiveErrors} consecutive errors. Last: ${result.error}.`;
          break;
        }
        continue;
      }
      consecutiveErrors = 0;
      if (proposed.type === "assert") assertionsPassed++;
      if (proposed.type === "done") {
        verdict = proposed.status;
        summary = proposed.summary;
        break;
      }
    }
  } catch (err) {
    verdict = "error";
    stopReason = err instanceof Error ? err.message.split("\n")[0] : String(err);
    summary = `Run error: ${stopReason}`;
  } finally {
    clearTimeout(runTimer);
    const videoPath = await page
      ?.video()
      ?.path()
      .catch(() => undefined);
    await context?.close().catch(() => {});
    if (ownsBrowser) await browser?.close().catch(() => {});
    video = await recorder.saveVideo(videoPath);
    await rm(videoDir, { recursive: true, force: true }).catch(() => {});
  }

  const finishedAt = new Date();
  const record: RunRecord = {
    schemaVersion: 1,
    id: path.basename(recorder.runDir),
    name,
    instruction: opts.instruction,
    startUrl: opts.url,
    runToken,
    provider: opts.provider.name,
    model: opts.provider.model,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    verdict,
    summary,
    ...(stopReason ? { stopReason } : {}),
    steps,
    totals: { ...budget.totals },
    limits,
    ...(video ? { video } : {}),
    console: recorder.console,
    network: recorder.network,
    environment: {
      qaPilotVersion: VERSION,
      playwrightVersion: playwrightVersion(),
      browser: "chromium",
      viewport,
      headless,
    },
  };
  if (budget.unpricedModels.size > 0) {
    record.summary += ` (cost not tracked for ${[...budget.unpricedModels].join(", ")})`;
  }
  await recorder.writeRun(record);
  if (opts.report !== false) await writeReport(record, recorder.runDir);
  await opts.afterRun?.(record, recorder.runDir);
  return { record, runDir: recorder.runDir };
}

function finishStep(
  base: Pick<StepRecord, "index" | "urlBefore" | "startedAt" | "console" | "network"> & {
    llm?: LlmCallRecord;
  },
  rest: Omit<
    StepRecord,
    "index" | "urlBefore" | "startedAt" | "console" | "network" | "llm" | "durationMs"
  > & {
    stepStarted: number;
  },
): StepRecord {
  const { stepStarted, ...fields } = rest;
  return {
    index: base.index,
    intent: fields.intent,
    reasoning: fields.reasoning,
    proposed: fields.proposed,
    ...(fields.action ? { action: fields.action } : {}),
    ...(fields.target ? { target: fields.target } : {}),
    outcome: fields.outcome,
    ...(fields.error ? { error: fields.error } : {}),
    urlBefore: base.urlBefore,
    urlAfter: fields.urlAfter,
    ...(fields.screenshot ? { screenshot: fields.screenshot } : {}),
    startedAt: base.startedAt,
    durationMs: Date.now() - stepStarted,
    ...(base.llm ? { llm: base.llm } : {}),
    console: base.console,
    network: base.network,
  };
}

async function decide(
  provider: LLMProvider,
  budget: Budget,
  input: Parameters<typeof renderStepPrompt>[0] & { snapshot: PageSnapshot },
  limits: RunLimits,
  signal: AbortSignal,
): Promise<Decision> {
  const messages: ChatMessage[] = [{ role: "user", content: renderStepPrompt(input) }];
  const started = Date.now();
  const llm: LlmCallRecord = {
    provider: provider.name,
    model: provider.model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    attempts: 0,
    latencyMs: 0,
  };
  try {
    const { result, attempts } = await withRetries(
      async () => {
        const reason = budget.stopReasonBeforeCall();
        if (reason) throw new LLMError(reason, { retryable: false });
        return provider.call({
          system: SYSTEM_PROMPT,
          messages,
          tools: ACTION_TOOLS,
          signal,
          context: { purpose: "step", snapshot: input.snapshot },
        });
      },
      { retries: limits.llmRetries, signal },
    );
    const charge = budget.charge(result.model, provider.model, result.usage);
    Object.assign(llm, result.usage, {
      model: result.model,
      costUsd: charge.costUsd,
      attempts,
      latencyMs: Date.now() - started,
    });
    return { response: result, llm };
  } catch (err) {
    llm.latencyMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    return { llm, error: message };
  }
}
