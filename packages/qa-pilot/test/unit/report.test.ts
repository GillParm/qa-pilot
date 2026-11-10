import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  formatDuration,
  renderReport,
  scriptJson,
  writeReport,
} from "../../src/report/html.js";
import { cartRun, step } from "../helpers/records.js";

describe("report helpers", () => {
  it("escapes HTML", () => {
    expect(escapeHtml(`<img src=x onerror="a">'&`)).toBe(
      "&lt;img src=x onerror=&quot;a&quot;&gt;&#39;&amp;",
    );
  });

  it("keeps embedded JSON from closing the script tag", () => {
    const json = scriptJson({ text: "</script><script>alert(1)</script>" });
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json)).toEqual({ text: "</script><script>alert(1)</script>" });
  });

  it("formats durations", () => {
    expect(formatDuration(420)).toBe("420 ms");
    expect(formatDuration(3_400)).toBe("3.4 s");
    expect(formatDuration(125_000)).toBe("2 min 5 s");
  });
});

describe("renderReport", () => {
  it("shows the verdict, instruction, facts and one strip per step", () => {
    const html = renderReport(cartRun());
    expect(html).toContain('<span class="stamp condensed v-pass">Passed</span>');
    expect(html).toContain("Add the trail mug to the cart, set quantity to 3");
    expect(html).toContain("<dt>Steps</dt><dd>9 of 25</dd>");
    expect(html.match(/<li class="strip /g)).toHaveLength(10); // start + 9 steps
    expect(html).toContain(
      "await page.getByRole(&quot;button&quot;, { name: &quot;Add to cart&quot;, exact: true }).nth(1).click();",
    );
  });

  it("escapes model-written text", () => {
    const html = renderReport(cartRun({ instruction: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("opens the failing step and shows its error", () => {
    const record = cartRun({ verdict: "fail", summary: "Assertion failed at step 5" });
    record.steps[4] = {
      ...record.steps[4]!,
      outcome: "failed",
      error: 'text "$54.00" was not visible within 10s',
    };
    record.steps = record.steps.slice(0, 5);
    const html = renderReport(record);
    expect(html).toContain('v-fail">Failed</span>');
    expect(html).toMatch(/<li class="strip k-assert o-failed" id="step-5">\s*<details open>/);
    expect(html).toContain("was not visible within 10s");
    expect(html).toContain("Assertion failed");
  });

  it("lists console errors and failed requests, and links the video", () => {
    const record = cartRun({
      video: "video.webm",
      console: [{ type: "error", text: "boom", at: "t" }],
      network: [
        { method: "GET", url: "http://x/api", status: 500, resourceType: "fetch", at: "t" },
      ],
      steps: [
        step({ type: "click", ref: "e1" }, undefined, {
          outcome: "error",
          error: "ref e1 is not in the current snapshot",
          console: [{ type: "error", text: "boom", at: "t" }],
        }),
      ],
    });
    const html = renderReport(record);
    expect(html).toContain("Console errors (1)");
    expect(html).toContain("GET http://x/api: 500");
    expect(html).toContain('<video controls preload="metadata" src="video.webm">');
    expect(html).toContain("Console error: boom");
  });

  it("embeds the run as JSON for tooling", () => {
    const record = cartRun();
    const html = renderReport(record);
    const match = html.match(/<script type="application\/json" id="qa-pilot-run">(.*)<\/script>/);
    expect(JSON.parse(match![1]!).id).toBe(record.id);
  });
});

describe("writeReport", () => {
  it("inlines screenshots as data URIs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "qa-pilot-report-"));
    try {
      await mkdir(path.join(dir, "steps"));
      // A 1x1 PNG.
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64",
      );
      await writeFile(path.join(dir, "steps", "01.png"), png);
      const record = cartRun();
      record.steps[0] = { ...record.steps[0]!, screenshot: "steps/01.png" };
      const file = await writeReport(record, dir);
      const html = await readFile(file, "utf8");
      expect(html).toContain(`src="data:image/png;base64,${png.toString("base64")}"`);
      expect(html).not.toContain('src="steps/01.png"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
