import type { ToolSpec } from "../actions/tools.js";
import type { PageSnapshot } from "../snapshot/capture.js";
import type { TokenUsage } from "../types.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolCallRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /**
   * Structured context for scripted providers, which pick elements by role and
   * name instead of reading the prompt. Real providers ignore it.
   */
  context?: { purpose: "step" | "heal"; snapshot?: PageSnapshot };
}

export interface ToolCall {
  name: string;
  input: unknown;
}

export interface ToolCallResponse {
  toolCall?: ToolCall;
  /** Any plain text the model returned alongside (or instead of) a tool call. */
  text?: string;
  usage: TokenUsage;
  /** The model that actually served the request (it can differ after a fallback). */
  model: string;
  stopReason?: string;
}

/** A model that can pick one tool per request. */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  call(request: ToolCallRequest): Promise<ToolCallResponse>;
}

export interface LLMErrorOptions {
  retryable: boolean;
  status?: number;
  retryAfterMs?: number;
  refusal?: boolean;
  cause?: unknown;
}

/** Provider failure, normalised so retries and reporting work the same for every provider. */
export class LLMError extends Error {
  override name = "LLMError";
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly refusal: boolean;

  constructor(message: string, opts: LLMErrorOptions) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.retryable = opts.retryable;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
    this.refusal = opts.refusal ?? false;
  }
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}
