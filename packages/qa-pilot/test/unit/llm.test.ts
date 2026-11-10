import { describe, expect, it, vi } from "vitest";
import { costOf, formatUsd, priceFor } from "../../src/llm/pricing.js";
import { backoffDelay, withRetries } from "../../src/llm/retry.js";
import { LLMError } from "../../src/llm/types.js";

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
});

describe("costOf", () => {
  it("prices Claude Opus 5.5 at $4 in and $20 out per million tokens", () => {
    expect(costOf("claude-opus-5-5", usage(1_000_000, 0))).toBeCloseTo(4);
    expect(costOf("claude-opus-5-5", usage(0, 1_000_000))).toBeCloseTo(20);
    expect(costOf("claude-opus-5-5", usage(2_500, 600))).toBeCloseTo(0.01 + 0.012);
  });

  it("charges cache reads at the listed rate and writes at 1.25x input by default", () => {
    expect(costOf("claude-opus-5-5", usage(0, 0, 1_000_000))).toBeCloseTo(0.2);
    expect(costOf("claude-opus-5-5", usage(0, 0, 0, 1_000_000))).toBeCloseTo(5);
  });

  it("prices Gemini at paid-tier rates", () => {
    expect(costOf("gemini-3.5-flash-lite", usage(1_000_000, 1_000_000))).toBeCloseTo(2.8);
  });

  it("returns undefined for unknown models and honours overrides", () => {
    expect(costOf("mystery-model", usage(10, 10))).toBeUndefined();
    expect(costOf("mystery-model", usage(1_000_000, 0), { "mystery-model": { input: 3, output: 9 } })).toBe(3);
    expect(priceFor("fake")).toEqual({ input: 0, output: 0 });
  });

  it("formats small and large amounts", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(1.234)).toBe("$1.23");
  });
});

describe("backoffDelay", () => {
  it("grows exponentially, applies jitter and caps", () => {
    const fixed = { baseDelayMs: 1000, maxDelayMs: 8000, random: () => 1 };
    expect(backoffDelay(0, fixed)).toBe(1000);
    expect(backoffDelay(2, fixed)).toBe(4000);
    expect(backoffDelay(10, fixed)).toBe(8000);
    expect(backoffDelay(1, { ...fixed, random: () => 0 })).toBe(1000);
  });

  it("waits at least as long as retry-after", () => {
    expect(backoffDelay(0, { baseDelayMs: 1000, maxDelayMs: 8000, random: () => 0, retryAfterMs: 20_000 })).toBe(20_000);
  });
});

describe("withRetries", () => {
  const sleep = vi.fn(async () => {});

  it("retries retryable errors and reports attempts", async () => {
    let calls = 0;
    const { result, attempts } = await withRetries(
      async () => {
        calls++;
        if (calls < 3) throw new LLMError("rate limited", { retryable: true, status: 429 });
        return "ok";
      },
      { retries: 3, sleep, random: () => 0 },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn(async () => {
      throw new LLMError("bad request", { retryable: false, status: 400 });
    });
    await expect(withRetries(fn, { retries: 3, sleep })).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured retries", async () => {
    const fn = vi.fn(async () => {
      throw new LLMError("overloaded", { retryable: true, status: 529 });
    });
    await expect(withRetries(fn, { retries: 2, sleep })).rejects.toThrow("overloaded");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
