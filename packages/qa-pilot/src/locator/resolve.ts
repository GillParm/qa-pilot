import type { ElementHandle, Locator, Page } from "playwright";
import type { PageSnapshot } from "../snapshot/capture.js";
import { accessibleName, normalizeText, type AriaNode } from "../snapshot/tree.js";
import type { ElementInfo, LocatorSpec } from "../types.js";
import { toLocator } from "./spec.js";

/** Form controls, where getByLabel reads most naturally. */
const LABELLED_ROLES = new Set([
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "spinbutton",
  "slider",
  "switch",
  "listbox",
]);

/** Above this many matches, a locator is too vague to be worth an nth index. */
const MAX_NTH_CANDIDATES = 50;

export class RefError extends Error {
  override name = "RefError";
}

export interface ResolvedTarget {
  locator: LocatorSpec;
  element: ElementInfo;
  handle: ElementHandle;
}

/** Candidate locators for an element, most readable first. */
export function locatorCandidates(role: string, name: string): LocatorSpec[] {
  const out: LocatorSpec[] = [];
  if (name && LABELLED_ROLES.has(role)) out.push({ kind: "label", text: name, exact: true });
  if (name) out.push({ kind: "role", role, name, exact: true });
  if (name && (role === "generic" || role === "paragraph" || role === "cell")) {
    out.push({ kind: "text", text: name, exact: true });
  }
  out.push({ kind: "role", role });
  return out;
}

async function isElement(locator: Locator, handle: ElementHandle): Promise<boolean> {
  return locator.evaluate((el, target) => el === target, handle).catch(() => false);
}

/**
 * Finds a locator for `handle`. Prefers a locator that matches only this
 * element; otherwise uses the first candidate plus an nth index.
 */
export async function locatorForHandle(
  page: Page,
  handle: ElementHandle,
  candidates: LocatorSpec[],
): Promise<LocatorSpec | undefined> {
  const counts: number[] = [];
  for (const candidate of candidates) {
    const locator = toLocator(page, candidate);
    const count = await locator.count();
    counts.push(count);
    if (count === 1 && (await isElement(locator, handle))) return candidate;
  }
  for (const [i, candidate] of candidates.entries()) {
    const count = counts[i] ?? 0;
    if (count < 2 || count > MAX_NTH_CANDIDATES) continue;
    const locator = toLocator(page, candidate);
    for (let n = 0; n < count; n++) {
      if (await isElement(locator.nth(n), handle)) return { ...candidate, nth: n };
    }
  }
  return undefined;
}

export function elementInfo(node: AriaNode): ElementInfo {
  const name = accessibleName(node);
  return name ? { role: node.role, name } : { role: node.role };
}

/**
 * Turns a snapshot ref into a role/label/text locator that points at the same
 * element. Call this before taking another snapshot: refs only resolve against
 * the latest one.
 */
export async function resolveRef(
  page: Page,
  ref: string,
  snapshot: PageSnapshot,
  timeoutMs = 5_000,
): Promise<ResolvedTarget> {
  const node = snapshot.refs.get(ref);
  if (!node) throw new RefError(`ref "${ref}" is not in the current snapshot`);

  const handle = await page
    .getByRef(ref)
    .elementHandle({ timeout: timeoutMs })
    .catch(() => null);
  if (!handle) throw new RefError(`ref "${ref}" no longer points at an element on the page`);

  const element = elementInfo(node);
  const locator = await locatorForHandle(
    page,
    handle,
    locatorCandidates(node.role, normalizeText(element.name ?? "")),
  );
  if (!locator) {
    throw new RefError(
      `could not build a role, label or text locator for ${node.role} ${element.name ? `"${element.name}"` : ""} (ref ${ref})`,
    );
  }
  return { locator, element, handle };
}
