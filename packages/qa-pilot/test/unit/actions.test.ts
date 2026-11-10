import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeProposed, parseUrlPattern, resolveUrl } from "../../src/actions/execute.js";
import { ACTION_TOOLS, parseToolCall, ToolInputError } from "../../src/actions/tools.js";
import { captureSnapshot } from "../../src/snapshot/capture.js";

describe("ACTION_TOOLS", () => {
  it("defines exactly the six actions", () => {
    expect(ACTION_TOOLS.map((t) => t.name)).toEqual([
      "click",
      "type",
      "select",
      "navigate",
      "assert",
      "done",
    ]);
  });

  it("requires intent and reasoning on every tool and forbids extra fields", () => {
    for (const tool of ACTION_TOOLS) {
      expect(tool.parameters.required).toContain("intent");
      expect(tool.parameters.required).toContain("reasoning");
      expect(tool.parameters.additionalProperties).toBe(false);
    }
  });
});

describe("parseToolCall", () => {
  const base = { intent: "Do it", reasoning: "Because" };

  it("parses a click", () => {
    expect(parseToolCall("click", { ...base, ref: "e4" })).toEqual({
      action: { type: "click", ref: "e4" },
      intent: "Do it",
      reasoning: "Because",
    });
  });

  it("parses each assert kind and checks its required field", () => {
    expect(parseToolCall("assert", { ...base, kind: "url_matches", pattern: "/cart" }).action).toEqual(
      { type: "assert", kind: "url_matches", pattern: "/cart" },
    );
    expect(() => parseToolCall("assert", { ...base, kind: "input_value", ref: "e1" })).toThrow(
      /needs "value"/,
    );
  });

  it("rejects unknown tools and bad input with a message the model can act on", () => {
    expect(() => parseToolCall("scroll", base)).toThrow(ToolInputError);
    expect(() => parseToolCall("done", { ...base, status: "maybe", summary: "x" })).toThrow(
      /invalid done input: status/,
    );
  });
});

describe("parseUrlPattern and resolveUrl", () => {
  it("treats plain text as an escaped substring", () => {
    const re = parseUrlPattern("/cart?step=1");
    expect(re.test("http://x.test/cart?step=1")).toBe(true);
    expect(re.test("http://x.test/cartXstep=1")).toBe(false);
  });

  it("accepts /regex/ literals", () => {
    expect(parseUrlPattern("/\\/products\\/\\d+$/").test("http://x.test/products/12")).toBe(true);
  });

  it("resolves relative URLs against the current page", () => {
    expect(resolveUrl("/cart", "http://localhost:3200/products/1")).toBe("http://localhost:3200/cart");
    expect(resolveUrl("https://a.test/x", "about:blank")).toBe("https://a.test/x");
  });
});

describe("executeProposed", () => {
  let browser: Browser;
  let page: Page;
  const opts = { actionTimeoutMs: 1_000, actionRetries: 1 };

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });
  afterAll(async () => {
    await browser.close();
  });

  const html = `
    <label>Email <input type="email"></label>
    <label for="qty">Quantity</label>
    <select id="qty"><option value="1">One</option><option value="3">Three</option></select>
    <button onclick="document.getElementById('out').textContent = 'Saved ' + document.querySelector('input').value">Save</button>
    <p id="out"></p>`;

  async function ref(match: RegExp) {
    const snapshot = await captureSnapshot(page);
    const r = snapshot.text.split("\n").find((l) => match.test(l))?.match(/\[ref=(\w+)\]/)?.[1];
    if (!r) throw new Error(snapshot.text);
    return { snapshot, ref: r };
  }

  it("types, selects, clicks and records the locators it used", async () => {
    await page.setContent(html);
    let s = await ref(/textbox "Email"/);
    const typed = await executeProposed(page, { type: "type", ref: s.ref, text: "ada@example.com" }, s.snapshot, opts);
    expect(typed.outcome).toBe("ok");
    expect(typed.action).toEqual({
      type: "type",
      locator: { kind: "label", text: "Email", exact: true },
      text: "ada@example.com",
    });

    s = await ref(/combobox "Quantity"/);
    const selected = await executeProposed(page, { type: "select", ref: s.ref, option: "Three" }, s.snapshot, opts);
    expect(selected.outcome).toBe("ok");

    s = await ref(/button "Save"/);
    const clicked = await executeProposed(page, { type: "click", ref: s.ref }, s.snapshot, opts);
    expect(clicked.action).toEqual({
      type: "click",
      locator: { kind: "role", role: "button", name: "Save", exact: true },
    });
    expect(clicked.target).toEqual({ role: "button", name: "Save" });
  });

  it("passes and fails text assertions", async () => {
    const snapshot = await captureSnapshot(page);
    const pass = await executeProposed(
      page,
      { type: "assert", kind: "text_visible", text: "Saved ada@example.com" },
      snapshot,
      opts,
    );
    expect(pass.outcome).toBe("ok");
    const fail = await executeProposed(
      page,
      { type: "assert", kind: "text_visible", text: "Welcome back" },
      snapshot,
      opts,
    );
    expect(fail.outcome).toBe("failed");
    expect(fail.error).toMatch(/was not visible/);
  });

  it("checks a select's value by label and records the option value", async () => {
    const s = await ref(/combobox "Quantity"/);
    const result = await executeProposed(
      page,
      { type: "assert", kind: "input_value", ref: s.ref, value: "Three" },
      s.snapshot,
      opts,
    );
    expect(result.outcome).toBe("ok");
    expect(result.action).toMatchObject({ kind: "input_value", value: "3" });
  });

  it("reports a bad ref as an error the model can recover from", async () => {
    const snapshot = await captureSnapshot(page);
    const result = await executeProposed(page, { type: "click", ref: "e999" }, snapshot, opts);
    expect(result.outcome).toBe("error");
    expect(result.error).toMatch(/not in the current snapshot/);
  });
});
