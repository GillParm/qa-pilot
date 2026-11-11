import { describe, expect, it } from "vitest";
import { exportSpec } from "../../src/export/spec.js";
import { parseSpec, SpecParseError } from "../../src/heal/parse.js";
import type { ExecutedAction } from "../../src/types.js";
import { cartRun } from "../helpers/records.js";

const env = { BASE_URL: "http://preview.test", RUN: "qanew01" };

describe("parseSpec", () => {
  it("round-trips an exported spec back into the recorded actions", () => {
    const record = cartRun();
    const parsed = parseSpec(exportSpec(record), env);

    expect(parsed.testName).toBe("Cart total updates");
    expect(parsed.defaultBaseUrl).toBe("http://localhost:3200");
    expect(parsed.metadata?.run).toBe(record.id);

    // The first statement is the start goto, outside any test.step.
    expect(parsed.steps[0]?.title).toBeUndefined();
    expect(parsed.steps[0]?.statements[0]?.action).toEqual({
      type: "navigate",
      url: "http://preview.test/",
    });

    const replayed = parsed.steps.slice(1);
    const expected = record.steps.filter((s) => s.action && s.action.type !== "done");
    expect(replayed.map((s) => s.title)).toEqual(expected.map((s) => s.intent));

    // Values are re-evaluated: BASE_URL points at the preview, RUN is the new token.
    const swap = (a: ExecutedAction): ExecutedAction => {
      const json = JSON.stringify(a)
        .replaceAll("http://localhost:3200", "http://preview.test")
        .replaceAll("qatoken", "qanew01");
      return JSON.parse(json) as ExecutedAction;
    };
    const actions = replayed.map((s) => s.statements[0]!.action);
    expect(actions).toEqual(
      expected.map((s) => {
        const a = swap(s.action!);
        // Regex patterns come back in /.../ form.
        return a.type === "assert" && a.kind === "url_matches" ? { ...a, pattern: "/\\/cart/" } : a;
      }),
    );
  });

  it("records the source range of each interaction's locator", () => {
    const source = exportSpec(cartRun());
    const parsed = parseSpec(source, env);
    const click = parsed.steps[1]!.statements[0]!;
    expect(click.locatorRange).toBeDefined();
    expect(source.slice(click.locatorRange!.start, click.locatorRange!.end)).toBe(
      'page.getByRole("button", { name: "Add to cart", exact: true }).nth(1)',
    );
    expect(click.line).toBeGreaterThan(5);
  });

  it("accepts a hand-written spec in the same style", () => {
    const source = `
import { test, expect } from "@playwright/test";
test("hand written", async ({ page }) => {
  await page.goto("https://shop.test/");
  await page.getByText("Sign up").first().click();
  await page.getByLabel("Email").fill("x@y.z");
  await expect(page.getByRole("heading", { name: "Welcome" })).toBeVisible();
});`;
    const parsed = parseSpec(source, env);
    expect(parsed.steps.map((s) => s.statements[0]!.action)).toEqual([
      { type: "navigate", url: "https://shop.test/" },
      { type: "click", locator: { kind: "text", text: "Sign up", nth: 0 } },
      { type: "type", locator: { kind: "label", text: "Email" }, text: "x@y.z" },
      {
        type: "assert",
        kind: "element_visible",
        locator: { kind: "role", role: "heading", name: "Welcome" },
      },
    ]);
  });

  it("explains what it cannot replay", () => {
    const source = `
import { test } from "@playwright/test";
test("x", async ({ page }) => {
  await page.locator("#buy").click();
});`;
    expect(() => parseSpec(source, env)).toThrow(SpecParseError);
    expect(() => parseSpec(source, env)).toThrow(/line 4: unsupported statement/);
  });
});
