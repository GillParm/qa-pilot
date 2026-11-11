import { readFile } from "node:fs/promises";
import { parse as parseYaml, YAMLParseError } from "yaml";
import { z } from "zod";

const limitsSchema = z
  .object({
    maxSteps: z.number().int().positive().optional(),
    maxCostUsd: z.number().nonnegative().optional(),
    actionTimeoutMs: z.number().int().positive().optional(),
    runTimeoutMs: z.number().int().positive().optional(),
  })
  .strict();

const testSchema = z
  .object({
    name: z.string().trim().min(1),
    instruction: z.string().trim().min(1),
    url: z.string().url().optional(),
    path: z.string().startsWith("/").optional(),
    expect: z.enum(["pass", "fail"]).default("pass"),
    tags: z.array(z.string().min(1)).default([]),
    limits: limitsSchema.optional(),
  })
  .strict()
  .refine((t) => !(t.url && t.path), { message: "use either url or path, not both" });

const suiteSchema = z
  .object({
    name: z.string().trim().min(1),
    baseUrl: z.string().url().optional(),
    limits: limitsSchema.optional(),
    tests: z.array(testSchema).min(1),
  })
  .strict();

export type SuiteLimits = z.infer<typeof limitsSchema>;
export type SuiteTest = z.infer<typeof testSchema>;
export type Suite = z.infer<typeof suiteSchema>;

export interface ResolvedTest extends SuiteTest {
  /** Absolute URL the run starts at. */
  startUrl: string;
}

export class SuiteError extends Error {
  override name = "SuiteError";
}

/** Parses and validates suite YAML. Errors name the field that is wrong. */
export function parseSuite(text: string, source = "suite"): Suite {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    const message = err instanceof YAMLParseError ? err.message.split("\n")[0] : String(err);
    throw new SuiteError(`${source}: invalid YAML: ${message}`);
  }
  const result = suiteSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => {
      const where = i.path.length ? i.path.join(".") : "suite";
      return `${where}: ${i.message}`;
    });
    throw new SuiteError(`${source} is not a valid suite:\n  ${issues.join("\n  ")}`);
  }
  const names = new Set<string>();
  for (const t of result.data.tests) {
    if (names.has(t.name)) throw new SuiteError(`${source}: duplicate test name "${t.name}"`);
    names.add(t.name);
  }
  return result.data;
}

export async function loadSuite(file: string): Promise<Suite> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    throw new SuiteError(`cannot read suite file ${file}`);
  }
  return parseSuite(text, file);
}

/**
 * Works out each test's start URL. A base URL given on the command line (for
 * example a preview deployment) replaces the suite's baseUrl, and also the
 * origin of tests that use a full url.
 */
export function resolveTests(suite: Suite, baseUrlOverride?: string): ResolvedTest[] {
  const base = baseUrlOverride ?? suite.baseUrl;
  return suite.tests.map((t) => {
    let startUrl: string;
    if (t.url) {
      startUrl = t.url;
      if (baseUrlOverride) {
        const u = new URL(t.url);
        startUrl = new URL(u.pathname + u.search + u.hash, baseUrlOverride).toString();
      }
    } else {
      if (!base) {
        throw new SuiteError(`test "${t.name}" has no url, and the suite has no baseUrl (pass --base-url)`);
      }
      startUrl = new URL(t.path ?? "/", base).toString();
    }
    return { ...t, startUrl };
  });
}

export function filterByTags(tests: ResolvedTest[], tags: string[]): ResolvedTest[] {
  if (tags.length === 0) return tests;
  return tests.filter((t) => t.tags.some((tag) => tags.includes(tag)));
}
