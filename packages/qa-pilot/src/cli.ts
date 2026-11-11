import { existsSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { describeStep } from "./agent/prompt.js";
import { renderComment, upsertComment, type CommentInput } from "./ci/comment.js";
import { readPlaywrightReport } from "./ci/playwright-report.js";
import { runAgent } from "./agent/run.js";
import { REPORT_FILE } from "./evidence/recorder.js";
import { exportRun } from "./export/spec.js";
import { healSpec, type HealEvent } from "./heal/heal.js";
import { createProvider, defaultModel, PROVIDERS } from "./llm/index.js";
import type { Effort } from "./llm/anthropic.js";
import { formatUsd } from "./llm/pricing.js";
import { formatDuration, VERDICT_LABEL } from "./report/html.js";
import { loadSuite } from "./suite/config.js";
import { runSuite, SUITE_HTML, SUMMARY_JSON, type SuiteSummary } from "./suite/runner.js";
import type { RunLimits, StepRecord } from "./types.js";
import { VERSION } from "./version.js";

/** Exit codes: 0 pass, 1 the app failed a test, 2 qa-pilot could not finish (limits, config, provider). */
export const EXIT = { pass: 0, fail: 1, error: 2 } as const;

function number(name: string) {
  return (value: string) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0)
      throw new InvalidArgumentError(`${name} must be a non-negative number`);
    return n;
  };
}

function loadDotEnv(): void {
  // Keys are read from the environment; a local .env is loaded if present.
  // Existing variables win. Values are never printed.
  if (existsSync(".env")) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // A malformed .env should not stop the CLI.
    }
  }
}

interface ProviderFlags {
  provider: string;
  model?: string;
  effort?: Effort;
}

interface LimitFlags {
  maxSteps?: number;
  maxCost?: number;
  actionTimeout?: number;
  timeout?: number;
  retries?: number;
}

function limitsFrom(flags: LimitFlags): Partial<RunLimits> {
  const out: Partial<RunLimits> = {};
  if (flags.maxSteps !== undefined) out.maxSteps = flags.maxSteps;
  if (flags.maxCost !== undefined) out.maxCostUsd = flags.maxCost;
  if (flags.actionTimeout !== undefined) out.actionTimeoutMs = flags.actionTimeout * 1000;
  if (flags.timeout !== undefined) out.runTimeoutMs = flags.timeout * 1000;
  if (flags.retries !== undefined) out.llmRetries = flags.retries;
  return out;
}

function providerFrom(flags: ProviderFlags) {
  return createProvider({
    provider: flags.provider,
    ...(flags.model ? { model: flags.model } : {}),
    ...(flags.effort ? { effort: flags.effort } : {}),
  });
}

function addProviderOptions(cmd: Command): Command {
  return cmd
    .addOption(
      new Option("-p, --provider <name>", "model provider")
        .choices([...PROVIDERS])
        .default("anthropic"),
    )
    .option(
      "-m, --model <id>",
      `model id (default ${defaultModel("anthropic")} or ${defaultModel("gemini")})`,
    )
    .addOption(
      new Option("--effort <level>", "Anthropic thinking effort").choices([
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]),
    );
}

function addLimitOptions(
  cmd: Command,
  costHelp = "stop before spending more than this many USD",
): Command {
  return cmd
    .option("--max-steps <n>", "stop after this many steps (default 25)", number("--max-steps"))
    .option("--max-cost <usd>", `${costHelp} (default 1.00)`, number("--max-cost"))
    .option(
      "--action-timeout <seconds>",
      "per-action timeout (default 10)",
      number("--action-timeout"),
    )
    .option("--timeout <seconds>", "whole-run timeout (default 300)", number("--timeout"))
    .option("--retries <n>", "model call retries with backoff (default 3)", number("--retries"));
}

const isTTY = process.stdout.isTTY;
const color = (code: number) => (text: string) =>
  isTTY ? `\u001b[${code}m${text}\u001b[0m` : text;
const green = color(32);
const red = color(31);
const yellow = color(33);
const dim = color(2);

function printStep(step: StepRecord): void {
  const outcome =
    step.outcome === "ok"
      ? green(step.proposed.type === "assert" ? "held" : "ok")
      : step.outcome === "failed"
        ? red("FAILED")
        : yellow("error");
  const cost = step.llm ? `, ${formatUsd(step.llm.costUsd)}` : "";
  console.log(
    `  ${String(step.index).padStart(2)}. ${step.intent} ${dim(`(${describeStep(step)})`)} ${outcome} ${dim(`${formatDuration(step.durationMs)}${cost}`)}`,
  );
  if (step.error)
    console.log(`      ${step.outcome === "failed" ? red(step.error) : yellow(step.error)}`);
}

function verdictText(verdict: "pass" | "fail" | "error"): string {
  const label = VERDICT_LABEL[verdict];
  return verdict === "pass" ? green(label) : verdict === "fail" ? red(label) : yellow(label);
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("qa-pilot")
    .description(
      "Test web apps from plain-English instructions, then replay them as Playwright tests.",
    )
    .version(VERSION)
    .showHelpAfterError()
    // Throw instead of exiting so main() can choose the exit code.
    .exitOverride();

  const run = program
    .command("run")
    .description("run one instruction against a URL and report pass or fail")
    .argument("<instruction>", "what to test, in plain English")
    .requiredOption("-u, --url <url>", "page to start on")
    .option("-n, --name <name>", "name for the run folder and report")
    .option("-o, --out <dir>", "parent folder for run folders", "qa-pilot-runs")
    .option(
      "--export [file]",
      "after a passing run, write a Playwright spec (default: into the run folder)",
    )
    .option("--headed", "show the browser")
    .option("--no-video", "do not record a video");
  addProviderOptions(run);
  addLimitOptions(run);
  run.action(
    async (
      instruction: string,
      flags: ProviderFlags &
        LimitFlags & {
          url: string;
          name?: string;
          out: string;
          export?: string | boolean;
          headed?: boolean;
          video: boolean;
        },
    ) => {
      const provider = providerFrom(flags);
      console.log(`qa-pilot ${VERSION}: ${provider.name}/${provider.model}`);
      console.log(`${instruction}\n${dim(flags.url)}\n`);
      const { record, runDir } = await runAgent({
        instruction,
        url: flags.url,
        provider,
        ...(flags.name ? { name: flags.name } : {}),
        outputDir: flags.out,
        headless: !flags.headed,
        video: flags.video,
        limits: limitsFrom(flags),
        onStep: printStep,
      });
      console.log(`\n${verdictText(record.verdict)}: ${record.summary}`);
      console.log(
        dim(
          `${record.steps.length} steps, ${formatUsd(record.totals.costUsd)}, ${formatDuration(record.durationMs)}`,
        ),
      );
      console.log(`Report: ${path.relative(process.cwd(), path.join(runDir, REPORT_FILE))}`);
      if (flags.export && record.verdict === "pass") {
        const out = typeof flags.export === "string" ? flags.export : undefined;
        const { file } = await exportRun(runDir, out);
        console.log(`Spec:   ${path.relative(process.cwd(), file)}`);
      } else if (flags.export) {
        console.log(dim("No spec exported: only passing runs are exported."));
      }
      process.exitCode = EXIT[record.verdict];
    },
  );

  const suite = program
    .command("suite")
    .description("run every test in a suite YAML file")
    .argument("<file>", "suite file, e.g. tests.yaml")
    .option(
      "-b, --base-url <url>",
      "run against this base URL instead of the suite's (e.g. a preview deployment)",
    )
    .option("-t, --tag <tag...>", "only run tests with one of these tags")
    .option("-o, --out <dir>", "parent folder for suite folders", "qa-pilot-runs")
    .option(
      "--max-suite-cost <usd>",
      "stop starting tests once the suite has spent this much",
      number("--max-suite-cost"),
    )
    .option("--export-dir <dir>", "write a Playwright spec for each passing test into this folder")
    .option("--headed", "show the browser")
    .option("--no-video", "do not record videos");
  addProviderOptions(suite);
  addLimitOptions(suite, "per-test cost limit in USD");
  suite.action(
    async (
      file: string,
      flags: ProviderFlags &
        LimitFlags & {
          baseUrl?: string;
          tag?: string[];
          out: string;
          maxSuiteCost?: number;
          exportDir?: string;
          headed?: boolean;
          video: boolean;
        },
    ) => {
      const definition = await loadSuite(file);
      const provider = providerFrom(flags);
      console.log(`qa-pilot ${VERSION}: ${definition.name} (${provider.name}/${provider.model})\n`);
      const { summary, suiteDir } = await runSuite({
        suite: definition,
        suiteFile: file,
        provider,
        ...(flags.baseUrl ? { baseUrl: flags.baseUrl } : {}),
        ...(flags.tag ? { tags: flags.tag } : {}),
        outputDir: flags.out,
        ...(flags.maxSuiteCost !== undefined ? { maxSuiteCostUsd: flags.maxSuiteCost } : {}),
        ...(flags.exportDir ? { exportDir: flags.exportDir } : {}),
        headless: !flags.headed,
        video: flags.video,
        limits: limitsFrom(flags),
        onTestStart: (t, i, n) => console.log(`[${i + 1}/${n}] ${t.name} ${dim(t.startUrl)}`),
        onStep: printStep,
        onTestEnd: (r) => {
          const verdict = r.verdict === "skipped" ? dim("Skipped") : verdictText(r.verdict);
          const note = r.asExpected
            ? dim(`as expected (${r.expect})`)
            : red(`expected ${r.expect}`);
          console.log(`  ${verdict}, ${note}: ${r.summary}\n`);
        },
      });
      const t = summary.totals;
      console.log(
        `${summary.ok ? green("Suite ok") : red("Suite not ok")}: ${t.asExpected} of ${t.tests} as expected, ${formatUsd(t.costUsd)}, ${formatDuration(summary.durationMs)}`,
      );
      console.log(`Report: ${path.relative(process.cwd(), path.join(suiteDir, SUITE_HTML))}`);
      process.exitCode = summary.ok
        ? EXIT.pass
        : summary.totals.errors > 0 && summary.totals.failed === 0
          ? EXIT.error
          : EXIT.fail;
    },
  );

  program
    .command("export")
    .description("write a Playwright spec from a passing run")
    .argument("<run-dir>", "a run folder (or its run.json)")
    .option("-o, --out <path>", "spec file or folder (default: inside the run folder)")
    .option("--name <title>", "test title (default: the run name)")
    .option("--force", "export even if the run did not pass")
    .action(async (runDir: string, flags: { out?: string; name?: string; force?: boolean }) => {
      const { file, record } = await exportRun(runDir, flags.out, {
        ...(flags.name ? { testName: flags.name } : {}),
        ...(flags.force ? { force: true } : {}),
      });
      const replayed = record.steps.filter(
        (s) => s.outcome === "ok" && s.action?.type !== "done",
      ).length;
      console.log(
        `Wrote ${path.relative(process.cwd(), file)} (${replayed} steps). Run it with: npx playwright test ${path.relative(process.cwd(), file)}`,
      );
    });

  const heal = program
    .command("heal")
    .description("re-run an exported spec and repair locators that no longer match")
    .argument("<spec>", "a .spec.ts written by qa-pilot export")
    .option("-u, --url <url>", "base URL to run against (default: the spec's BASE_URL fallback)")
    .option("--write", "save the healed spec (otherwise only print the diff)")
    .option("--headed", "show the browser")
    .option(
      "--max-cost <usd>",
      "stop asking the model after this many USD (default 0.50)",
      number("--max-cost"),
    )
    .option(
      "--action-timeout <seconds>",
      "per-action timeout (default 10)",
      number("--action-timeout"),
    );
  addProviderOptions(heal);
  heal.action(
    async (
      spec: string,
      flags: ProviderFlags & {
        url?: string;
        write?: boolean;
        headed?: boolean;
        maxCost?: number;
        actionTimeout?: number;
      },
    ) => {
      const provider = providerFrom(flags);
      console.log(`qa-pilot ${VERSION}: healing ${spec} with ${provider.name}/${provider.model}\n`);
      const onEvent = (e: HealEvent) => {
        if (e.type === "step") {
          console.log(
            `  line ${e.line}: ${e.title ?? "setup"} ${e.ok ? green("ok") : red(`failed: ${e.error}`)}`,
          );
        } else if (e.type === "broken") {
          console.log(`  line ${e.line}: ${e.title ?? ""} ${yellow(`broken: ${e.error}`)}`);
        } else if (e.type === "proposal") {
          console.log(
            `    proposed ${e.locator} ${e.ok ? green("works") : red(`did not work: ${e.error}`)}`,
          );
          console.log(dim(`    ${e.reasoning}`));
        } else {
          console.log(
            `  re-run of healed spec: ${e.ok ? green("passed") : red(`failed: ${e.error}`)}`,
          );
        }
      };
      const result = await healSpec({
        specFile: spec,
        ...(flags.url ? { baseUrl: flags.url } : {}),
        provider,
        ...(flags.write ? { write: true } : {}),
        headless: !flags.headed,
        limits: {
          ...(flags.maxCost !== undefined ? { maxCostUsd: flags.maxCost } : {}),
          ...(flags.actionTimeout !== undefined
            ? { actionTimeoutMs: flags.actionTimeout * 1000 }
            : {}),
        },
        onEvent,
      });
      console.log("");
      if (result.diff) console.log(result.diff);
      const cost = formatUsd(result.totals.costUsd);
      if (result.status === "passed") {
        console.log(green("The spec passes as it is; nothing to heal."));
        process.exitCode = EXIT.pass;
      } else if (result.status === "healed") {
        console.log(
          `${green(`Healed ${result.changes.length} locator${result.changes.length === 1 ? "" : "s"}`)} (${cost}). ${result.written ? `Saved ${spec}.` : "Run again with --write to save it."}`,
        );
        process.exitCode = EXIT.pass;
      } else {
        console.log(
          red(`Could not heal: line ${result.failure?.line}: ${result.failure?.message}`) +
            dim(` (${cost})`),
        );
        process.exitCode = EXIT.fail;
      }
    },
  );

  program
    .command("github-comment")
    .description("post or update the results comment on a pull request (used by the GitHub Action)")
    .option("--suite-dir <dir>", "suite folder containing summary.json")
    .option("--artifact-path <path>", "where the suite folder sits inside the uploaded artifact")
    .option("--suite-skipped <reason>", "why the AI suite did not run")
    .option("--specs-report <file>", "Playwright JSON report from replaying exported specs")
    .option("--specs-skipped <reason>", "why the specs did not run")
    .option("--base-url <url>", "the URL that was tested")
    .option("--artifact-name <name>", "name of the uploaded artifact")
    .option("--artifact-url <url>", "link to the uploaded artifact")
    .option("--run-url <url>", "link to the workflow run")
    .option(
      "--image-base-url <url>",
      "public URL where the artifact files are hosted, to embed screenshots",
    )
    .option("--repo <owner/name>", "repository (default: GITHUB_REPOSITORY)")
    .option(
      "--pr <number>",
      "pull request number (default: from the workflow event)",
      number("--pr"),
    )
    .option("--output <file>", "also write the comment to this file")
    .option("--no-post", "do not call the GitHub API")
    .action(
      async (flags: {
        suiteDir?: string;
        artifactPath?: string;
        suiteSkipped?: string;
        specsReport?: string;
        specsSkipped?: string;
        baseUrl?: string;
        artifactName?: string;
        artifactUrl?: string;
        runUrl?: string;
        imageBaseUrl?: string;
        repo?: string;
        pr?: number;
        output?: string;
        post: boolean;
      }) => {
        const input: CommentInput = {};
        if (flags.suiteDir) {
          const summary = JSON.parse(
            await readFile(path.join(flags.suiteDir, SUMMARY_JSON), "utf8"),
          ) as SuiteSummary;
          input.suite = {
            summary,
            artifactPath: flags.artifactPath ?? path.basename(flags.suiteDir),
          };
        }
        if (flags.suiteSkipped) input.suiteSkipped = flags.suiteSkipped;
        if (flags.specsReport && existsSync(flags.specsReport)) {
          input.specs = await readPlaywrightReport(flags.specsReport);
        } else if (flags.specsSkipped) {
          input.specsSkipped = flags.specsSkipped;
        }
        for (const key of [
          "baseUrl",
          "artifactName",
          "artifactUrl",
          "runUrl",
          "imageBaseUrl",
        ] as const) {
          if (flags[key]) input[key] = flags[key];
        }
        const body = renderComment(input);
        if (flags.output) await writeFile(flags.output, body);
        if (process.env.GITHUB_STEP_SUMMARY)
          await appendFile(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);

        const repo = flags.repo ?? process.env.GITHUB_REPOSITORY;
        let pr = flags.pr;
        if (
          pr === undefined &&
          process.env.GITHUB_EVENT_PATH &&
          existsSync(process.env.GITHUB_EVENT_PATH)
        ) {
          const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8")) as {
            pull_request?: { number?: number };
          };
          pr = event.pull_request?.number;
        }
        const token = process.env.GITHUB_TOKEN;
        if (!flags.post || !repo || pr === undefined || !token) {
          console.log(body);
          console.log(dim("Not posting: needs --repo, a pull request number and GITHUB_TOKEN."));
          return;
        }
        const result = await upsertComment({
          token,
          repo,
          issue: pr,
          body,
          ...(process.env.GITHUB_API_URL ? { apiUrl: process.env.GITHUB_API_URL } : {}),
        });
        console.log(`${result.action === "created" ? "Posted" : "Updated"} ${result.url}`);
      },
    );

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  loadDotEnv();
  try {
    await buildProgram().parseAsync(argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      // Commander has already printed help, the version or the usage error.
      process.exitCode = err.exitCode === 0 ? EXIT.pass : EXIT.error;
      return;
    }
    console.error(red(`qa-pilot: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = EXIT.error;
  }
}
