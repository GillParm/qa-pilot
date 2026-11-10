import type { Locator, Page } from "playwright";
import type { LocatorSpec } from "../types.js";

type Role = Parameters<Page["getByRole"]>[0];

/** Builds a live Playwright locator from a spec. */
export function toLocator(page: Page, spec: LocatorSpec): Locator {
  let locator: Locator;
  switch (spec.kind) {
    case "role": {
      const options: { name?: string; exact?: boolean } = {};
      if (spec.name !== undefined) {
        options.name = spec.name;
        if (spec.exact) options.exact = true;
      }
      locator = page.getByRole(spec.role as Role, options);
      break;
    }
    case "label":
      locator = page.getByLabel(spec.text, spec.exact ? { exact: true } : undefined);
      break;
    case "text":
      locator = page.getByText(spec.text, spec.exact ? { exact: true } : undefined);
      break;
  }
  return spec.nth === undefined ? locator : locator.nth(spec.nth);
}

/** A JavaScript string literal. JSON escaping is valid JS and avoids quoting bugs. */
export function jsString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Renders a spec as Playwright code, e.g. `page.getByRole("button", { name: "Pay", exact: true })`.
 * `str` turns strings into literals; the exporter swaps it to emit template literals.
 */
export function toCode(
  spec: LocatorSpec,
  pageVar = "page",
  str: (value: string) => string = jsString,
): string {
  const jsString = str;
  let code: string;
  switch (spec.kind) {
    case "role": {
      const opts: string[] = [];
      if (spec.name !== undefined) {
        opts.push(`name: ${jsString(spec.name)}`);
        if (spec.exact) opts.push("exact: true");
      }
      code = `${pageVar}.getByRole(${jsString(spec.role)}${opts.length ? `, { ${opts.join(", ")} }` : ""})`;
      break;
    }
    case "label":
      code = `${pageVar}.getByLabel(${jsString(spec.text)}${spec.exact ? ", { exact: true }" : ""})`;
      break;
    case "text":
      code = `${pageVar}.getByText(${jsString(spec.text)}${spec.exact ? ", { exact: true }" : ""})`;
      break;
  }
  if (spec.nth === undefined) return code;
  return spec.nth === 0 ? `${code}.first()` : `${code}.nth(${spec.nth})`;
}

/** Short human description, used in reports and prompts. */
export function describeLocator(spec: LocatorSpec): string {
  const nth = spec.nth === undefined ? "" : ` #${spec.nth + 1}`;
  switch (spec.kind) {
    case "role":
      return `${spec.role}${spec.name !== undefined ? ` "${spec.name}"` : ""}${nth}`;
    case "label":
      return `field labelled "${spec.text}"${nth}`;
    case "text":
      return `text "${spec.text}"${nth}`;
  }
}

export function sameLocator(a: LocatorSpec, b: LocatorSpec): boolean {
  return toCode(a) === toCode(b);
}
