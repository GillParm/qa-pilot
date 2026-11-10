import { costOf, formatUsd, type ModelPrice } from "../llm/pricing.js";
import type { RunLimits, RunTotals, TokenUsage } from "../types.js";

export const DEFAULT_LIMITS: RunLimits = {
  maxSteps: 25,
  maxCostUsd: 1,
  actionTimeoutMs: 10_000,
  runTimeoutMs: 5 * 60_000,
  llmRetries: 3,
  actionRetries: 2,
  maxConsecutiveErrors: 3,
};

export function resolveLimits(partial: Partial<RunLimits> = {}): RunLimits {
  const limits = { ...DEFAULT_LIMITS };
  for (const [key, value] of Object.entries(partial) as [keyof RunLimits, number | undefined][]) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`limit ${key} must be a non-negative number, got ${value}`);
    }
    limits[key] = value;
  }
  if (limits.maxSteps < 1) throw new Error("maxSteps must be at least 1");
  return limits;
}

export interface ChargeResult {
  costUsd: number;
  /** True when neither the serving nor the requested model has a known price. */
  unpriced: boolean;
}

/**
 * Tracks steps, tokens, cost and time for one run, and says when to stop.
 * Cost is checked before each model call by projecting the most expensive call
 * so far, so a run stops before it crosses the limit, not after.
 */
export class Budget {
  readonly totals: RunTotals = {
    steps: 0,
    llmCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
  readonly unpricedModels = new Set<string>();
  private maxCallCost = 0;
  private readonly startedAt: number;

  constructor(
    readonly limits: RunLimits,
    private readonly prices: Record<string, ModelPrice> = {},
    private readonly now: () => number = Date.now,
  ) {
    this.startedAt = now();
  }

  get elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  get remainingMs(): number {
    return Math.max(0, this.limits.runTimeoutMs - this.elapsedMs);
  }

  /** Records one model call. `requestedModel` is used for pricing when the served model is unknown. */
  charge(servedModel: string, requestedModel: string, usage: TokenUsage): ChargeResult {
    this.totals.llmCalls += 1;
    this.totals.inputTokens += usage.inputTokens;
    this.totals.outputTokens += usage.outputTokens;
    this.totals.cacheReadTokens += usage.cacheReadTokens;
    this.totals.cacheWriteTokens += usage.cacheWriteTokens;
    const cost = costOf(servedModel, usage, this.prices) ?? costOf(requestedModel, usage, this.prices);
    if (cost === undefined) {
      this.unpricedModels.add(servedModel);
      return { costUsd: 0, unpriced: true };
    }
    this.totals.costUsd += cost;
    this.maxCallCost = Math.max(this.maxCallCost, cost);
    return { costUsd: cost, unpriced: false };
  }

  countStep(): void {
    this.totals.steps += 1;
  }

  /** Reason to stop before starting another step, if any. */
  stopReasonBeforeStep(): string | undefined {
    if (this.totals.steps >= this.limits.maxSteps) {
      return `step limit reached (${this.limits.maxSteps} steps)`;
    }
    if (this.elapsedMs >= this.limits.runTimeoutMs) {
      return `run timeout reached (${Math.round(this.limits.runTimeoutMs / 1000)}s)`;
    }
    return this.stopReasonBeforeCall();
  }

  /** Reason not to make another model call, if any. */
  stopReasonBeforeCall(): string | undefined {
    const projected = this.totals.costUsd + this.maxCallCost;
    if (this.totals.costUsd >= this.limits.maxCostUsd || projected > this.limits.maxCostUsd) {
      return `cost limit reached (${formatUsd(this.totals.costUsd)} spent, limit ${formatUsd(this.limits.maxCostUsd)})`;
    }
    return undefined;
  }
}
