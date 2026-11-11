import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

/**
 * Starts the demo shop three times (bugs on, bugs off, renamed button) for the
 * integration tests. Set QA_PILOT_DEMO_BUGS_ON / _OFF / _RENAMED to reuse
 * servers that are already running (CI starts its own).
 */
const DEMO_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../demo-shop",
);

const INSTANCES = [
  { key: "demoBugsOn", envVar: "QA_PILOT_DEMO_BUGS_ON", port: 3201, env: { DEMO_BUGS: "on" } },
  { key: "demoBugsOff", envVar: "QA_PILOT_DEMO_BUGS_OFF", port: 3202, env: { DEMO_BUGS: "off" } },
  {
    key: "demoRenamed",
    envVar: "QA_PILOT_DEMO_RENAMED",
    port: 3203,
    env: { DEMO_BUGS: "off", DEMO_RENAME: "1" },
  },
] as const;

declare module "vitest" {
  export interface ProvidedContext {
    demoBugsOn: string;
    demoBugsOff: string;
    demoRenamed: string;
  }
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`demo shop did not start at ${url} within ${timeoutMs / 1000}s`);
}

export default async function setup(project: TestProject) {
  const started: ChildProcess[] = [];
  const needsServer = INSTANCES.some((i) => !process.env[i.envVar]);
  if (needsServer && !existsSync(path.join(DEMO_DIR, ".next", "BUILD_ID"))) {
    const build = spawnSync("npx", ["next", "build"], { cwd: DEMO_DIR, stdio: "inherit" });
    if (build.status !== 0) throw new Error("building the demo shop failed");
  }

  for (const instance of INSTANCES) {
    const existing = process.env[instance.envVar];
    if (existing) {
      project.provide(instance.key, existing);
      continue;
    }
    const url = `http://127.0.0.1:${instance.port}`;
    const child = spawn(
      "npx",
      ["next", "start", "--port", String(instance.port), "--hostname", "127.0.0.1"],
      {
        cwd: DEMO_DIR,
        env: { ...process.env, ...instance.env },
        stdio: "ignore",
        detached: true,
      },
    );
    started.push(child);
    await waitFor(url, 60_000);
    project.provide(instance.key, url);
  }

  return async () => {
    for (const child of started) {
      // Kill the whole process group: npx starts next as a child.
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  };
}
