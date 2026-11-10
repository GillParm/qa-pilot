import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPORT_FILE } from "../evidence/recorder.js";
import { describeStep } from "../agent/prompt.js";
import { formatUsd } from "../llm/pricing.js";
import { toCode } from "../locator/spec.js";
import type { RunRecord, StepRecord, Verdict } from "../types.js";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON that is safe inside a <script> element. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "Passed",
  fail: "Failed",
  error: "Stopped",
};

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
}

/** Shared tokens and base styles, also used by the suite report. */
export const BASE_CSS = `
:root {
  color-scheme: light dark;
  --paper: #f2f4f6;
  --sheet: #ffffff;
  --ink: #17212b;
  --muted: #586572;
  --rule: #d5dce2;
  --strip-action: #e2ecf5;
  --strip-assert: #f3ead2;
  --strip-done: #e6e9ec;
  --pass: #1d7348;
  --fail: #b0281f;
  --error: #8c5a00;
  --focus: #1f5fbf;
  --code-bg: rgba(23, 33, 43, 0.06);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper: #0f161d;
    --sheet: #16202a;
    --ink: #e4eaf0;
    --muted: #9aa8b5;
    --rule: #2a3743;
    --strip-action: #1b2c3c;
    --strip-assert: #33301f;
    --strip-done: #222b33;
    --pass: #5cc48d;
    --fail: #ff7b6e;
    --error: #e0a842;
    --focus: #79a8ff;
    --code-bg: rgba(228, 234, 240, 0.08);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
a { color: inherit; text-underline-offset: 2px; }
a:focus-visible, summary:focus-visible, button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
code, pre { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; }
.wrap { max-width: 1080px; margin: 0 auto; padding: 32px 20px 64px; }
.condensed {
  font-family: "Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif;
  font-stretch: condensed;
  font-variant-numeric: tabular-nums;
}
.product { margin: 0 0 20px; color: var(--muted); font-size: 14px; }
.product strong { color: var(--ink); }
.stamp {
  display: inline-block;
  padding: 2px 14px 4px;
  border: 3px solid currentColor;
  border-radius: 6px;
  font-size: 44px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: 0.01em;
}
.v-pass { color: var(--pass); }
.v-fail { color: var(--fail); }
.v-error { color: var(--error); }
.facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px 24px; margin: 24px 0 0; }
.facts .wide { grid-column: span 2; }
@media (max-width: 480px) { .facts .wide { grid-column: 1 / -1; } }
.facts div { border-top: 1px solid var(--rule); padding-top: 6px; }
.facts dt { color: var(--muted); font-size: 13px; }
.facts dd { margin: 0; font-size: 17px; overflow-wrap: anywhere; }
`;

const REPORT_CSS = `
header.run { display: grid; grid-template-columns: auto 1fr; gap: 8px 28px; align-items: start; }
.instruction { margin: 0; font-size: 26px; line-height: 1.3; font-weight: 600; max-width: 60ch; }
.summary { margin: 8px 0 0; color: var(--muted); max-width: 70ch; }
@media (max-width: 720px) {
  header.run { grid-template-columns: 1fr; }
  .stamp { font-size: 34px; justify-self: start; }
  .instruction { font-size: 21px; }
}
h2 { font-size: 18px; margin: 40px 0 12px; }
.strips { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
.strip { background: var(--sheet); border: 1px solid var(--rule); border-left: 6px solid var(--rule); border-radius: 4px; }
.strip.k-action { border-left-color: #6f9fcb; }
.strip.k-assert { border-left-color: #c9a64e; }
.strip.k-done { border-left-color: var(--muted); }
.strip.o-failed { border-color: var(--fail); border-left-color: var(--fail); }
.strip.o-error { border-left-color: var(--error); }
.strip > details > summary {
  list-style: none;
  cursor: pointer;
  display: grid;
  grid-template-columns: 52px 1fr auto;
  gap: 14px;
  align-items: center;
  padding: 10px 14px 10px 0;
}
.strip > details > summary::-webkit-details-marker { display: none; }
.num {
  align-self: stretch;
  display: grid;
  place-items: center;
  font-size: 22px;
  font-weight: 700;
  border-right: 1px solid var(--rule);
}
.k-action .num { background: var(--strip-action); }
.k-assert .num { background: var(--strip-assert); }
.k-done .num { background: var(--strip-done); }
.what { min-width: 0; }
.intent { font-weight: 600; }
.did { color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
.side { text-align: right; font-size: 14px; white-space: nowrap; }
.outcome { font-weight: 600; }
.o-ok .outcome { color: var(--pass); }
.o-failed .outcome { color: var(--fail); }
.o-error .outcome { color: var(--error); }
.thumb { display: block; width: 104px; height: 65px; object-fit: cover; object-position: top; border: 1px solid var(--rule); border-radius: 3px; margin-top: 4px; }
.detail { padding: 0 16px 16px 66px; display: grid; gap: 12px; }
@media (max-width: 720px) {
  .strip > details > summary { grid-template-columns: 44px 1fr; }
  .side { grid-column: 2; text-align: left; }
  .thumb { display: none; }
  .detail { padding-left: 16px; }
}
.reasoning { margin: 0; max-width: 72ch; }
.error-msg { margin: 0; color: var(--fail); font-weight: 600; }
.o-error .error-msg { color: var(--error); }
.code { margin: 0; padding: 8px 10px; background: var(--code-bg); border-radius: 4px; overflow-x: auto; }
.shot { max-width: 100%; border: 1px solid var(--rule); border-radius: 4px; }
.meta { color: var(--muted); font-size: 13px; }
.logs { margin: 0; padding-left: 18px; font-size: 14px; }
.logs li { overflow-wrap: anywhere; }
.empty { color: var(--muted); }
video { width: 100%; max-width: 720px; border: 1px solid var(--rule); border-radius: 4px; background: #000; }
footer { margin-top: 48px; color: var(--muted); font-size: 13px; }
`;

function stepKind(step: StepRecord): "action" | "assert" | "done" {
  if (step.proposed.type === "assert") return "assert";
  if (step.proposed.type === "done") return "done";
  return "action";
}

function outcomeLabel(step: StepRecord): string {
  if (step.outcome === "failed") return "Assertion failed";
  if (step.outcome === "error") return "Error";
  if (step.proposed.type === "assert") return "Held";
  if (step.proposed.type === "done") return "Finished";
  return "OK";
}

function actionCode(step: StepRecord): string | undefined {
  const a = step.action;
  if (!a) return undefined;
  switch (a.type) {
    case "click":
      return `await ${toCode(a.locator)}.click();`;
    case "type":
      return `await ${toCode(a.locator)}.fill(${JSON.stringify(a.text)});`;
    case "select":
      return `await ${toCode(a.locator)}.selectOption(${JSON.stringify(a.option)});`;
    case "navigate":
      return `await page.goto(${JSON.stringify(a.url)});`;
    case "done":
      return undefined;
    case "assert":
      switch (a.kind) {
        case "text_visible":
        case "element_visible":
          return `await expect(${toCode(a.locator)}).toBeVisible();`;
        case "url_matches":
          return `await expect(page).toHaveURL(${JSON.stringify(a.pattern)});`;
        case "input_value":
          return `await expect(${toCode(a.locator)}).toHaveValue(${JSON.stringify(a.value)});`;
      }
  }
}

export type ImageSource = (relativePath: string) => string | undefined;

function renderStep(step: StepRecord, image: ImageSource, open: boolean): string {
  const kind = stepKind(step);
  const src = step.screenshot ? image(step.screenshot) : undefined;
  const code = actionCode(step);
  const llm = step.llm;
  const logs = [
    ...step.console.map((c) => `<li>Console ${escapeHtml(c.type)}: ${escapeHtml(c.text)}</li>`),
    ...step.network.map(
      (n) =>
        `<li>${escapeHtml(n.method)} ${escapeHtml(n.url)}: ${escapeHtml(String(n.status ?? n.failure ?? "failed"))}</li>`,
    ),
  ];
  const timing = [formatDuration(step.durationMs), llm ? formatUsd(llm.costUsd) : undefined].filter(
    Boolean,
  );

  return `<li class="strip k-${kind} o-${step.outcome}" id="step-${step.index}">
<details${open ? " open" : ""}>
<summary>
  <span class="num condensed" aria-label="Step ${step.index}">${String(step.index).padStart(2, "0")}</span>
  <span class="what">
    <span class="intent">${escapeHtml(step.intent)}</span><br>
    <span class="did">${escapeHtml(describeStep(step))}</span>
  </span>
  <span class="side">
    <span class="outcome">${outcomeLabel(step)}</span><br>
    <span class="meta condensed">${timing.map((t) => escapeHtml(String(t))).join(", ")}</span>
    ${src ? `<img class="thumb" src="${src}" alt="" loading="lazy">` : ""}
  </span>
</summary>
<div class="detail">
  ${step.error ? `<p class="error-msg">${escapeHtml(step.error)}</p>` : ""}
  ${step.reasoning ? `<p class="reasoning">${escapeHtml(step.reasoning)}</p>` : ""}
  ${code ? `<pre class="code"><code>${escapeHtml(code)}</code></pre>` : ""}
  ${logs.length ? `<ul class="logs">${logs.join("")}</ul>` : ""}
  <p class="meta">URL after this step: ${escapeHtml(step.urlAfter)}${
    llm
      ? `. Model ${escapeHtml(llm.model)}, ${llm.inputTokens.toLocaleString("en-US")} input and ${llm.outputTokens.toLocaleString("en-US")} output tokens, ${llm.attempts} attempt${llm.attempts === 1 ? "" : "s"}, ${formatDuration(llm.latencyMs)}.`
      : "."
  }</p>
  ${src ? `<img class="shot" src="${src}" alt="Screenshot after step ${step.index}" loading="lazy">` : ""}
</div>
</details>
</li>`;
}

function startStrip(record: RunRecord, src: string | undefined): string {
  return `<li class="strip k-done o-ok" id="step-0">
<details>
<summary>
  <span class="num condensed" aria-label="Start">00</span>
  <span class="what">
    <span class="intent">Open the start URL</span><br>
    <span class="did">${escapeHtml(record.startUrl)}</span>
  </span>
  <span class="side">${src ? `<img class="thumb" src="${src}" alt="" loading="lazy">` : ""}</span>
</summary>
<div class="detail">
  ${src ? `<img class="shot" src="${src}" alt="Screenshot of the start page" loading="lazy">` : `<p class="empty">No screenshot.</p>`}
</div>
</details>
</li>`;
}

export interface RenderReportOptions {
  /** Maps a screenshot path from run.json to an <img> src. */
  image?: ImageSource;
}

/** Renders a run as a single HTML page. Screenshots come from `image`; the video is linked. */
export function renderReport(record: RunRecord, opts: RenderReportOptions = {}): string {
  const image = opts.image ?? ((p: string) => p);
  const verdict = record.verdict;
  const firstProblem = record.steps.findIndex((s) => s.outcome === "failed");
  const openIndex = firstProblem >= 0 ? firstProblem : record.steps.length - 1;
  const started = new Date(record.startedAt);

  const facts: [string, string][] = [
    ["Start URL", record.startUrl],
    ["Model", `${record.model} (${record.provider})`],
    ["Steps", `${record.steps.length} of ${record.limits.maxSteps}`],
    ["Cost", `${formatUsd(record.totals.costUsd)} of ${formatUsd(record.limits.maxCostUsd)}`],
    [
      "Tokens",
      `${record.totals.inputTokens.toLocaleString("en-US")} in, ${record.totals.outputTokens.toLocaleString("en-US")} out`,
    ],
    ["Duration", formatDuration(record.durationMs)],
    ["Started", `${started.toISOString().replace("T", " ").slice(0, 16)} UTC`],
  ];
  if (record.stopReason) facts.push(["Stopped because", record.stopReason]);

  const startShot = image("steps/00-start.png");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(VERDICT_LABEL[verdict])}: ${escapeHtml(record.name)}</title>
<style>${BASE_CSS}${REPORT_CSS}</style>
</head>
<body>
<div class="wrap">
<p class="product"><strong>qa-pilot</strong> run report</p>
<header class="run">
  <span class="stamp condensed v-${verdict}">${VERDICT_LABEL[verdict]}</span>
  <div>
    <h1 class="instruction">${escapeHtml(record.instruction)}</h1>
    ${record.summary ? `<p class="summary">${escapeHtml(record.summary)}</p>` : ""}
  </div>
</header>
<dl class="facts">
${facts
  .map(
    ([k, v]) =>
      `<div${v.length > 24 ? ' class="wide"' : ""}><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`,
  )
  .join("\n")}
</dl>

<h2>Steps</h2>
<ol class="strips">
${startStrip(record, startShot)}
${record.steps.map((s, i) => renderStep(s, image, i === openIndex)).join("\n")}
</ol>
${record.steps.length ? "" : `<p class="empty">No steps ran.</p>`}

<h2>Console errors (${record.console.length})</h2>
${
  record.console.length
    ? `<ul class="logs">${record.console.map((c) => `<li>${escapeHtml(c.type)}: ${escapeHtml(c.text)}${c.url ? ` <span class="meta">(${escapeHtml(c.url)})</span>` : ""}</li>`).join("")}</ul>`
    : `<p class="empty">None.</p>`
}

<h2>Failed requests (${record.network.length})</h2>
${
  record.network.length
    ? `<ul class="logs">${record.network.map((n) => `<li>${escapeHtml(n.method)} ${escapeHtml(n.url)}: ${escapeHtml(String(n.status ?? n.failure))}</li>`).join("")}</ul>`
    : `<p class="empty">None.</p>`
}

<h2>Video</h2>
${
  record.video
    ? `<video controls preload="metadata" src="${escapeHtml(record.video)}"></video>
<p class="meta">The video sits next to this report as <a href="${escapeHtml(record.video)}">${escapeHtml(record.video)}</a>; keep them in the same folder.</p>`
    : `<p class="empty">Not recorded.</p>`
}

<footer>
qa-pilot ${escapeHtml(record.environment.qaPilotVersion)}, Playwright ${escapeHtml(record.environment.playwrightVersion)}, ${escapeHtml(record.environment.browser)} ${record.environment.viewport.width}×${record.environment.viewport.height}. Run ${escapeHtml(record.id)}. Raw data is in run.json and embedded below.
</footer>
</div>
<script type="application/json" id="qa-pilot-run">${scriptJson(record)}</script>
</body>
</html>
`;
}

/** Inlines screenshots as data URIs so the report is a single portable file (apart from the video). */
export async function writeReport(record: RunRecord, runDir: string): Promise<string> {
  const images = new Map<string, string>();
  const paths = [
    "steps/00-start.png",
    ...record.steps.flatMap((s) => (s.screenshot ? [s.screenshot] : [])),
  ];
  for (const relative of paths) {
    try {
      const data = await readFile(path.join(runDir, relative));
      images.set(relative, `data:image/png;base64,${data.toString("base64")}`);
    } catch {
      // Missing screenshots are simply not shown.
    }
  }
  const html = renderReport(record, { image: (p) => images.get(p) });
  const file = path.join(runDir, REPORT_FILE);
  await writeFile(file, html);
  return file;
}
