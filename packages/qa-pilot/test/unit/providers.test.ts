import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { ACTION_TOOLS } from "../../src/actions/tools.js";
import { AnthropicProvider, toLLMError } from "../../src/llm/anthropic.js";
import { FakeProvider, fake } from "../../src/llm/fake.js";
import { LLMError } from "../../src/llm/types.js";
import type { PageSnapshot } from "../../src/snapshot/capture.js";
import { indexRefs } from "../../src/snapshot/tree.js";

function mockClient(response: unknown) {
  const create = vi.fn(async () => response);
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

const message = (
  content: unknown[],
  stop_reason = "tool_use",
  extra: Record<string, unknown> = {},
) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  stop_reason,
  stop_details: null,
  usage: {
    input_tokens: 2000,
    output_tokens: 300,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
  ...extra,
});

describe("AnthropicProvider", () => {
  const request = {
    system: "sys",
    messages: [{ role: "user" as const, content: "hello" }],
    tools: ACTION_TOOLS,
  };

  it("sends strict tools, auto tool choice, effort and default fallbacks", async () => {
    const { client, create } = mockClient(
      message([
        {
          type: "tool_use",
          id: "t1",
          name: "click",
          input: { ref: "e1", intent: "x", reasoning: "y" },
        },
      ]),
    );
    const provider = new AnthropicProvider({ client, effort: "low" });
    const res = await provider.call(request);

    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
    expect(params.output_config).toEqual({ effort: "low" });
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("temperature");
    const tools = params.tools as Array<Record<string, unknown>>;
    expect(tools.every((t) => t.strict === true)).toBe(true);

    expect(res.toolCall).toEqual({
      name: "click",
      input: { ref: "e1", intent: "x", reasoning: "y" },
    });
    expect(res.usage).toEqual({
      inputTokens: 2000,
      outputTokens: 300,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(res.model).toBe("claude-opus-5-5");
  });

  it("returns text when the model answers without a tool", async () => {
    const { client } = mockClient(message([{ type: "text", text: "I think..." }], "end_turn"));
    const res = await new AnthropicProvider({ client }).call(request);
    expect(res.toolCall).toBeUndefined();
    expect(res.text).toBe("I think...");
  });

  it("turns a refusal into a non-retryable error", async () => {
    const { client } = mockClient(
      message([], "refusal", {
        stop_details: { type: "refusal", category: "cyber", explanation: "" },
      }),
    );
    const err = await new AnthropicProvider({ client }).call(request).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect((err as LLMError).refusal).toBe(true);
    expect((err as LLMError).retryable).toBe(false);
    expect((err as LLMError).message).toContain("cyber");
  });

  it("maps SDK errors to retryable or not", () => {
    const headers = new Headers({ "retry-after": "12" });
    const rate = toLLMError(new Anthropic.RateLimitError(429, {}, "slow down", headers));
    expect(rate).toMatchObject({ retryable: true, status: 429, retryAfterMs: 12_000 });

    const overloaded = toLLMError(new Anthropic.APIError(529, {}, "overloaded", new Headers()));
    expect(overloaded.retryable).toBe(true);

    const bad = toLLMError(new Anthropic.BadRequestError(400, {}, "bad", new Headers()));
    expect(bad.retryable).toBe(false);

    const auth = toLLMError(new Anthropic.AuthenticationError(401, {}, "nope", new Headers()));
    expect(auth).toMatchObject({ retryable: false, status: 401 });
  });
});

describe("FakeProvider", () => {
  const snapshot = {
    url: "http://x.test/",
    title: "",
    nodes: [],
    text: "",
    refs: indexRefs([
      { role: "button", name: "Add to cart", ref: "e3" },
      { role: "button", name: "Add to cart", ref: "e7" },
      { role: "textbox", name: "Email", ref: "e9" },
    ]),
  } satisfies PageSnapshot;
  const req = {
    system: "",
    messages: [],
    tools: ACTION_TOOLS,
    context: { purpose: "step" as const, snapshot },
  };

  it("resolves role and name targets to snapshot refs", async () => {
    const provider = new FakeProvider([
      fake.click({ role: "button", name: "Add to cart", nth: 1 }, "Add the second item"),
      fake.type({ role: "textbox", name: /mail/ }, "ada@example.com"),
    ]);
    const first = await provider.call(req);
    expect(first.toolCall).toEqual({
      name: "click",
      input: { intent: "Add the second item", reasoning: "Scripted step.", ref: "e7" },
    });
    const second = await provider.call(req);
    expect((second.toolCall?.input as { ref: string }).ref).toBe("e9");
    expect(provider.remaining).toBe(0);
  });

  it("fails when the script runs out", async () => {
    await expect(new FakeProvider([]).call(req)).rejects.toThrow(/ran out/);
  });

  it("can return text, errors and computed turns", async () => {
    const provider = new FakeProvider([
      { text: "thinking out loud" },
      { error: new LLMError("busy", { retryable: true, status: 529 }) },
      () => fake.done("pass", "ok"),
    ]);
    expect((await provider.call(req)).text).toBe("thinking out loud");
    await expect(provider.call(req)).rejects.toThrow("busy");
    expect((await provider.call(req)).toolCall?.name).toBe("done");
  });
});
