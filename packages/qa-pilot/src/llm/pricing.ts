import type { TokenUsage } from "../types.js";

/** USD per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  /** Prompt-cache reads. Charged at the input price when not listed. */
  cacheRead?: number;
  /** Prompt-cache writes. Charged at 1.25x the input price when not listed. */
  cacheWrite?: number;
}

/**
 * List prices, checked 2026-11-10 against Anthropic's model table and
 * https://aistudio.google.com/docs/pricing (paid tier). Gemini's free tier
 * costs nothing, but runs are still priced at paid rates so the cost limit
 * means the same thing whichever tier a key is on. Thinking tokens are billed
 * as output by both providers and are included in outputTokens.
 */
export const PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  // Prompts up to 100K tokens; qa-pilot's step prompts are far below that.
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  // Introductory price through 2026-12-31; $1.50 / $7.50 from 2027-01-01.
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  fake: { input: 0, output: 0 },
};

export function priceFor(
  model: string,
  overrides: Record<string, ModelPrice> = {},
): ModelPrice | undefined {
  return overrides[model] ?? PRICES[model];
}

/** Cost in USD, or undefined when the model has no known price. */
export function costOf(
  model: string,
  usage: TokenUsage,
  overrides: Record<string, ModelPrice> = {},
): number | undefined {
  const price = priceFor(model, overrides);
  if (!price) return undefined;
  const perToken = (perMillion: number) => perMillion / 1_000_000;
  return (
    usage.inputTokens * perToken(price.input) +
    usage.outputTokens * perToken(price.output) +
    usage.cacheReadTokens * perToken(price.cacheRead ?? price.input) +
    usage.cacheWriteTokens * perToken(price.cacheWrite ?? price.input * 1.25)
  );
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}
