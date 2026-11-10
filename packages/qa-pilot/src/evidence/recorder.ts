import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { ConsoleEntry, NetworkFailure, RunRecord } from "../types.js";

export function slugify(text: string, max = 48): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, max).replace(/-+$/g, "") || "run";
}

/** 2026-11-10T18:45:12.345Z → 20261110-184512 */
export function compactTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

export const RUN_FILE = "run.json";
export const REPORT_FILE = "report.html";
export const VIDEO_FILE = "video.webm";

/**
 * Owns a run folder: collects console errors and failed requests from the
 * page, saves screenshots and the video, and writes run.json.
 */
export class EvidenceRecorder {
  readonly console: ConsoleEntry[] = [];
  readonly network: NetworkFailure[] = [];
  private consoleCursor = 0;
  private networkCursor = 0;

  private constructor(readonly runDir: string) {}

  static async create(outputDir: string, name: string, startedAt: Date): Promise<EvidenceRecorder> {
    const base = `${compactTimestamp(startedAt)}-${slugify(name)}`;
    let runDir = path.resolve(outputDir, base);
    // Two runs in the same second (suites, tests) get a numeric suffix.
    for (let i = 2; ; i++) {
      try {
        await mkdir(runDir, { recursive: false });
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          await mkdir(path.dirname(runDir), { recursive: true });
          continue;
        }
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        runDir = path.resolve(outputDir, `${base}-${i}`);
      }
    }
    await mkdir(path.join(runDir, "steps"), { recursive: true });
    return new EvidenceRecorder(runDir);
  }

  /** Starts listening for console errors, uncaught exceptions and failed requests. */
  attach(page: Page): void {
    const at = () => new Date().toISOString();
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const location = msg.location();
      this.console.push({
        type: "error",
        text: msg.text(),
        ...(location.url ? { url: location.url } : {}),
        at: at(),
      });
    });
    page.on("pageerror", (error) => {
      this.console.push({ type: "pageerror", text: error.message, at: at() });
    });
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText ?? "failed";
      // Requests cancelled by a navigation are not failures of the app.
      if (failure === "net::ERR_ABORTED") return;
      this.network.push({
        method: request.method(),
        url: request.url(),
        failure,
        resourceType: request.resourceType(),
        at: at(),
      });
    });
    page.on("response", (response) => {
      if (response.status() < 400) return;
      const request = response.request();
      this.network.push({
        method: request.method(),
        url: response.url(),
        status: response.status(),
        resourceType: request.resourceType(),
        at: at(),
      });
    });
  }

  /** Console and network entries since the previous call. */
  drain(): { console: ConsoleEntry[]; network: NetworkFailure[] } {
    const result = {
      console: this.console.slice(this.consoleCursor),
      network: this.network.slice(this.networkCursor),
    };
    this.consoleCursor = this.console.length;
    this.networkCursor = this.network.length;
    return result;
  }

  /** Saves a viewport screenshot and returns its path relative to the run folder. */
  async screenshot(page: Page, label: string): Promise<string | undefined> {
    const relative = path.join("steps", `${label}.png`);
    try {
      await page.screenshot({ path: path.join(this.runDir, relative), timeout: 5_000 });
      return relative.split(path.sep).join("/");
    } catch {
      return undefined;
    }
  }

  /** Moves Playwright's randomly named video into the run folder. Call after the context closes. */
  async saveVideo(videoPath: string | undefined): Promise<string | undefined> {
    if (!videoPath) return undefined;
    try {
      await rename(videoPath, path.join(this.runDir, VIDEO_FILE));
      return VIDEO_FILE;
    } catch {
      return undefined;
    }
  }

  async writeRun(record: RunRecord): Promise<string> {
    const file = path.join(this.runDir, RUN_FILE);
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
    return file;
  }
}
