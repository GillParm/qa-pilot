import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT, main } from "../../src/cli.js";
import { VERSION } from "../../src/version.js";
import { cartRun } from "../helpers/records.js";

describe("qa-pilot CLI", () => {
  let dir: string;
  let out: string[];
  let err: string[];
  const saved = { ...process.env };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "qa-pilot-cli-"));
    out = [];
    err = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
    vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
      out.push(String(s));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((s: string | Uint8Array) => {
      err.push(String(s));
      return true;
    });
    process.exitCode = undefined;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env = { ...saved };
    process.exitCode = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  const cli = (...args: string[]) => main(["node", "qa-pilot", ...args]);

  it("exports a run folder to a spec", async () => {
    const runDir = path.join(dir, "run");
    await mkdir(runDir);
    await writeFile(path.join(runDir, "run.json"), JSON.stringify(cartRun()));
    await cli("export", runDir, "--out", path.join(dir, "specs"));
    expect(process.exitCode).toBeUndefined();
    const spec = await readFile(path.join(dir, "specs", "cart-total-updates.spec.ts"), "utf8");
    expect(spec).toContain('test("Cart total updates"');
    expect(out.join("\n")).toMatch(/Wrote .*cart-total-updates\.spec\.ts \(8 steps\)/);
  });

  it("refuses to export a failed run without --force", async () => {
    const runDir = path.join(dir, "failed");
    await mkdir(runDir);
    await writeFile(path.join(runDir, "run.json"), JSON.stringify(cartRun({ verdict: "fail" })));
    await cli("export", runDir);
    expect(process.exitCode).toBe(EXIT.error);
    expect(err.join("\n")).toMatch(/only passing runs export cleanly/);
  });

  it("explains a missing API key instead of crashing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    await cli("run", "Check the home page", "--url", "http://127.0.0.1:9");
    expect(process.exitCode).toBe(EXIT.error);
    expect(err.join("\n")).toContain("set ANTHROPIC_API_KEY to use the Anthropic provider");
  });

  it("rejects bad options with exit code 2", async () => {
    await cli("run", "x", "--url", "http://a.test", "--max-cost", "lots");
    expect(process.exitCode).toBe(EXIT.error);
    expect(err.join("")).toContain("--max-cost must be a non-negative number");
  });

  it("reports suite file problems clearly", async () => {
    const suite = path.join(dir, "bad.yaml");
    await writeFile(suite, "name: x\ntests:\n  - name: a\n");
    await cli("suite", suite);
    expect(process.exitCode).toBe(EXIT.error);
    expect(err.join("\n")).toMatch(/tests\.0\.instruction/);
  });

  it("prints the version, which matches package.json", async () => {
    const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
    await cli("--version");
    expect(out.join("")).toContain(VERSION);
    expect(process.exitCode).toBe(EXIT.pass);
  });
});
