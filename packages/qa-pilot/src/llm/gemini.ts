import { ApiError, FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import {
  LLMError,
  type LLMProvider,
  type ToolCallRequest,
  type ToolCallResponse,
} from "./types.js";

export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";

export interface GeminiProviderOptions {
  model?: string;
  apiKey?: string;
  /** Inject a client (tests). */
  client?: Pick<GoogleGenAI, "models">;
}

/** Gemini puts the wait in the error body, e.g. "retryDelay": "37s". */
export function parseRetryDelay(message: string): number | undefined {
  const match = message.match(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/);
  return match ? Math.ceil(Number(match[1]) * 1000) : undefined;
}

export function toGeminiError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  if (err instanceof ApiError) {
    const status = err.status;
    const retryable = status === 429 || status === 408 || status >= 500;
    const after = status === 429 ? parseRetryDelay(err.message) : undefined;
    const summary = err.message.split("\n")[0]?.slice(0, 300) ?? "";
    return new LLMError(`Gemini API error ${status}: ${summary}`, {
      retryable,
      status,
      ...(after !== undefined ? { retryAfterMs: after } : {}),
      cause: err,
    });
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new LLMError("request aborted", { retryable: false, cause: err });
  }
  // fetch failures (DNS, reset connections) surface as TypeError.
  if (err instanceof TypeError) {
    return new LLMError(`could not reach Gemini: ${err.message}`, { retryable: true, cause: err });
  }
  return new LLMError(err instanceof Error ? err.message : String(err), {
    retryable: false,
    cause: err,
  });
}

/**
 * Gemini via function calling. Mode ANY makes the model call one of the
 * declared functions, which suits the one-action-per-step loop.
 */
export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  readonly model: string;
  private readonly client: Pick<GoogleGenAI, "models">;

  constructor(opts: GeminiProviderOptions = {}) {
    this.model = opts.model ?? GEMINI_DEFAULT_MODEL;
    const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!opts.client && !apiKey) {
      throw new LLMError("set GEMINI_API_KEY to use the Gemini provider", { retryable: false });
    }
    this.client = opts.client ?? new GoogleGenAI({ apiKey: apiKey! });
  }

  async call(request: ToolCallRequest): Promise<ToolCallResponse> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: request.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        config: {
          systemInstruction: request.system,
          maxOutputTokens: request.maxOutputTokens ?? 8_192,
          tools: [
            {
              functionDeclarations: request.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parametersJsonSchema: t.parameters,
              })),
            },
          ],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
          ...(request.signal ? { abortSignal: request.signal } : {}),
        },
      });

      const meta = response.usageMetadata;
      const usage = {
        inputTokens: (meta?.promptTokenCount ?? 0) - (meta?.cachedContentTokenCount ?? 0),
        outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
        cacheReadTokens: meta?.cachedContentTokenCount ?? 0,
        cacheWriteTokens: 0,
      };
      const call = response.functionCalls?.[0];
      const finishReason = response.candidates?.[0]?.finishReason;
      const text = call ? undefined : response.text;
      return {
        ...(call?.name ? { toolCall: { name: call.name, input: call.args ?? {} } } : {}),
        ...(text ? { text } : {}),
        usage,
        model: response.modelVersion ?? this.model,
        ...(finishReason ? { stopReason: String(finishReason) } : {}),
      };
    } catch (err) {
      throw toGeminiError(err);
    }
  }
}
