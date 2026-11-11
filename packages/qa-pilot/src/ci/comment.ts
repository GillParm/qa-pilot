import { formatDuration } from "../report/html.js";
import { cell, renderSuiteMarkdown } from "../suite/markdown.js";
import type { SuiteSummary, TestResult } from "../suite/runner.js";
import type { SpecResult } from "./playwright-report.js";

/** Hidden marker that identifies qa-pilot's comment, so reruns update it instead of adding more. */
export const COMMENT_MARKER = "<!-- qa-pilot-report -->";

export interface CommentInput {
  /** The AI suite's summary, and the suite folder's path inside the uploaded artifact. */
  suite?: { summary: SuiteSummary; artifactPath: string };
  /** Why the AI suite did not run, e.g. no API key in a fork. */
  suiteSkipped?: string;
  specs?: SpecResult[];
  specsSkipped?: string;
  baseUrl?: string;
  artifactName?: string;
  artifactUrl?: string;
  runUrl?: string;
  /**
   * Public URL where the artifact's files are hosted (for example a Pages or
   * bucket upload of the report folder). When set, failing screenshots are
   * embedded; GitHub cannot show images from workflow artifacts directly.
   */
  imageBaseUrl?: string;
}

function joinUrl(base: string, ...parts: string[]): string {
  return [base.replace(/\/+$/, ""), ...parts.map((p) => p.replace(/^\/+|\/+$/g, ""))].join("/");
}

function screenshotNote(r: TestResult, input: CommentInput): string | undefined {
  const shot = r.failedStep?.screenshot;
  if (!shot || !r.runDir || !input.suite) return undefined;
  const relative = [input.suite.artifactPath, r.runDir, shot].join("/").replace(/\\/g, "/");
  if (input.imageBaseUrl) {
    return `<br>![Step ${r.failedStep!.index}](${joinUrl(input.imageBaseUrl, relative)})`;
  }
  return `<br>Screenshot: \`${cell(relative, 160)}\``;
}

/** The sticky pull request comment: AI suite results, replayed specs and where the evidence is. */
export function renderComment(input: CommentInput): string {
  const lines: string[] = [COMMENT_MARKER, "## qa-pilot results", ""];

  const links: string[] = [];
  if (input.artifactUrl) {
    links.push(`[Download the reports and screenshots](${input.artifactUrl})`);
  }
  if (input.runUrl) links.push(`[workflow run](${input.runUrl})`);
  const target = input.baseUrl ? `Tested ${input.baseUrl}.` : "";
  lines.push([target, links.join(", ")].filter(Boolean).join(" "));
  lines.push("");

  if (input.suite) {
    lines.push(
      renderSuiteMarkdown(input.suite.summary, {
        level: 3,
        title: `AI suite: ${cell(input.suite.summary.name, 80)}`,
        extra: (r) => (r.asExpected ? undefined : screenshotNote(r, input)),
      }).trimEnd(),
    );
  } else {
    lines.push("### AI suite", "", `Not run: ${input.suiteSkipped ?? "no suite was given"}.`);
  }
  lines.push("");

  if (input.specs) {
    const failed = input.specs.filter((s) => s.status === "failed").length;
    lines.push("### Exported specs, replayed without a model", "");
    lines.push(
      failed === 0
        ? `All ${input.specs.length} passed.`
        : `**${failed} of ${input.specs.length} failed.**`,
    );
    lines.push("", "| Spec | Result | Time | Error |", "| --- | --- | ---: | --- |");
    for (const s of input.specs) {
      const result = s.status === "failed" ? "**failed**" : s.status;
      lines.push(
        `| ${cell(`${s.file} › ${s.title}`, 120)} | ${result} | ${formatDuration(s.durationMs)} | ${cell(s.error ?? "")} |`,
      );
    }
  } else if (input.specsSkipped) {
    lines.push("### Exported specs", "", `Not run: ${input.specsSkipped}.`);
  }
  lines.push("");

  if (!input.imageBaseUrl && input.suite) {
    lines.push(
      `<sub>GitHub comments cannot display images stored in workflow artifacts, so screenshots, videos and the HTML reports are in the ${input.artifactName ? `\`${input.artifactName}\` ` : ""}artifact. Set \`image-base-url\` to embed screenshots from a host you control.</sub>`,
    );
    lines.push("");
  }
  return lines.join("\n");
}

export interface UpsertOptions {
  token: string;
  /** "owner/name" */
  repo: string;
  issue: number;
  body: string;
  apiUrl?: string;
  fetch?: typeof globalThis.fetch;
}

interface IssueComment {
  id: number;
  body?: string;
  html_url: string;
}

/** Creates the qa-pilot comment on a pull request, or updates the one already there. */
export async function upsertComment(
  opts: UpsertOptions,
): Promise<{ action: "created" | "updated"; url: string }> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const api = (opts.apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
  const headers = {
    authorization: `Bearer ${opts.token}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "qa-pilot",
  };
  const request = async (method: string, url: string, body?: unknown) => {
    const res = await fetchFn(url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok)
      throw new Error(
        `GitHub API ${method} ${url} returned ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    return res.json() as Promise<unknown>;
  };

  let existing: IssueComment | undefined;
  for (let page = 1; page <= 10 && !existing; page++) {
    const comments = (await request(
      "GET",
      `${api}/repos/${opts.repo}/issues/${opts.issue}/comments?per_page=100&page=${page}`,
    )) as IssueComment[];
    existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));
    if (comments.length < 100) break;
  }

  if (existing) {
    const updated = (await request(
      "PATCH",
      `${api}/repos/${opts.repo}/issues/comments/${existing.id}`,
      {
        body: opts.body,
      },
    )) as IssueComment;
    return { action: "updated", url: updated.html_url };
  }
  const created = (await request(
    "POST",
    `${api}/repos/${opts.repo}/issues/${opts.issue}/comments`,
    {
      body: opts.body,
    },
  )) as IssueComment;
  return { action: "created", url: created.html_url };
}
