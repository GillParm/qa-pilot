import { AnthropicProvider, ANTHROPIC_DEFAULT_MODEL, type Effort } from "./anthropic.js";
import { GeminiProvider, GEMINI_DEFAULT_MODEL } from "./gemini.js";
import { LLMError, type LLMProvider } from "./types.js";

export const PROVIDERS = ["anthropic", "gemini"] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export interface CreateProviderOptions {
  provider: string;
  model?: string;
  effort?: Effort;
}

export function defaultModel(provider: string): string {
  return provider === "gemini" ? GEMINI_DEFAULT_MODEL : ANTHROPIC_DEFAULT_MODEL;
}

/** Builds a real provider from CLI options. Keys come from the environment. */
export function createProvider(opts: CreateProviderOptions): LLMProvider {
  switch (opts.provider) {
    case "anthropic":
      if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
        throw new LLMError("set ANTHROPIC_API_KEY to use the Anthropic provider", { retryable: false });
      }
      return new AnthropicProvider({
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.effort ? { effort: opts.effort } : {}),
      });
    case "gemini":
      return new GeminiProvider(opts.model ? { model: opts.model } : {});
    default:
      throw new LLMError(`unknown provider "${opts.provider}"; use ${PROVIDERS.join(" or ")}`, {
        retryable: false,
      });
  }
}

export * from "./types.js";
export { AnthropicProvider, type Effort } from "./anthropic.js";
export { GeminiProvider } from "./gemini.js";
export { FakeProvider, fake, type FakeTurn, type TargetQuery } from "./fake.js";
export { costOf, formatUsd, PRICES, type ModelPrice } from "./pricing.js";
