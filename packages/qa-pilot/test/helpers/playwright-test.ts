import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Generated specs live inside the package so `@playwright/test` resolves from node_modules. */
export const GENERATED_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".generated",
);

export async function generatedDir(name: string): Promise<string> {
  const dir = path.join(GENERATED_DIR, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "playwright.config.mjs"),
    `export default { testDir: ".", reporter: "line", workers: 1, timeout: 20_000, use: { headless: true, actionTimeout: 5_000 }, expect: { timeout: 5_000 } };\n`,
  );
  return dir;
}

/** Runs `playwright test` on one spec and returns the exit code and output. */
export function runPlaywrightTest(
  dir: string,
  specFile: string,
  env: Record<string, string>,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    // Call the CLI script directly: npx would switch to the workspace root.
    const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
    const child = spawn(
      process.execPath,
      [cli, "test", path.basename(specFile), "--config", path.join(dir, "playwright.config.mjs")],
      { cwd: dir, env: { ...process.env, ...env, CI: "1" } },
    );
    let output = "";
    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}
