import { readFile } from "node:fs/promises";

/** One spec file's outcome from a Playwright JSON report. */
export interface SpecResult {
  file: string;
  title: string;
  status: "passed" | "failed" | "skipped" | "flaky";
  durationMs: number;
  error?: string;
}

interface PwResult {
  status?: string;
  duration?: number;
  error?: { message?: string };
  errors?: { message?: string }[];
}
interface PwTest {
  status?: string;
  results?: PwResult[];
}
interface PwSpec {
  title?: string;
  file?: string;
  tests?: PwTest[];
}
interface PwSuite {
  title?: string;
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}

// Playwright colours its error messages for the terminal.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

function firstLine(message: string | undefined): string | undefined {
  if (!message) return undefined;
  const clean = message.replace(ANSI, "").trim();
  return clean
    .split("\n")
    .find((l) => l.trim())
    ?.trim();
}

/** Flattens the nested suites of a Playwright JSON report into one result per test. */
export function parsePlaywrightReport(json: unknown): SpecResult[] {
  const root = json as { suites?: PwSuite[] };
  const out: SpecResult[] = [];
  const visit = (suite: PwSuite, file: string | undefined) => {
    const current = suite.file ?? file;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const last = results.at(-1);
        const statusMap: Record<string, SpecResult["status"]> = {
          expected: "passed",
          unexpected: "failed",
          skipped: "skipped",
          flaky: "flaky",
        };
        const status =
          statusMap[test.status ?? ""] ?? (last?.status === "passed" ? "passed" : "failed");
        const error = firstLine(last?.error?.message ?? last?.errors?.[0]?.message);
        out.push({
          file: spec.file ?? current ?? "",
          title: spec.title ?? "",
          status,
          durationMs: results.reduce((sum, r) => sum + (r.duration ?? 0), 0),
          ...(error && status !== "passed" ? { error } : {}),
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, current);
  };
  for (const suite of root.suites ?? []) visit(suite, undefined);
  return out;
}

export async function readPlaywrightReport(file: string): Promise<SpecResult[]> {
  return parsePlaywrightReport(JSON.parse(await readFile(file, "utf8")));
}
