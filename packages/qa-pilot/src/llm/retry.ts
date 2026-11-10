import { LLMError } from "./types.js";

export interface RetryOptions {
  /** Attempts after the first one. */
  retries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  /** Injected in tests so they don't sleep. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injected in tests to make jitter predictable. */
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; error: LLMError }) => void;
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Exponential backoff with jitter: base * 2^attempt, scaled by a random factor
 * in [0.5, 1), capped at maxDelayMs. A server-sent retry-after wins when it is
 * longer.
 */
export function backoffDelay(
  attempt: number,
  opts: { baseDelayMs: number; maxDelayMs: number; retryAfterMs?: number; random: () => number },
): number {
  const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
  const jittered = Math.round(exp * (0.5 + opts.random() * 0.5));
  if (opts.retryAfterMs !== undefined) return Math.max(jittered, opts.retryAfterMs);
  return jittered;
}

/** Runs `fn`, retrying retryable LLMErrors. Returns the result and how many attempts it took. */
export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<{ result: T; attempts: number }> {
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return { result: await fn(attempt), attempts: attempt + 1 };
    } catch (err) {
      const retryable = err instanceof LLMError && err.retryable;
      if (!retryable || attempt >= opts.retries || opts.signal?.aborted) throw err;
      const delayMs = backoffDelay(attempt, {
        baseDelayMs: opts.baseDelayMs ?? 1_000,
        maxDelayMs: opts.maxDelayMs ?? 30_000,
        ...(err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}),
        random,
      });
      opts.onRetry?.({ attempt: attempt + 1, delayMs, error: err });
      await sleep(delayMs, opts.signal);
    }
  }
}
