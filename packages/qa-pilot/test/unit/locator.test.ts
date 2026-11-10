import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveRef, RefError } from "../../src/locator/resolve.js";
import { describeLocator, toCode } from "../../src/locator/spec.js";
import { captureSnapshot } from "../../src/snapshot/capture.js";

describe("toCode", () => {
  it("renders role locators with exact names", () => {
    expect(toCode({ kind: "role", role: "button", name: "Add to cart", exact: true })).toBe(
      'page.getByRole("button", { name: "Add to cart", exact: true })',
    );
  });

  it("renders nth as first() or nth()", () => {
    expect(toCode({ kind: "role", role: "button", name: "Add", nth: 0 })).toBe(
      'page.getByRole("button", { name: "Add" }).first()',
    );
    expect(toCode({ kind: "role", role: "link", nth: 3 })).toBe('page.getByRole("link").nth(3)');
  });

  it("renders label and text locators", () => {
    expect(toCode({ kind: "label", text: "Email", exact: true })).toBe(
      'page.getByLabel("Email", { exact: true })',
    );
    expect(toCode({ kind: "text", text: "Total: $54.00" })).toBe('page.getByText("Total: $54.00")');
  });

  it("escapes quotes and backslashes safely", () => {
    const code = toCode({ kind: "text", text: 'He said "hi" \\ bye' });
    expect(code).toBe('page.getByText("He said \\"hi\\" \\\\ bye")');
  });

  it("describes locators for humans", () => {
    expect(describeLocator({ kind: "role", role: "button", name: "Pay", nth: 1 })).toBe(
      'button "Pay" #2',
    );
  });
});

describe("resolveRef", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });
  afterAll(async () => {
    await browser.close();
  });

  async function refFor(predicate: (line: string) => boolean) {
    const snapshot = await captureSnapshot(page);
    const line = snapshot.text.split("\n").find(predicate);
    const ref = line?.match(/\[ref=(\w+)\]/)?.[1];
    if (!ref) throw new Error(`no ref in snapshot:\n${snapshot.text}`);
    return { snapshot, ref };
  }

  it("uses getByLabel for labelled form fields", async () => {
    await page.setContent(`<label>Email <input type="email"></label>`);
    const { snapshot, ref } = await refFor((l) => l.includes("textbox"));
    const target = await resolveRef(page, ref, snapshot);
    expect(target.locator).toEqual({ kind: "label", text: "Email", exact: true });
    expect(target.element).toEqual({ role: "textbox", name: "Email" });
  });

  it("uses getByRole with an exact name for buttons", async () => {
    await page.setContent(`<button>Add to cart</button><button>Add to cart and pay</button>`);
    const { snapshot, ref } = await refFor((l) => l.includes('"Add to cart"'));
    const target = await resolveRef(page, ref, snapshot);
    expect(target.locator).toEqual({
      kind: "role",
      role: "button",
      name: "Add to cart",
      exact: true,
    });
  });

  it("adds nth when several elements share a role and name", async () => {
    await page.setContent(
      `<ul><li>Mug <button>Add to cart</button></li><li>Tote <button>Add to cart</button></li></ul>`,
    );
    const snapshot = await captureSnapshot(page);
    const refs = [...snapshot.text.matchAll(/button "Add to cart" \[ref=(\w+)\]/g)].map(
      (m) => m[1]!,
    );
    expect(refs).toHaveLength(2);
    const second = await resolveRef(page, refs[1]!, snapshot);
    expect(second.locator).toEqual({
      kind: "role",
      role: "button",
      name: "Add to cart",
      exact: true,
      nth: 1,
    });
    expect(toCode(second.locator)).toBe(
      'page.getByRole("button", { name: "Add to cart", exact: true }).nth(1)',
    );
  });

  it("derives a name for headings whose snapshot name is omitted", async () => {
    await page.setContent(`<h2><a href="#mug">Trail mug</a></h2>`);
    const { snapshot, ref } = await refFor((l) => l.includes("heading"));
    const target = await resolveRef(page, ref, snapshot);
    expect(target.locator).toEqual({
      kind: "role",
      role: "heading",
      name: "Trail mug",
      exact: true,
    });
  });

  it("rejects refs that are not in the snapshot", async () => {
    await page.setContent(`<button>Pay</button>`);
    const snapshot = await captureSnapshot(page);
    await expect(resolveRef(page, "e999", snapshot)).rejects.toBeInstanceOf(RefError);
  });
});
