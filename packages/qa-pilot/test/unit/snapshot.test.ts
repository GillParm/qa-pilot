import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accessibleName,
  indexRefs,
  renderTree,
  toChildren,
  trimTree,
  type AriaChild,
} from "../../src/snapshot/tree.js";

// Captured from Playwright 1.65 `page.ariaSnapshotJSON({ mode: "ai" })`.
const fixture = toChildren(
  JSON.parse(readFileSync(new URL("../fixtures/cart-snapshot.json", import.meta.url), "utf8")),
);

describe("trimTree", () => {
  const trimmed = trimTree(fixture);
  const text = renderTree(trimmed);

  it("hoists unnamed generic wrappers", () => {
    expect(text).not.toMatch(/^- generic \[ref=e1\]/m);
    expect(text.split("\n")[0]).toBe("- banner [ref=e2]:");
  });

  it("keeps clickable generic elements and marks them", () => {
    expect(text).toContain('- generic [clickable] [ref=');
    expect(text).toContain(": Clickable div");
  });

  it("drops images without a name and keeps named ones", () => {
    const imgs = text.split("\n").filter((l) => l.includes("- img"));
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toContain('"Mug photo"');
  });

  it("renders input values, states and link targets", () => {
    expect(text).toContain('textbox "Email" [ref=');
    expect(text).toContain('value="ada@example.com"');
    expect(text).toContain('button "Pay" [disabled]');
    expect(text).toContain('checkbox "Gift wrap" [checked]');
    expect(text).toContain('option "Two" [selected]');
    expect(text).toMatch(/link "Cart \(0\)" \[ref=e\d+\] url=\/cart/);
  });

  it("collapses whitespace in text fragments", () => {
    expect(text).toContain("- text: lots of space");
  });

  it("does not render cursor or focus noise", () => {
    expect(text).not.toContain("cursor=");
    expect(text).not.toContain("[active]");
  });
});

describe("trim limits", () => {
  it("truncates long text", () => {
    const long = "word ".repeat(100);
    const out = trimTree([{ role: "paragraph", text: long }], { maxTextLength: 20, maxOptions: 5 });
    const node = out[0];
    expect(typeof node === "object" && node.text?.length).toBe(20);
    expect(typeof node === "object" && node.text?.endsWith("…")).toBe(true);
  });

  it("caps long option lists", () => {
    const options: AriaChild[] = Array.from({ length: 30 }, (_, i) => ({
      role: "option",
      name: `Option ${i}`,
    }));
    const out = trimTree([{ role: "combobox", name: "Country", ref: "e1", children: options }], {
      maxTextLength: 100,
      maxOptions: 10,
    });
    const text = renderTree(out);
    expect(text.match(/- option/g)).toHaveLength(10);
    expect(text).toContain("… 20 more options");
  });

  it("stops at the line cap and says how much was left out", () => {
    const items: AriaChild[] = Array.from({ length: 50 }, (_, i) => ({
      role: "button",
      name: `B${i}`,
      ref: `e${i}`,
    }));
    const text = renderTree(items, { maxLines: 10 });
    expect(text.split("\n")).toHaveLength(11);
    expect(text).toContain("40 more lines not shown");
  });
});

describe("indexRefs and accessibleName", () => {
  const trimmed = trimTree(fixture);
  const refs = indexRefs(trimmed);

  it("indexes every visible ref", () => {
    const buttons = [...refs.values()].filter((n) => n.role === "button");
    expect(buttons.map((b) => b.name)).toEqual(["Pay"]);
  });

  it("derives the name of a heading whose name was omitted", () => {
    const heading = [...refs.values()].find((n) => n.role === "heading" && n.level === 2);
    expect(heading).toBeDefined();
    expect(heading?.name).toBeUndefined();
    expect(accessibleName(heading!)).toBe("Trail mug");
  });
});
