import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseUrlPattern } from "../actions/execute.js";
import { RUN_FILE, slugify } from "../evidence/recorder.js";
import { jsString, toCode } from "../locator/spec.js";
import type { ExecutedAction, LocatorSpec, RunRecord } from "../types.js";
import { VERSION } from "../version.js";

export const BASE_URL_ENV = "QA_PILOT_BASE_URL";
/** Marker comment the healer uses to recognise qa-pilot specs. */
export const SPEC_MARKER = "qa-pilot:";

export class ExportError extends Error {
  override name = "ExportError";
}

export interface ExportOptions {
  /** Title of the generated test. Defaults to the run name. */
  testName?: string;
  /** Export even if the run did not pass. */
  force?: boolean;
}

export interface SpecMetadata {
  generator: "qa-pilot";
  version: string;
  run: string;
  instruction: string;
  startUrl: string;
  model: string;
}

/** Escapes text for use inside a template literal. */
function templatePart(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/**
 * String literal factory. Values that contain the run token become template
 * literals that read the per-run RUN constant instead, so "ada+qa1b2c3@x.com"
 * is exported as `ada+${RUN}@x.com` and stays unique on every replay.
 */
export function literalFactory(runToken: string | undefined): {
  str: (value: string) => string;
  used: () => boolean;
} {
  let used = false;
  return {
    str: (value: string) => {
      if (!runToken || !value.includes(runToken)) return jsString(value);
      used = true;
      return `\`${value.split(runToken).map(templatePart).join("${RUN}")}\``;
    },
    used: () => used,
  };
}

/** Same-origin URLs become paths so the spec can point at any deployment. */
function urlExpression(url: string, origin: string, str: (v: string) => string): string {
  try {
    const parsed = new URL(url);
    if (parsed.origin === origin) {
      return `new URL(${str(parsed.pathname + parsed.search + parsed.hash)}, BASE_URL).toString()`;
    }
  } catch {
    // Not absolute; leave it alone.
  }
  return str(url);
}

function urlRegex(pattern: string, origin: string): string {
  const withoutOrigin = pattern.startsWith(origin) ? pattern.slice(origin.length) || "/" : pattern;
  return parseUrlPattern(withoutOrigin).toString();
}

export function actionLines(
  action: ExecutedAction,
  origin: string,
  str: (v: string) => string,
): string[] {
  const loc = (spec: LocatorSpec) => toCode(spec, "page", str);
  switch (action.type) {
    case "click":
      return [`await ${loc(action.locator)}.click();`];
    case "type":
      return [`await ${loc(action.locator)}.fill(${str(action.text)});`];
    case "select":
      return [`await ${loc(action.locator)}.selectOption(${str(action.option)});`];
    case "navigate":
      return [`await page.goto(${urlExpression(action.url, origin, str)});`];
    case "done":
      return [];
    case "assert":
      switch (action.kind) {
        case "text_visible":
        case "element_visible":
          return [`await expect(${loc(action.locator)}).toBeVisible();`];
        case "url_matches":
          return [`await expect(page).toHaveURL(${urlRegex(action.pattern, origin)});`];
        case "input_value":
          return [`await expect(${loc(action.locator)}).toHaveValue(${str(action.value)});`];
      }
  }
}

function comment(text: string): string {
  // Keep comments on one line and unable to close themselves.
  return text.replace(/\s+/g, " ").replace(/\*\//g, "* /").trim();
}

/**
 * Turns a passing run into a Playwright test. Only steps that succeeded are
 * replayed; the model is not involved at all.
 */
export function exportSpec(record: RunRecord, opts: ExportOptions = {}): string {
  if (record.verdict !== "pass" && !opts.force) {
    throw new ExportError(
      `run ${record.id} ended with "${record.verdict}"; only passing runs export cleanly (use --force to export anyway)`,
    );
  }
  const start = new URL(record.startUrl);
  const origin = start.origin;
  const { str, used } = literalFactory(record.runToken);

  const body: string[] = [];
  body.push(`  await page.goto(${urlExpression(record.startUrl, origin, str)});`);
  let finished: string | undefined;
  for (const step of record.steps) {
    if (step.outcome !== "ok" || !step.action) continue;
    if (step.action.type === "done") {
      finished = step.action.summary;
      continue;
    }
    const lines = actionLines(step.action, origin, str);
    body.push("");
    body.push(`  await test.step(${str(step.intent)}, async () => {`);
    for (const line of lines) body.push(`    ${line}`);
    body.push("  });");
  }
  if (finished) {
    body.push("");
    body.push(`  // Run summary: ${comment(finished)}`);
  }

  const meta: SpecMetadata = {
    generator: "qa-pilot",
    version: VERSION,
    run: record.id,
    instruction: record.instruction,
    startUrl: record.startUrl,
    model: `${record.provider}/${record.model}`,
  };

  const header = [
    `// Exported by qa-pilot ${VERSION} from run ${record.id}.`,
    `// Instruction: ${comment(record.instruction)}`,
    "// Replays the recorded steps with plain Playwright; no model is called.",
    `// Point it at another deployment with ${BASE_URL_ENV}=https://... npx playwright test`,
    `// ${SPEC_MARKER} ${JSON.stringify(meta).replace(/\*\//g, "*\\/")}`,
    `import { expect, test } from "@playwright/test";`,
    "",
    `const BASE_URL = process.env.${BASE_URL_ENV} ?? ${jsString(origin)};`,
  ];
  if (used()) {
    header.push("// Values that must be new on every run (emails, usernames) include this.");
    header.push("const RUN = Date.now().toString(36);");
  }

  return [
    ...header,
    "",
    `test(${jsString(opts.testName ?? record.name)}, async ({ page }) => {`,
    ...body,
    "});",
    "",
  ].join("\n");
}

export async function readRun(runDirOrFile: string): Promise<RunRecord> {
  const file = runDirOrFile.endsWith(".json") ? runDirOrFile : path.join(runDirOrFile, RUN_FILE);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new ExportError(`no run found at ${file}`);
  }
  const record = JSON.parse(text) as RunRecord;
  if (record.schemaVersion !== 1 || !Array.isArray(record.steps)) {
    throw new ExportError(`${file} is not a qa-pilot run.json`);
  }
  return record;
}

export function defaultSpecName(record: RunRecord): string {
  return `${slugify(record.name, 60)}.spec.ts`;
}

/** Reads a run folder and writes `<out>` (a .spec.ts path, or a folder for the default name). */
export async function exportRun(
  runDir: string,
  out?: string,
  opts: ExportOptions = {},
): Promise<{ file: string; code: string; record: RunRecord }> {
  const record = await readRun(runDir);
  const code = exportSpec(record, opts);
  let file: string;
  if (!out) file = path.join(runDir, defaultSpecName(record));
  else if (out.endsWith(".ts") || out.endsWith(".js")) file = out;
  else file = path.join(out, defaultSpecName(record));
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, code);
  return { file, code, record };
}
