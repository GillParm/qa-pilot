import { accessibleName, type AriaNode } from "../snapshot/tree.js";
import { ACTION_TYPES, type TokenUsage } from "../types.js";
import {
  LLMError,
  type LLMProvider,
  type ToolCallRequest,
  type ToolCallResponse,
} from "./types.js";

/** Picks an element by role and name, the way a person would describe it. */
export interface TargetQuery {
  role: string;
  name?: string | RegExp;
  /** Which match to take when several fit (0-based). */
  nth?: number;
}

export type FakeInput = Record<string, unknown>;

/**
 * One scripted reply. `input` may contain a `ref` given as a TargetQuery; the
 * fake swaps it for the real ref from the snapshot in the request.
 */
export type FakeTurn =
  | { tool: string; input: FakeInput; usage?: Partial<TokenUsage> }
  | { text: string; usage?: Partial<TokenUsage> }
  | { error: LLMError }
  | ((request: ToolCallRequest) => FakeTurn);

function matches(node: AriaNode, query: TargetQuery): boolean {
  if (node.role !== query.role) return false;
  if (query.name === undefined) return true;
  const name = accessibleName(node);
  return typeof query.name === "string" ? name === query.name : query.name.test(name);
}

export function findRef(request: ToolCallRequest, query: TargetQuery): string {
  const snapshot = request.context?.snapshot;
  if (!snapshot) throw new Error("fake provider needs request.context.snapshot to resolve targets");
  const found = [...snapshot.refs.entries()].filter(([, node]) => matches(node, query));
  const hit = found[query.nth ?? 0];
  // An unknown ref is a realistic model mistake; the agent reports it back.
  return hit ? hit[0] : "e-missing";
}

function isQuery(value: unknown): value is TargetQuery {
  return typeof value === "object" && value !== null && "role" in value;
}

const DEFAULT_USAGE: TokenUsage = {
  inputTokens: 1_000,
  outputTokens: 100,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/**
 * A scripted provider for tests and offline demos. It replays turns in order
 * and fails loudly when the script runs out.
 */
export class FakeProvider implements LLMProvider {
  readonly name = "fake";
  readonly model: string;
  readonly requests: ToolCallRequest[] = [];
  private index = 0;

  constructor(
    private readonly turns: FakeTurn[],
    opts: { model?: string } = {},
  ) {
    this.model = opts.model ?? "fake";
  }

  get remaining(): number {
    return this.turns.length - this.index;
  }

  async call(request: ToolCallRequest): Promise<ToolCallResponse> {
    this.requests.push(request);
    let next = this.turns[this.index++];
    if (!next) {
      throw new LLMError(`fake provider script ran out after ${this.turns.length} turns`, {
        retryable: false,
      });
    }
    while (typeof next === "function") next = next(request);
    const turn: Exclude<FakeTurn, (request: ToolCallRequest) => FakeTurn> = next;
    if ("error" in turn) throw turn.error;
    const usage = { ...DEFAULT_USAGE, ...turn.usage };
    if ("text" in turn)
      return { text: turn.text, usage, model: this.model, stopReason: "end_turn" };

    const isAction = (ACTION_TYPES as readonly string[]).includes(turn.tool);
    const input: FakeInput = isAction
      ? { intent: `${turn.tool} step`, reasoning: "Scripted step.", ...turn.input }
      : { ...turn.input };
    if (isQuery(input.ref)) input.ref = findRef(request, input.ref);
    return {
      toolCall: { name: turn.tool, input },
      usage,
      model: this.model,
      stopReason: "tool_use",
    };
  }
}

/** Small helpers so scripts read like the test they describe. */
export const fake = {
  click: (target: TargetQuery, intent?: string): FakeTurn => ({
    tool: "click",
    input: { ref: target, ...(intent ? { intent } : {}) },
  }),
  type: (target: TargetQuery, text: string, intent?: string): FakeTurn => ({
    tool: "type",
    input: { ref: target, text, ...(intent ? { intent } : {}) },
  }),
  select: (target: TargetQuery, option: string, intent?: string): FakeTurn => ({
    tool: "select",
    input: { ref: target, option, ...(intent ? { intent } : {}) },
  }),
  navigate: (url: string, intent?: string): FakeTurn => ({
    tool: "navigate",
    input: { url, ...(intent ? { intent } : {}) },
  }),
  assertText: (text: string, intent?: string): FakeTurn => ({
    tool: "assert",
    input: { kind: "text_visible", text, ...(intent ? { intent } : {}) },
  }),
  assertVisible: (target: TargetQuery, intent?: string): FakeTurn => ({
    tool: "assert",
    input: { kind: "element_visible", ref: target, ...(intent ? { intent } : {}) },
  }),
  assertUrl: (pattern: string, intent?: string): FakeTurn => ({
    tool: "assert",
    input: { kind: "url_matches", pattern, ...(intent ? { intent } : {}) },
  }),
  assertValue: (target: TargetQuery, value: string, intent?: string): FakeTurn => ({
    tool: "assert",
    input: { kind: "input_value", ref: target, value, ...(intent ? { intent } : {}) },
  }),
  done: (status: "pass" | "fail", summary: string): FakeTurn => ({
    tool: "done",
    input: { status, summary, intent: "Finish" },
  }),
  /** A heal reply: propose the element that should replace a broken locator. */
  propose: (target: TargetQuery, reasoning = "Scripted replacement."): FakeTurn => ({
    tool: "propose_locator",
    input: { ref: target, reasoning },
  }),
};
