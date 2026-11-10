import type { Locator, Page } from "playwright";
import { RefError, resolveRef } from "../locator/resolve.js";
import { describeLocator, toLocator } from "../locator/spec.js";
import type { PageSnapshot } from "../snapshot/capture.js";
import type { ElementInfo, ExecutedAction, LocatorSpec, ProposedAction, StepOutcome } from "../types.js";

export interface ExecuteOptions {
  actionTimeoutMs: number;
  /** Extra attempts for click/type/select/navigate after a transient failure. */
  actionRetries: number;
}

export interface ExecuteResult {
  outcome: StepOutcome;
  action?: ExecutedAction;
  target?: ElementInfo;
  error?: string;
}

/** Turns "cart" into /cart/ and "/^\/cart$/" into that regex. */
export function parseUrlPattern(pattern: string): RegExp {
  const literal = pattern.match(/^\/(.+)\/([dgimsuvy]*)$/);
  if (literal) {
    try {
      return new RegExp(literal[1]!, literal[2]);
    } catch {
      // Not a valid regex; fall through and treat it as plain text.
    }
  }
  return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"));
}

export function resolveUrl(url: string, current: string): string {
  try {
    return new URL(url, current === "about:blank" ? undefined : current).toString();
  } catch {
    return url;
  }
}

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  // Playwright errors carry a long call log; the first line is what matters.
  return message.split("\n")[0]!.trim();
}

function isTransient(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /detached|intercepts pointer events|not stable|navigation|Execution context was destroyed|net::ERR_ABORTED/i.test(
    message,
  );
}

async function withRetries<T>(retries: number, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransient(err) || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** Waits for the page to stop loading after an action, without failing if it never idles. */
export async function settle(page: Page, timeoutMs = 2_000): Promise<void> {
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
}

async function poll(timeoutMs: number, check: () => Promise<boolean>): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check().catch(() => false)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Current value of an input, plus the selected label for a <select>. */
async function readValues(locator: Locator, timeoutMs: number): Promise<{ value: string; label?: string }> {
  return locator.evaluate(
    (el) => {
      if (el instanceof HTMLSelectElement) {
        return { value: el.value, label: el.selectedOptions[0]?.label ?? "" };
      }
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return { value: el.value };
      return { value: el.textContent ?? "" };
    },
    undefined,
    { timeout: timeoutMs },
  );
}

/**
 * Runs one executed action against the page. Used both by the agent (after
 * resolving refs) and by the healer when it replays an exported spec.
 */
export async function performAction(
  page: Page,
  action: ExecutedAction,
  opts: ExecuteOptions,
): Promise<{ outcome: StepOutcome; error?: string; action: ExecutedAction }> {
  const timeout = opts.actionTimeoutMs;
  try {
    switch (action.type) {
      case "click":
        await withRetries(opts.actionRetries, () => toLocator(page, action.locator).click({ timeout }));
        await settle(page);
        return { outcome: "ok", action };
      case "type":
        await withRetries(opts.actionRetries, () =>
          toLocator(page, action.locator).fill(action.text, { timeout }),
        );
        return { outcome: "ok", action };
      case "select":
        await withRetries(opts.actionRetries, () =>
          toLocator(page, action.locator).selectOption(action.option, { timeout }),
        );
        await settle(page);
        return { outcome: "ok", action };
      case "navigate":
        await withRetries(opts.actionRetries, () =>
          page.goto(action.url, { timeout, waitUntil: "load" }),
        );
        await settle(page);
        return { outcome: "ok", action };
      case "done":
        return { outcome: "ok", action };
      case "assert":
        return await performAssert(page, action, timeout);
    }
  } catch (err) {
    return { outcome: "error", error: errorMessage(err), action };
  }
}

async function performAssert(
  page: Page,
  action: Extract<ExecutedAction, { type: "assert" }>,
  timeout: number,
): Promise<{ outcome: StepOutcome; error?: string; action: ExecutedAction }> {
  const seconds = `${(timeout / 1000).toFixed(0)}s`;
  switch (action.kind) {
    case "text_visible": {
      const locator = toLocator(page, action.locator);
      const visible = await poll(timeout, () => locator.first().isVisible());
      if (!visible) {
        return {
          outcome: "failed",
          error: `text "${action.text}" was not visible within ${seconds}`,
          action,
        };
      }
      // Several matches are fine for "is this text on the page"; pin the first
      // so the exported expect() is not a strict-mode violation.
      if (action.locator.nth === undefined && (await locator.count()) > 1) {
        return { outcome: "ok", action: { ...action, locator: { ...action.locator, nth: 0 } } };
      }
      return { outcome: "ok", action };
    }
    case "element_visible": {
      const locator = toLocator(page, action.locator);
      const visible = await poll(timeout, () => locator.isVisible());
      return visible
        ? { outcome: "ok", action }
        : {
            outcome: "failed",
            error: `${describeLocator(action.locator)} was not visible within ${seconds}`,
            action,
          };
    }
    case "url_matches": {
      const regex = parseUrlPattern(action.pattern);
      const ok = await poll(timeout, async () => regex.test(page.url()));
      return ok
        ? { outcome: "ok", action }
        : {
            outcome: "failed",
            error: `URL ${page.url()} did not match ${regex} within ${seconds}`,
            action,
          };
    }
    case "input_value": {
      const locator = toLocator(page, action.locator);
      let matched: string | undefined;
      let last = "";
      await poll(timeout, async () => {
        const { value, label } = await readValues(locator, timeout);
        last = label ?? value;
        if (value === action.value || label === action.value) {
          matched = value;
          return true;
        }
        return false;
      });
      if (matched === undefined) {
        return {
          outcome: "failed",
          error: `${describeLocator(action.locator)} has value "${last}", expected "${action.value}"`,
          action,
        };
      }
      // For a <select>, record the option's value so toHaveValue() replays it.
      return { outcome: "ok", action: { ...action, value: matched } };
    }
  }
}

/**
 * Resolves the refs in a model's proposed action against the snapshot it saw,
 * then performs it.
 */
export async function executeProposed(
  page: Page,
  proposed: ProposedAction,
  snapshot: PageSnapshot,
  opts: ExecuteOptions,
): Promise<ExecuteResult> {
  let action: ExecutedAction;
  let target: ElementInfo | undefined;

  try {
    const resolve = async (ref: string): Promise<LocatorSpec> => {
      const resolved = await resolveRef(page, ref, snapshot, opts.actionTimeoutMs);
      target = resolved.element;
      return resolved.locator;
    };
    switch (proposed.type) {
      case "click":
        action = { type: "click", locator: await resolve(proposed.ref) };
        break;
      case "type":
        action = { type: "type", locator: await resolve(proposed.ref), text: proposed.text };
        break;
      case "select":
        action = { type: "select", locator: await resolve(proposed.ref), option: proposed.option };
        break;
      case "navigate":
        action = { type: "navigate", url: resolveUrl(proposed.url, page.url()) };
        break;
      case "done":
        action = proposed;
        break;
      case "assert":
        switch (proposed.kind) {
          case "text_visible":
            action = {
              type: "assert",
              kind: "text_visible",
              text: proposed.text,
              locator: { kind: "text", text: proposed.text },
            };
            break;
          case "element_visible":
            action = { type: "assert", kind: "element_visible", locator: await resolve(proposed.ref) };
            break;
          case "url_matches":
            action = { type: "assert", kind: "url_matches", pattern: proposed.pattern };
            break;
          case "input_value":
            action = {
              type: "assert",
              kind: "input_value",
              locator: await resolve(proposed.ref),
              value: proposed.value,
            };
            break;
        }
        break;
    }
  } catch (err) {
    const error = err instanceof RefError ? err.message : errorMessage(err);
    return { outcome: "error", error, ...(target ? { target } : {}) };
  }

  const result = await performAction(page, action, opts);
  return { ...result, ...(target ? { target } : {}) };
}
