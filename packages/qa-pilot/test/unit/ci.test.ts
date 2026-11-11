import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { COMMENT_MARKER, renderComment, upsertComment } from "../../src/ci/comment.js";
import { parsePlaywrightReport } from "../../src/ci/playwright-report.js";
import { summarize, type TestResult } from "../../src/suite/runner.js";

// A real report from `playwright test --reporter=json` (paths shortened).
const report = JSON.parse(
  readFileSync(new URL("../fixtures/playwright-report.json", import.meta.url), "utf8"),
);

describe("parsePlaywrightReport", () => {
  it("reads one result per test with the first error line", () => {
    const specs = parsePlaywrightReport(report);
    expect(specs).toHaveLength(2);
    const failed = specs.find((s) => s.file === "assert.spec.ts")!;
    expect(failed).toMatchObject({ title: "Mini add to cart", status: "failed" });
    expect(failed.error).toBe("TimeoutError: locator.click: Timeout 3000ms exceeded.");
    const passed = specs.find((s) => s.file === "written.spec.ts")!;
    expect(passed.status).toBe("passed");
    expect(passed.error).toBeUndefined();
    expect(passed.durationMs).toBeGreaterThan(0);
  });

  it("copes with an empty report", () => {
    expect(parsePlaywrightReport({})).toEqual([]);
  });
});

const result = (over: Partial<TestResult>): TestResult => ({
  name: "Order total follows the quantity",
  instruction: "Add the mug and set quantity 3",
  tags: [],
  expect: "pass",
  startUrl: "http://localhost:3200/",
  verdict: "pass",
  asExpected: true,
  summary: "Fine.",
  steps: 6,
  costUsd: 0.12,
  durationMs: 30_000,
  ...over,
});

const summary = summarize(
  [
    result({ name: "Adding to the cart updates the cart count" }),
    result({
      verdict: "fail",
      asExpected: false,
      summary: "Assertion failed at step 5",
      runDir: "20261110-120000-order-total",
      failedStep: {
        index: 5,
        intent: "Check the total",
        error: "not visible",
        screenshot: "steps/05.png",
      },
    }),
  ],
  {
    name: "Tin & Ember demo shop",
    provider: "anthropic",
    model: "claude-opus-5-5",
    startedAt: "2026-11-10T00:00:00Z",
    finishedAt: "2026-11-10T00:02:00Z",
    durationMs: 120_000,
  },
);

describe("renderComment", () => {
  it("starts with the marker and shows both sections", () => {
    const body = renderComment({
      suite: { summary, artifactPath: "suite" },
      specs: parsePlaywrightReport(report),
      baseUrl: "http://localhost:3200",
      artifactName: "qa-pilot-report",
      artifactUrl: "https://github.com/o/r/actions/runs/1/artifacts/2",
      runUrl: "https://github.com/o/r/actions/runs/1",
    });
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain(
      "Tested http://localhost:3200. [Download the reports and screenshots](https://github.com/o/r/actions/runs/1/artifacts/2), [workflow run](https://github.com/o/r/actions/runs/1)",
    );
    expect(body).toContain("### AI suite: Tin & Ember demo shop");
    expect(body).toContain("Screenshot: `suite/20261110-120000-order-total/steps/05.png`");
    expect(body).toContain("### Exported specs, replayed without a model");
    expect(body).toContain("**1 of 2 failed.**");
    expect(body).toContain("cannot display images stored in workflow artifacts");
  });

  it("embeds screenshots when the files are hosted somewhere", () => {
    const body = renderComment({
      suite: { summary, artifactPath: "suite" },
      imageBaseUrl: "https://reports.example.com/pr-12/",
    });
    expect(body).toContain(
      "![Step 5](https://reports.example.com/pr-12/suite/20261110-120000-order-total/steps/05.png)",
    );
    expect(body).not.toContain("cannot display images");
  });

  it("says why sections were skipped", () => {
    const body = renderComment({
      suiteSkipped: "no ANTHROPIC_API_KEY secret is available to this workflow",
      specsSkipped: "no specs folder was given",
    });
    expect(body).toContain("Not run: no ANTHROPIC_API_KEY secret is available to this workflow.");
    expect(body).toContain("Not run: no specs folder was given.");
  });
});

describe("upsertComment", () => {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

  it("updates the existing qa-pilot comment", async () => {
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "GET") {
        return json([
          { id: 1, body: "unrelated", html_url: "u1" },
          { id: 7, body: `${COMMENT_MARKER}\nold`, html_url: "u7" },
        ]);
      }
      return json({ id: 7, html_url: `patched ${String(url)}` });
    });
    const result = await upsertComment({ token: "t", repo: "o/r", issue: 12, body: "new", fetch });
    expect(result.action).toBe("updated");
    const [url, init] = fetch.mock.calls[1]!;
    expect(String(url)).toBe("https://api.github.com/repos/o/r/issues/comments/7");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ body: "new" });
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer t");
  });

  it("creates a comment when there is none", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === "GET" ? json([]) : json({ id: 9, html_url: "created" }, 201),
    );
    const result = await upsertComment({ token: "t", repo: "o/r", issue: 12, body: "b", fetch });
    expect(result).toEqual({ action: "created", url: "created" });
    expect(String(fetch.mock.calls[1]![0])).toBe(
      "https://api.github.com/repos/o/r/issues/12/comments",
    );
  });

  it("reports API errors with the status", async () => {
    const fetch = vi.fn(
      async () => new Response("Resource not accessible by integration", { status: 403 }),
    );
    await expect(
      upsertComment({ token: "t", repo: "o/r", issue: 1, body: "b", fetch }),
    ).rejects.toThrow(/returned 403: Resource not accessible/);
  });
});
