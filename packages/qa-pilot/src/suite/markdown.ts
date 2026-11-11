import { formatUsd } from "../llm/pricing.js";
import { formatDuration } from "../report/html.js";
import type { SuiteSummary, TestResult } from "./runner.js";

/** Makes text safe for a single Markdown table cell. */
export function cell(text: string, max = 220): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const short = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  return short.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/</g, "&lt;");
}

const RESULT_LABEL: Record<TestResult["verdict"], string> = {
  pass: "pass",
  fail: "fail",
  error: "stopped",
  skipped: "skipped",
};

export function headline(summary: SuiteSummary): string {
  const { tests, unexpected } = summary.totals;
  if (tests === 0) return "No tests ran.";
  if (unexpected === 0) {
    return tests === 1 ? "The test ended as expected." : `All ${tests} tests ended as expected.`;
  }
  return `${unexpected} of ${tests} test${tests === 1 ? "" : "s"} did not end as expected.`;
}

export function whatHappened(result: TestResult): string {
  if (result.verdict === "pass" && result.asExpected) return result.summary || "Passed.";
  return result.summary || result.failedStep?.error || "";
}

export interface SuiteMarkdownOptions {
  /** Heading level for the title (default 3). */
  level?: number;
  /** Extra text appended to each test's "what happened" cell (links, screenshot names). */
  extra?: (result: TestResult) => string | undefined;
}

/** A compact Markdown summary, used for summary.md and the pull request comment. */
export function renderSuiteMarkdown(
  summary: SuiteSummary,
  opts: SuiteMarkdownOptions = {},
): string {
  const hashes = "#".repeat(opts.level ?? 3);
  const t = summary.totals;
  const steps = summary.results.reduce((sum, r) => sum + r.steps, 0);
  const lines = [
    `${hashes} qa-pilot: ${cell(summary.name, 80)}`,
    "",
    `**${headline(summary)}** ${t.passed} passed, ${t.failed} failed${t.errors ? `, ${t.errors} stopped` : ""}${t.skipped ? `, ${t.skipped} skipped` : ""}. Model ${summary.model}, ${steps} steps, ${formatUsd(t.costUsd)}, ${formatDuration(summary.durationMs)}.`,
    "",
    "| Test | Expected | Result | Steps | Cost | What happened |",
    "| --- | --- | --- | ---: | ---: | --- |",
  ];
  for (const r of summary.results) {
    const result = r.asExpected ? RESULT_LABEL[r.verdict] : `**${RESULT_LABEL[r.verdict]}**`;
    const extra = opts.extra?.(r);
    lines.push(
      `| ${cell(r.name, 80)} | ${r.expect} | ${result} | ${r.steps} | ${formatUsd(r.costUsd)} | ${cell(whatHappened(r))}${extra ? ` ${extra}` : ""} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
