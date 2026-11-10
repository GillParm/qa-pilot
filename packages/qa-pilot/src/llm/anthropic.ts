import Anthropic from "@anthropic-ai/sdk";
import {
  LLMError,
  type LLMProvider,
  type ToolCallRequest,
  type ToolCallResponse,
} from "./types.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicProviderOptions {
  model?: string;
  apiKey?: string;
  /** Thinking depth. Opus 5.5 always thinks; effort is the only control. */
  effort?: Effort;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  /** Inject a client (tests). */
  client?: Anthropic;
}

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

function retryAfterMs(headers: Headers | undefined): number | undefined {
  const value = headers?.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/** Maps SDK errors onto LLMError, most specific first. */
export function toLLMError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new LLMError("Anthropic request timed out", { retryable: true, cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LLMError(`could not reach Anthropic: ${err.message}`, {
      retryable: true,
      cause: err,
    });
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new LLMError("Anthropic rejected the API key (401)", {
      retryable: false,
      status: 401,
      cause: err,
    });
  }
  if (err instanceof Anthropic.RateLimitError) {
    const after = retryAfterMs(err.headers);
    return new LLMError("Anthropic rate limit (429)", {
      retryable: true,
      status: 429,
      ...(after !== undefined ? { retryAfterMs: after } : {}),
      cause: err,
    });
  }
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    // 408, 409, 5xx and 529 (overloaded) are worth another try.
    const retryable = status === undefined || status === 408 || status === 409 || status >= 500;
    return new LLMError(`Anthropic API error ${status ?? ""}: ${err.message}`.trim(), {
      retryable,
      ...(status !== undefined ? { status } : {}),
      cause: err,
    });
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new LLMError("request aborted", { retryable: false, cause: err });
  }
  return new LLMError(err instanceof Error ? err.message : String(err), {
    retryable: false,
    cause: err,
  });
}

/**
 * Claude via tool use. Each step is one stateless request; the model must call
 * one of the supplied tools. Opus 5.5 rejects forced tool_choice, so the
 * request uses `auto` with parallel calls disabled and the prompt says to call
 * exactly one tool. Tool schemas are strict, so inputs match the schema.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;
  private readonly effort: Effort;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.model = opts.model ?? ANTHROPIC_DEFAULT_MODEL;
    this.effort = opts.effort ?? "medium";
    this.client =
      opts.client ??
      new Anthropic({
        ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
        // Retries are handled by qa-pilot so they are counted and capped per run.
        maxRetries: 0,
        timeout: opts.timeoutMs ?? 120_000,
      });
  }

  async call(request: ToolCallRequest): Promise<ToolCallResponse> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: request.maxOutputTokens ?? 16_000,
          system: request.system,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
          tools: request.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
            strict: true,
          })),
          tool_choice: { type: "auto", disable_parallel_tool_use: true },
          output_config: { effort: this.effort },
          // On a policy decline, let the API retry on its default fallback model.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        request.signal ? { signal: request.signal } : undefined,
      );
    } catch (err) {
      throw toLLMError(err);
    }

    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };

    if (response.stop_reason === "refusal") {
      const details = response.stop_details;
      throw new LLMError(
        `the model declined the request${details?.category ? ` (${details.category})` : ""}`,
        { retryable: false, refusal: true },
      );
    }

    let toolCall: ToolCallResponse["toolCall"];
    const texts: string[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use" && !toolCall)
        toolCall = { name: block.name, input: block.input };
      else if (block.type === "text") texts.push(block.text);
    }
    if (toolCall && response.stop_reason === "max_tokens") {
      throw new LLMError("tool input was cut off at max_tokens", { retryable: true });
    }

    return {
      ...(toolCall ? { toolCall } : {}),
      ...(texts.length ? { text: texts.join("\n") } : {}),
      usage,
      model: response.model,
      ...(response.stop_reason ? { stopReason: response.stop_reason } : {}),
    };
  }
}
