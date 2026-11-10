import { describe, expect, it } from "vitest";
import { ExportError, exportSpec, literalFactory } from "../../src/export/spec.js";
import { cartRun } from "../helpers/records.js";

describe("literalFactory", () => {
  it("leaves ordinary strings as JSON literals", () => {
    const { str, used } = literalFactory("qa1b2c3");
    expect(str('say "hi"')).toBe('"say \\"hi\\""');
    expect(used()).toBe(false);
  });

  it("swaps the run token for ${RUN} in a template literal", () => {
    const { str, used } = literalFactory("qa1b2c3");
    expect(str("ada+qa1b2c3@example.com")).toBe("`ada+${RUN}@example.com`");
    expect(used()).toBe(true);
  });

  it("escapes backticks and ${ inside template literals", () => {
    const { str } = literalFactory("tok");
    expect(str("a`b${c}tok")).toBe("`a\\`b\\${c}${RUN}`");
  });
});

describe("exportSpec", () => {
  const code = exportSpec(cartRun());

  it("writes a self-contained Playwright test", () => {
    expect(code).toContain('import { expect, test } from "@playwright/test";');
    expect(code).toContain(
      'const BASE_URL = process.env.QA_PILOT_BASE_URL ?? "http://localhost:3200";',
    );
    expect(code).toContain('test("Cart total updates", async ({ page }) => {');
    expect(code).toContain('  await page.goto(new URL("/", BASE_URL).toString());');
  });

  it("records the instruction and source run as metadata", () => {
    expect(code).toContain("// Exported by qa-pilot 0.1.0 from run 20261110-120000-cart-total.");
    expect(code).toContain("// Instruction: Add the trail mug to the cart, set quantity to 3");
    const meta = code.split("\n").find((l) => l.startsWith("// qa-pilot: "))!;
    expect(JSON.parse(meta.slice("// qa-pilot: ".length))).toMatchObject({
      generator: "qa-pilot",
      run: "20261110-120000-cart-total",
      model: "fake/fake",
    });
  });

  it("turns each step into a titled test.step with the recorded locator", () => {
    expect(code).toContain(
      [
        '  await test.step("Add the trail mug to the cart", async () => {',
        '    await page.getByRole("button", { name: "Add to cart", exact: true }).nth(1).click();',
        "  });",
      ].join("\n"),
    );
    expect(code).toContain(
      '    await page.getByLabel("Quantity for Trail mug", { exact: true }).selectOption("3");',
    );
    expect(code).toContain('    await expect(page.getByText("$54.00").first()).toBeVisible();');
    expect(code).toContain('    await page.goto(new URL("/cart", BASE_URL).toString());');
    expect(code).toContain("    await expect(page).toHaveURL(/\\/cart/);");
  });

  it("makes run-token values unique on every replay", () => {
    expect(code).toContain("const RUN = Date.now().toString(36);");
    expect(code).toContain(
      '    await page.getByLabel("Email", { exact: true }).fill(`ada+${RUN}@example.com`);',
    );
    expect(code).toContain(
      '    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(`ada+${RUN}@example.com`);',
    );
  });

  it("keeps the run summary as a comment and skips the done step", () => {
    expect(code).toContain("  // Run summary: Total updates.");
    expect(code).not.toContain('"Finish"');
  });

  it("skips steps that errored", () => {
    const record = cartRun();
    record.steps[0] = { ...record.steps[0]!, outcome: "error", error: "timeout" };
    expect(exportSpec(record)).not.toContain(`test.step("Add the trail mug to the cart"`);
  });

  it("refuses failed runs unless forced", () => {
    const failed = cartRun({ verdict: "fail" });
    expect(() => exportSpec(failed)).toThrow(ExportError);
    expect(exportSpec(failed, { force: true })).toContain("test(");
  });

  it("strips the origin from absolute URL patterns so preview URLs still match", () => {
    const record = cartRun();
    record.steps[5] = {
      ...record.steps[5]!,
      action: { type: "assert", kind: "url_matches", pattern: "http://localhost:3200/cart" },
    };
    expect(exportSpec(record)).toContain("await expect(page).toHaveURL(/\\/cart/);");
  });

  it("produces valid JavaScript", () => {
    // Strip the import and type-free syntax check by compiling as a function body.
    const js = code
      .replace(/^import .*$/m, "")
      .replace(/^test\(/m, "const test = { step: async (_t, fn) => fn() }; void (");
    expect(() => new Function("process", "expect", js)).not.toThrow();
  });
});
