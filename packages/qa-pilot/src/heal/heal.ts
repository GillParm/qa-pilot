import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTwoFilesPatch } from "diff";
import { chromium, type Browser, type Page } from "playwright";
import { z } from "zod";
import { performAction } from "../actions/execute.js";
import type { ToolSpec } from "../actions/tools.js";
import { Budget, resolveLimits } from "../agent/limits.js";
import { literalFactory } from "../export/spec.js";
import type { ModelPrice } from "../llm/pricing.js";
import { withRetries } from "../llm/retry.js";
import type { LLMProvider } from "../llm/types.js";
import { RefError, resolveRef } from "../locator/resolve.js";
import { describeLocator, toCode, toLocator } from "../locator/spec.js";
import { captureSnapshot } from "../snapshot/capture.js";
import type { ExecutedAction, LocatorSpec, RunLimits, RunTotals } from "../types.js";
import { parseSpec, type ParsedSpec, type ParsedStatement, type SourceRange } from "./parse.js";

export const HEAL_SYSTEM_PROMPT = `You repair broken end-to-end tests.

A step in a Playwright test could not find its element, usually because the app's markup or wording changed. You get the step's intent, the action it performs, the old locator, the error, and an accessibility snapshot of the page at the moment the step failed.

Pick the element that now does the same job and call propose_locator with its ref from the snapshot. Only choose an element that clearly serves the same purpose, such as a renamed button or a moved link. If nothing on the page does, call give_up and say why. Do not settle for something that merely looks similar: pointing a test at the wrong element hides real bugs.`;

export const HEAL_TOOLS: ToolSpec[] = [
  {
    name: "propose_locator",
    description: "Propose the element that should replace the broken locator.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Ref of the replacement element, e.g. 'e14'." },
        reasoning: {
          type: "string",
          description: "One or two sentences on why this element serves the same purpose.",
        },
      },
      required: ["ref", "reasoning"],
      additionalProperties: false,
    },
  },
  {
    name: "give_up",
    description: "No element on the page serves the step's purpose; the test should fail.",
    parameters: {
      type: "object",
      properties: { reasoning: { type: "string", description: "Why nothing fits." } },
      required: ["reasoning"],
      additionalProperties: false,
    },
  },
];

const proposeSchema = z.object({ ref: z.string().min(1), reasoning: z.string() });
const giveUpSchema = z.object({ reasoning: z.string() });

export interface HealOptions {
  specFile: string;
  /** Base URL to run against; defaults to the spec's own BASE_URL fallback. */
  baseUrl?: string;
  provider: LLMProvider;
  /** Save the healed spec over the original. Without it, only the diff is produced. */
  write?: boolean;
  headless?: boolean;
  limits?: Partial<RunLimits>;
  /** Proposals tried per broken step before giving up. */
  maxAttemptsPerStep?: number;
  prices?: Record<string, ModelPrice>;
  browser?: Browser;
  onEvent?: (event: HealEvent) => void;
}

export type HealEvent =
  | { type: "step"; line: number; title?: string; ok: boolean; error?: string }
  | { type: "broken"; line: number; title?: string; locator: string; error: string }
  | {
      type: "proposal";
      line: number;
      locator: string;
      ok: boolean;
      reasoning: string;
      error?: string;
    }
  | { type: "verify"; ok: boolean; error?: string };

export interface HealChange {
  line: number;
  stepTitle?: string;
  before: string;
  after: string;
  reasoning: string;
}

export interface HealResult {
  /** passed: nothing to heal. healed: fixed and verified. failed: could not be made green. */
  status: "passed" | "healed" | "failed";
  changes: HealChange[];
  diff: string;
  source: string;
  healedSource: string;
  written: boolean;
  failure?: { line: number; stepTitle?: string; message: string };
  totals: RunTotals;
}

export class HealError extends Error {
  override name = "HealError";
}

function newRunToken(): string {
  return `qa${randomBytes(4).toString("hex").slice(0, 6)}`;
}

function isInteraction(action: ExecutedAction): action is Extract<
  ExecutedAction,
  { locator: LocatorSpec }
> & {
  type: "click" | "type" | "select";
} {
  return action.type === "click" || action.type === "type" || action.type === "select";
}

function describeAction(action: ExecutedAction): string {
  switch (action.type) {
    case "click":
      return "click it";
    case "type":
      return `fill it with ${JSON.stringify(action.text)}`;
    case "select":
      return `choose the option ${JSON.stringify(action.option)}`;
    default:
      return action.type;
  }
}

/** Why a locator no longer works, or undefined if it still points at exactly one element. */
async function locatorProblem(page: Page, spec: LocatorSpec): Promise<string | undefined> {
  const count = await toLocator(page, spec).count();
  if (count === 0) return `${describeLocator(spec)} matches no element`;
  if (count > 1 && spec.nth === undefined)
    return `${describeLocator(spec)} matches ${count} elements`;
  return undefined;
}

interface ReplayOutcome {
  failure?: { statement: ParsedStatement; stepTitle?: string; message: string };
  replacements: { range: SourceRange; code: string }[];
  changes: HealChange[];
}

/**
 * Replays a spec step by step. When `heal` is set and an interaction's locator
 * is broken, asks the provider for a replacement and keeps going.
 */
async function replay(
  page: Page,
  parsed: ParsedSpec,
  opts: {
    limits: RunLimits;
    heal?: {
      provider: LLMProvider;
      budget: Budget;
      maxAttempts: number;
      runToken: string;
      instruction?: string;
    };
    onEvent?: (event: HealEvent) => void;
  },
): Promise<ReplayOutcome> {
  const outcome: ReplayOutcome = { replacements: [], changes: [] };
  const execOpts = {
    actionTimeoutMs: opts.limits.actionTimeoutMs,
    actionRetries: opts.limits.actionRetries,
  };

  for (const step of parsed.steps) {
    for (const statement of step.statements) {
      const result = await performAction(page, statement.action, execOpts);
      if (result.outcome === "ok") {
        opts.onEvent?.({
          type: "step",
          line: statement.line,
          ...(step.title ? { title: step.title } : {}),
          ok: true,
        });
        continue;
      }
      const error = result.error ?? "failed";
      const action = statement.action;
      const problem = isInteraction(action)
        ? await locatorProblem(page, action.locator)
        : undefined;

      if (!opts.heal || !isInteraction(action) || !problem || !statement.locatorRange) {
        // Assertions are never healed: a missing element there is usually the bug.
        opts.onEvent?.({
          type: "step",
          line: statement.line,
          ...(step.title ? { title: step.title } : {}),
          ok: false,
          error,
        });
        outcome.failure = {
          statement,
          ...(step.title ? { stepTitle: step.title } : {}),
          message:
            action.type === "assert"
              ? `assertion failed: ${error}. Assertions are not healed; this looks like a real failure.`
              : problem
                ? `${problem}: ${error}`
                : error,
        };
        return outcome;
      }

      opts.onEvent?.({
        type: "broken",
        line: statement.line,
        ...(step.title ? { title: step.title } : {}),
        locator: toCode(action.locator),
        error: problem,
      });
      const healed = await proposeReplacement(
        page,
        statement,
        step.title,
        problem,
        opts.heal,
        opts,
      );
      if (!healed.locator) {
        outcome.failure = {
          statement,
          ...(step.title ? { stepTitle: step.title } : {}),
          message: `${problem}; no replacement found (${healed.reason})`,
        };
        return outcome;
      }
      const { str } = literalFactory(opts.heal.runToken);
      const code = toCode(healed.locator, "page", str);
      outcome.replacements.push({ range: statement.locatorRange, code });
      outcome.changes.push({
        line: statement.line,
        ...(step.title ? { stepTitle: step.title } : {}),
        before: toCode(action.locator),
        after: toCode(healed.locator),
        reasoning: healed.reason,
      });
    }
  }
  return outcome;
}

async function proposeReplacement(
  page: Page,
  statement: ParsedStatement,
  stepTitle: string | undefined,
  problem: string,
  heal: NonNullable<Parameters<typeof replay>[2]["heal"]>,
  opts: { limits: RunLimits; onEvent?: (event: HealEvent) => void },
): Promise<{ locator?: LocatorSpec; reason: string }> {
  const action = statement.action as Extract<ExecutedAction, { locator: LocatorSpec }>;
  let feedback = "";
  let lastReason = "no proposal";

  for (let attempt = 1; attempt <= heal.maxAttempts; attempt++) {
    const stop = heal.budget.stopReasonBeforeCall();
    if (stop) return { reason: stop };

    const snapshot = await captureSnapshot(page, { timeoutMs: opts.limits.actionTimeoutMs });
    const prompt = [
      heal.instruction ? `The test checks: ${heal.instruction}` : undefined,
      `Broken step: ${stepTitle ?? "(untitled step)"}`,
      `The step should find an element and ${describeAction(action)}.`,
      `Old locator: ${toCode(action.locator)}`,
      `Problem: ${problem}.`,
      feedback ? `Previous proposal: ${feedback}` : undefined,
      "",
      `Current page: ${snapshot.title ? `${JSON.stringify(snapshot.title)} ` : ""}${snapshot.url}`,
      "Snapshot:",
      snapshot.text,
      "",
      "Call propose_locator or give_up.",
    ]
      .filter((l) => l !== undefined)
      .join("\n");

    let response;
    try {
      const { result } = await withRetries(
        () =>
          heal.provider.call({
            system: HEAL_SYSTEM_PROMPT,
            messages: [{ role: "user", content: prompt }],
            tools: HEAL_TOOLS,
            context: { purpose: "heal", snapshot },
          }),
        { retries: opts.limits.llmRetries },
      );
      response = result;
    } catch (err) {
      return { reason: err instanceof Error ? err.message : String(err) };
    }
    heal.budget.charge(response.model, heal.provider.model, response.usage);

    const call = response.toolCall;
    if (!call) {
      feedback = "you replied without calling a tool";
      continue;
    }
    if (call.name === "give_up") {
      const parsed = giveUpSchema.safeParse(call.input);
      return {
        reason: `model gave up: ${parsed.success ? parsed.data.reasoning : "no reason given"}`,
      };
    }
    const parsed = proposeSchema.safeParse(call.input);
    if (call.name !== "propose_locator" || !parsed.success) {
      feedback = `invalid tool call ${call.name}`;
      continue;
    }
    lastReason = parsed.data.reasoning;

    let locator: LocatorSpec;
    try {
      locator = (await resolveRef(page, parsed.data.ref, snapshot, opts.limits.actionTimeoutMs))
        .locator;
    } catch (err) {
      feedback = `ref ${parsed.data.ref} could not be used: ${err instanceof RefError ? err.message : String(err)}`;
      opts.onEvent?.({
        type: "proposal",
        line: statement.line,
        locator: parsed.data.ref,
        ok: false,
        reasoning: lastReason,
        error: feedback,
      });
      continue;
    }

    // Verify by doing the step for real with the new locator.
    const tried = await performAction(page, { ...action, locator } as ExecutedAction, {
      actionTimeoutMs: opts.limits.actionTimeoutMs,
      actionRetries: opts.limits.actionRetries,
    });
    opts.onEvent?.({
      type: "proposal",
      line: statement.line,
      locator: toCode(locator),
      ok: tried.outcome === "ok",
      reasoning: lastReason,
      ...(tried.error ? { error: tried.error } : {}),
    });
    if (tried.outcome === "ok") return { locator, reason: lastReason };
    feedback = `${toCode(locator)} failed: ${tried.error}`;
  }
  return {
    reason: `no working replacement after ${heal.maxAttempts} attempts (last: ${lastReason})`,
  };
}

function applyReplacements(
  source: string,
  replacements: { range: SourceRange; code: string }[],
): string {
  let out = source;
  for (const r of [...replacements].sort((a, b) => b.range.start - a.range.start)) {
    out = out.slice(0, r.range.start) + r.code + out.slice(r.range.end);
  }
  return out;
}

async function freshPage(browser: Browser, limits: RunLimits): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  context.setDefaultTimeout(limits.actionTimeoutMs);
  return context.newPage();
}

/**
 * Runs an exported spec in a real browser. If an interaction's locator broke,
 * asks the model for a replacement, verifies it by performing the step, and
 * produces a unified diff. The file is only changed with `write`.
 */
export async function healSpec(opts: HealOptions): Promise<HealResult> {
  const limits = resolveLimits({ maxCostUsd: 0.5, ...opts.limits });
  const budget = new Budget(limits, opts.prices);
  const source = await readFile(opts.specFile, "utf8");
  const runToken = newRunToken();

  // Parse once to learn the default base URL, then again with the real env.
  const probe = parseSpec(source, { BASE_URL: "http://localhost", RUN: runToken }, opts.specFile);
  const baseUrl = opts.baseUrl ?? probe.defaultBaseUrl;
  if (!baseUrl) throw new HealError("pass --url: the spec has no BASE_URL fallback");
  const parsed = parseSpec(source, { BASE_URL: baseUrl, RUN: runToken }, opts.specFile);

  const browser = opts.browser ?? (await chromium.launch({ headless: opts.headless ?? true }));
  try {
    const page = await freshPage(browser, limits);
    const outcome = await replay(page, parsed, {
      limits,
      heal: {
        provider: opts.provider,
        budget,
        maxAttempts: opts.maxAttemptsPerStep ?? 2,
        runToken,
        ...(parsed.metadata?.instruction ? { instruction: parsed.metadata.instruction } : {}),
      },
      ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    });
    await page.context().close();

    const healedSource = applyReplacements(source, outcome.replacements);
    const relative = path.relative(process.cwd(), opts.specFile) || opts.specFile;
    const diff =
      healedSource === source
        ? ""
        : createTwoFilesPatch(relative, relative, source, healedSource, "original", "healed");

    const base = {
      changes: outcome.changes,
      diff,
      source,
      healedSource,
      totals: { ...budget.totals },
    };
    if (outcome.failure) {
      return {
        ...base,
        status: "failed",
        written: false,
        failure: {
          line: outcome.failure.statement.line,
          ...(outcome.failure.stepTitle ? { stepTitle: outcome.failure.stepTitle } : {}),
          message: outcome.failure.message,
        },
      };
    }
    if (outcome.changes.length === 0) return { ...base, status: "passed", written: false };

    // Re-run the healed spec from a clean browser context, with a new run token.
    const verifyToken = newRunToken();
    const healedParsed = parseSpec(
      healedSource,
      { BASE_URL: baseUrl, RUN: verifyToken },
      opts.specFile,
    );
    const verifyPage = await freshPage(browser, limits);
    const verify = await replay(verifyPage, healedParsed, { limits });
    await verifyPage.context().close();
    opts.onEvent?.({
      type: "verify",
      ok: !verify.failure,
      ...(verify.failure ? { error: verify.failure.message } : {}),
    });
    if (verify.failure) {
      return {
        ...base,
        status: "failed",
        written: false,
        failure: {
          line: verify.failure.statement.line,
          ...(verify.failure.stepTitle ? { stepTitle: verify.failure.stepTitle } : {}),
          message: `the healed spec still fails: ${verify.failure.message}`,
        },
      };
    }
    if (opts.write) await writeFile(opts.specFile, healedSource);
    return {
      ...base,
      status: "healed",
      written: Boolean(opts.write),
      totals: { ...budget.totals },
    };
  } finally {
    if (!opts.browser) await browser.close();
  }
}
