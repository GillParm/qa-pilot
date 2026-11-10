import { DEFAULT_LIMITS } from "../../src/agent/limits.js";
import type { ExecutedAction, ProposedAction, RunRecord, StepRecord } from "../../src/types.js";

let counter = 0;

/** Builds a step record with sensible defaults for tests. */
export function step(
  proposed: ProposedAction,
  action: ExecutedAction | undefined,
  extra: Partial<StepRecord> = {},
): StepRecord {
  counter += 1;
  return {
    index: counter,
    intent: `Step ${counter}`,
    reasoning: "Because the instruction says so.",
    proposed,
    ...(action ? { action } : {}),
    outcome: "ok",
    urlBefore: "http://localhost:3200/",
    urlAfter: "http://localhost:3200/",
    startedAt: "2026-11-10T12:00:00.000Z",
    durationMs: 420,
    llm: {
      provider: "fake",
      model: "fake",
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
      attempts: 1,
      latencyMs: 5,
    },
    console: [],
    network: [],
    ...extra,
  };
}

/** A complete passing run through the demo shop's cart, renumbered from 1. */
export function cartRun(overrides: Partial<RunRecord> = {}): RunRecord {
  counter = 0;
  const addToCart = { kind: "role", role: "button", name: "Add to cart", exact: true } as const;
  const steps: StepRecord[] = [
    step(
      { type: "click", ref: "e12" },
      { type: "click", locator: { ...addToCart, nth: 1 } },
      {
        intent: "Add the trail mug to the cart",
        target: { role: "button", name: "Add to cart" },
      },
    ),
    step(
      { type: "assert", kind: "text_visible", text: "Cart (1)" },
      {
        type: "assert",
        kind: "text_visible",
        text: "Cart (1)",
        locator: { kind: "text", text: "Cart (1)" },
      },
      { intent: "Check the cart badge shows one item" },
    ),
    step(
      { type: "navigate", url: "/cart" },
      { type: "navigate", url: "http://localhost:3200/cart" },
      {
        intent: "Open the cart",
        urlAfter: "http://localhost:3200/cart",
      },
    ),
    step(
      { type: "select", ref: "e30", option: "3" },
      {
        type: "select",
        locator: { kind: "label", text: "Quantity for Trail mug", exact: true },
        option: "3",
      },
      { intent: "Set the mug quantity to 3" },
    ),
    step(
      { type: "assert", kind: "text_visible", text: "$54.00" },
      {
        type: "assert",
        kind: "text_visible",
        text: "$54.00",
        locator: { kind: "text", text: "$54.00", nth: 0 },
      },
      { intent: "Check the total is $54.00" },
    ),
    step(
      { type: "assert", kind: "url_matches", pattern: "/cart" },
      { type: "assert", kind: "url_matches", pattern: "/cart" },
      { intent: "Check the cart page is open" },
    ),
    step(
      { type: "type", ref: "e40", text: "ada+qatoken@example.com" },
      {
        type: "type",
        locator: { kind: "label", text: "Email", exact: true },
        text: "ada+qatoken@example.com",
      },
      { intent: "Enter a new email" },
    ),
    step(
      { type: "assert", kind: "input_value", ref: "e40", value: "ada+qatoken@example.com" },
      {
        type: "assert",
        kind: "input_value",
        locator: { kind: "label", text: "Email", exact: true },
        value: "ada+qatoken@example.com",
      },
      { intent: "Check the email field" },
    ),
    step(
      { type: "done", status: "pass", summary: "Total updates." },
      { type: "done", status: "pass", summary: "Total updates." },
      {
        intent: "Finish",
      },
    ),
  ];
  return {
    schemaVersion: 1,
    id: "20261110-120000-cart-total",
    name: "Cart total updates",
    instruction: "Add the trail mug to the cart, set quantity to 3 and check the total is $54.00",
    startUrl: "http://localhost:3200/",
    runToken: "qatoken",
    provider: "fake",
    model: "fake",
    startedAt: "2026-11-10T12:00:00.000Z",
    finishedAt: "2026-11-10T12:00:09.000Z",
    durationMs: 9000,
    verdict: "pass",
    summary: "Total updates.",
    steps,
    totals: {
      steps: steps.length,
      llmCalls: steps.length,
      inputTokens: 9000,
      outputTokens: 900,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
    limits: DEFAULT_LIMITS,
    console: [],
    network: [],
    environment: {
      qaPilotVersion: "0.1.0",
      playwrightVersion: "1.65.0",
      browser: "chromium",
      viewport: { width: 1280, height: 800 },
      headless: true,
    },
    ...overrides,
  };
}
