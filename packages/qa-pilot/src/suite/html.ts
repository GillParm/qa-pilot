import { REPORT_FILE } from "../evidence/recorder.js";
import { formatUsd } from "../llm/pricing.js";
import { BASE_CSS, escapeHtml, formatDuration, VERDICT_LABEL } from "../report/html.js";
import { headline, whatHappened } from "./markdown.js";
import type { SuiteSummary, TestResult } from "./runner.js";

const SUITE_CSS = `
h1 { font-size: 30px; line-height: 1.2; margin: 0 0 6px; }
.headline { margin: 0; font-size: 18px; max-width: 70ch; }
.tests { list-style: none; padding: 0; margin: 32px 0 0; display: grid; gap: 6px; }
.test {
  display: grid;
  grid-template-columns: 112px 1fr auto;
  gap: 16px;
  align-items: center;
  background: var(--sheet);
  border: 1px solid var(--rule);
  border-left: 6px solid var(--rule);
  border-radius: 4px;
  padding: 12px 16px 12px 12px;
}
.test.unexpected { border-color: var(--fail); border-left-color: var(--fail); }
.test.expected { border-left-color: var(--pass); }
.mini-stamp { font-size: 20px; font-weight: 700; border: 2px solid currentColor; border-radius: 4px; padding: 0 8px; justify-self: start; }
.v-skipped { color: var(--muted); }
.name { font-weight: 600; }
.name a { text-decoration: none; }
.name a:hover { text-decoration: underline; }
.instr { color: var(--muted); font-size: 14px; max-width: 75ch; }
.happened { margin-top: 4px; font-size: 14px; max-width: 75ch; }
.unexpected .happened { color: var(--fail); }
.nums { text-align: right; font-size: 14px; color: var(--muted); white-space: nowrap; }
.expect-note { font-size: 13px; color: var(--muted); }
@media (max-width: 720px) {
  .test { grid-template-columns: 1fr; }
  .nums { text-align: left; }
}
`;

function renderTest(r: TestResult): string {
  const label = r.verdict === "skipped" ? "Skipped" : VERDICT_LABEL[r.verdict];
  const link = r.runDir ? `${r.runDir.split("\\").join("/")}/${REPORT_FILE}` : undefined;
  const name = link
    ? `<a href="${escapeHtml(link)}">${escapeHtml(r.name)}</a>`
    : escapeHtml(r.name);
  return `<li class="test ${r.asExpected ? "expected" : "unexpected"}">
  <span class="mini-stamp condensed v-${r.verdict}">${label}</span>
  <div>
    <div class="name">${name}</div>
    <div class="instr">${escapeHtml(r.instruction)}</div>
    <div class="happened">${escapeHtml(whatHappened(r))}</div>
  </div>
  <div class="nums condensed">
    ${r.steps} steps, ${escapeHtml(formatUsd(r.costUsd))}<br>${escapeHtml(formatDuration(r.durationMs))}<br>
    <span class="expect-note">expected ${r.expect}</span>
  </div>
</li>`;
}

/** The suite's index.html: one line per test, linking to each run's report. */
export function renderSuiteHtml(summary: SuiteSummary): string {
  const t = summary.totals;
  const facts: [string, string][] = [
    [
      "Tests",
      `${t.tests} (${t.passed} passed, ${t.failed} failed${t.errors ? `, ${t.errors} stopped` : ""}${t.skipped ? `, ${t.skipped} skipped` : ""})`,
    ],
    ["Model", `${summary.model} (${summary.provider})`],
    ["Cost", formatUsd(t.costUsd)],
    ["Duration", formatDuration(summary.durationMs)],
  ];
  if (summary.baseUrl) facts.push(["Base URL", summary.baseUrl]);
  facts.push(["Started", `${summary.startedAt.replace("T", " ").slice(0, 16)} UTC`]);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(summary.name)}: qa-pilot suite</title>
<style>${BASE_CSS}${SUITE_CSS}</style>
</head>
<body>
<div class="wrap">
<p class="product"><strong>qa-pilot</strong> suite report</p>
<h1>${escapeHtml(summary.name)}</h1>
<p class="headline ${summary.ok ? "v-pass" : "v-fail"}">${escapeHtml(headline(summary))}</p>
<dl class="facts">
${facts.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("\n")}
</dl>
<ol class="tests">
${summary.results.map(renderTest).join("\n")}
</ol>
</div>
</body>
</html>
`;
}
