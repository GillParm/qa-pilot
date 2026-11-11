import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { runAgent } from "../agent/run.js";
import { compactTimestamp, slugify } from "../evidence/recorder.js";
import { exportRun } from "../export/spec.js";
import { formatUsd, type ModelPrice } from "../llm/pricing.js";
import type { LLMProvider } from "../llm/types.js";
import type { RunLimits, RunRecord, StepRecord, Verdict } from "../types.js";
import { filterByTags, resolveTests, type ResolvedTest, type Suite } from "./config.js";
import { renderSuiteHtml } from "./html.js";
import { renderSuiteMarkdown } from "./markdown.js";

export interface TestResult {
  name: string;
  instruction: string;
  tags: string[];
  expect: "pass" | "fail";
  startUrl: string;
  verdict: Verdict | "skipped";
  asExpected: boolean;
  summary: string;
  /** Run folder relative to the suite folder. */
  runDir?: string;
  steps: number;
  costUsd: number;
  durationMs: number;
  /** The step that failed or errored last, for summaries. */
  failedStep?: { index: number; intent: string; error: string; screenshot?: string };
  /** Exported spec, when export was requested and the run passed. */
  exported?: string;
}

export interface SuiteSummary {
  schemaVersion: 1;
  name: string;
  suiteFile?: string;
  provider: string;
  model: string;
  baseUrl?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  results: TestResult[];
  totals: {
    tests: number;
    passed: number;
    failed: number;
    errors: number;
    skipped: number;
    asExpected: number;
    unexpected: number;
    costUsd: number;
  };
  /** True when every test ended the way its `expect` said it would. */
  ok: boolean;
}

export interface SuiteRunOptions {
  suite: Suite;
  suiteFile?: string;
  provider: LLMProvider;
  baseUrl?: string;
  tags?: string[];
  /** Parent folder for suite folders. Default ./qa-pilot-runs */
  outputDir?: string;
  /** Explicit limits (CLI flags). They win over the suite file. */
  limits?: Partial<RunLimits>;
  /** Stop starting tests once the suite has spent this much. */
  maxSuiteCostUsd?: number;
  /** Write a Playwright spec here for each passing run. */
  exportDir?: string;
  headless?: boolean;
  video?: boolean;
  /** Price overrides for models missing from the table. */
  prices?: Record<string, ModelPrice>;
  onTestStart?: (test: ResolvedTest, index: number, total: number) => void;
  onTestEnd?: (result: TestResult, index: number, total: number) => void;
  onStep?: (step: StepRecord) => void;
}

export interface SuiteRunResult {
  summary: SuiteSummary;
  suiteDir: string;
}

export const SUMMARY_JSON = "summary.json";
export const SUMMARY_MD = "summary.md";
export const SUITE_HTML = "index.html";

function lastProblem(record: RunRecord): TestResult["failedStep"] {
  const step = [...record.steps].reverse().find((s) => s.outcome !== "ok");
  if (!step) return undefined;
  return {
    index: step.index,
    intent: step.intent,
    error: step.error ?? "",
    ...(step.screenshot ? { screenshot: step.screenshot } : {}),
  };
}

function definedLimits(limits: Partial<RunLimits> | undefined): Partial<RunLimits> {
  return Object.fromEntries(
    Object.entries(limits ?? {}).filter(([, v]) => v !== undefined),
  ) as Partial<RunLimits>;
}

export function summarize(
  results: TestResult[],
  meta: Omit<SuiteSummary, "results" | "totals" | "ok" | "schemaVersion">,
): SuiteSummary {
  const count = (v: TestResult["verdict"]) => results.filter((r) => r.verdict === v).length;
  const asExpected = results.filter((r) => r.asExpected).length;
  return {
    schemaVersion: 1,
    ...meta,
    results,
    totals: {
      tests: results.length,
      passed: count("pass"),
      failed: count("fail"),
      errors: count("error"),
      skipped: count("skipped"),
      asExpected,
      unexpected: results.length - asExpected,
      costUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
    },
    ok: results.length > 0 && asExpected === results.length,
  };
}

/** Runs every test in a suite with one shared browser and writes summary files. */
export async function runSuite(opts: SuiteRunOptions): Promise<SuiteRunResult> {
  const startedAt = new Date();
  const tests = filterByTags(resolveTests(opts.suite, opts.baseUrl), opts.tags ?? []);
  const suiteDir = path.resolve(
    opts.outputDir ?? "qa-pilot-runs",
    `${compactTimestamp(startedAt)}-suite-${slugify(opts.suite.name, 40)}`,
  );
  await mkdir(suiteDir, { recursive: true });

  const results: TestResult[] = [];
  let spent = 0;
  const browser = await chromium.launch({ headless: opts.headless ?? true });
  try {
    for (const [i, test] of tests.entries()) {
      opts.onTestStart?.(test, i, tests.length);
      const base = {
        name: test.name,
        instruction: test.instruction,
        tags: test.tags,
        expect: test.expect,
        startUrl: test.startUrl,
      };

      if (opts.maxSuiteCostUsd !== undefined && spent >= opts.maxSuiteCostUsd) {
        const skipped: TestResult = {
          ...base,
          verdict: "skipped",
          asExpected: false,
          summary: `Skipped: the suite cost limit (${formatUsd(opts.maxSuiteCostUsd)}) was reached.`,
          steps: 0,
          costUsd: 0,
          durationMs: 0,
        };
        results.push(skipped);
        opts.onTestEnd?.(skipped, i, tests.length);
        continue;
      }

      const limits: Partial<RunLimits> = {
        ...definedLimits(opts.suite.limits),
        ...definedLimits(test.limits),
        ...definedLimits(opts.limits),
      };
      if (opts.maxSuiteCostUsd !== undefined) {
        const remaining = opts.maxSuiteCostUsd - spent;
        limits.maxCostUsd = Math.min(limits.maxCostUsd ?? 1, remaining);
      }

      const { record, runDir } = await runAgent({
        instruction: test.instruction,
        name: test.name,
        url: test.startUrl,
        provider: opts.provider,
        browser,
        outputDir: suiteDir,
        limits,
        ...(opts.video !== undefined ? { video: opts.video } : {}),
        ...(opts.prices ? { prices: opts.prices } : {}),
        ...(opts.onStep ? { onStep: opts.onStep } : {}),
      });
      spent += record.totals.costUsd;

      const result: TestResult = {
        ...base,
        verdict: record.verdict,
        asExpected: record.verdict !== "error" && record.verdict === test.expect,
        summary: record.summary,
        runDir: path.relative(suiteDir, runDir),
        steps: record.steps.length,
        costUsd: record.totals.costUsd,
        durationMs: record.durationMs,
      };
      const problem = lastProblem(record);
      if (problem && record.verdict !== "pass") result.failedStep = problem;

      if (opts.exportDir && record.verdict === "pass") {
        const { file } = await exportRun(runDir, opts.exportDir);
        result.exported = file;
      }
      results.push(result);
      opts.onTestEnd?.(result, i, tests.length);
    }
  } finally {
    await browser.close();
  }

  const finishedAt = new Date();
  const summary = summarize(results, {
    name: opts.suite.name,
    ...(opts.suiteFile ? { suiteFile: opts.suiteFile } : {}),
    provider: opts.provider.name,
    model: opts.provider.model,
    ...((opts.baseUrl ?? opts.suite.baseUrl)
      ? { baseUrl: opts.baseUrl ?? opts.suite.baseUrl }
      : {}),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  });

  await writeFile(path.join(suiteDir, SUMMARY_JSON), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(suiteDir, SUMMARY_MD), renderSuiteMarkdown(summary));
  await writeFile(path.join(suiteDir, SUITE_HTML), renderSuiteHtml(summary));
  return { summary, suiteDir };
}
