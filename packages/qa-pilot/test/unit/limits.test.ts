import { describe, expect, it } from "vitest";
import { Budget, DEFAULT_LIMITS, resolveLimits } from "../../src/agent/limits.js";

const usage = (inputTokens: number, outputTokens: number) => ({
  inputTokens,
  outputTokens,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

describe("resolveLimits", () => {
  it("fills in defaults", () => {
    expect(resolveLimits()).toEqual(DEFAULT_LIMITS);
    expect(resolveLimits({ maxSteps: 5 }).maxSteps).toBe(5);
    expect(DEFAULT_LIMITS).toMatchObject({ maxSteps: 25, maxCostUsd: 1 });
  });

  it("rejects nonsense", () => {
    expect(() => resolveLimits({ maxCostUsd: -1 })).toThrow(/non-negative/);
    expect(() => resolveLimits({ maxSteps: 0 })).toThrow(/at least 1/);
    expect(() => resolveLimits({ runTimeoutMs: Number.NaN })).toThrow();
  });
});

describe("Budget", () => {
  it("adds up tokens and cost per call", () => {
    const budget = new Budget(resolveLimits());
    const first = budget.charge("claude-opus-5-5", "claude-opus-5-5", usage(2_000, 500));
    expect(first.costUsd).toBeCloseTo(0.008 + 0.01);
    budget.charge("claude-opus-5-5", "claude-opus-5-5", usage(3_000, 0));
    expect(budget.totals).toMatchObject({ llmCalls: 2, inputTokens: 5_000, outputTokens: 500 });
    expect(budget.totals.costUsd).toBeCloseTo(0.03);
  });

  it("stops at the step limit", () => {
    const budget = new Budget(resolveLimits({ maxSteps: 2 }));
    budget.countStep();
    expect(budget.stopReasonBeforeStep()).toBeUndefined();
    budget.countStep();
    expect(budget.stopReasonBeforeStep()).toMatch(/step limit reached \(2 steps\)/);
  });

  it("stops before a call that would cross the cost limit", () => {
    const budget = new Budget(resolveLimits({ maxCostUsd: 0.05 }));
    // $0.02 per call: after two calls ($0.04) a third would reach $0.06.
    budget.charge("claude-opus-5-5", "claude-opus-5-5", usage(5_000, 0));
    expect(budget.stopReasonBeforeCall()).toBeUndefined();
    budget.charge("claude-opus-5-5", "claude-opus-5-5", usage(5_000, 0));
    expect(budget.stopReasonBeforeCall()).toMatch(/cost limit reached \(\$0\.04 spent, limit \$0\.05\)/);
  });

  it("stops when the run timeout passes", () => {
    let now = 1_000;
    const budget = new Budget(resolveLimits({ runTimeoutMs: 500 }), {}, () => now);
    expect(budget.stopReasonBeforeStep()).toBeUndefined();
    now += 600;
    expect(budget.stopReasonBeforeStep()).toMatch(/run timeout/);
    expect(budget.remainingMs).toBe(0);
  });

  it("falls back to the requested model's price and flags unknown models", () => {
    const budget = new Budget(resolveLimits());
    expect(budget.charge("claude-opus-5-5-variant", "claude-opus-5-5", usage(1_000_000, 0)).costUsd).toBeCloseTo(4);
    const unknown = budget.charge("x", "y", usage(10, 10));
    expect(unknown).toEqual({ costUsd: 0, unpriced: true });
    expect([...budget.unpricedModels]).toEqual(["x"]);
  });

  it("uses price overrides", () => {
    const budget = new Budget(resolveLimits(), { fake: { input: 1, output: 1 } });
    expect(budget.charge("fake", "fake", usage(500_000, 500_000)).costUsd).toBeCloseTo(1);
  });
});
