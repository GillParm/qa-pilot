import { z } from "zod";
import type { ProposedAction } from "../types.js";

/** Provider-neutral tool definition. `parameters` is a JSON Schema object. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

const intent = {
  type: "string",
  description:
    "What this step does in a few plain words, written as a test step title. Example: 'Add the trail mug to the cart'.",
};
const reasoning = {
  type: "string",
  description: "One or two sentences on why this is the right next step, based on the snapshot.",
};
const ref = {
  type: "string",
  description: "The ref of the target element from the current snapshot, for example 'e12'.",
};

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): ToolSpec {
  return {
    name,
    description,
    parameters: {
      type: "object",
      properties: { intent, reasoning, ...properties },
      required: ["intent", "reasoning", ...required],
      additionalProperties: false,
    },
  };
}

/** The whole action set. The model must call exactly one of these per step. */
export const ACTION_TOOLS: ToolSpec[] = [
  tool("click", "Click a button, link, checkbox or other element.", { ref }, ["ref"]),
  tool(
    "type",
    "Replace the contents of a text field with the given text.",
    { ref, text: { type: "string", description: "The exact text to enter." } },
    ["ref", "text"],
  ),
  tool(
    "select",
    "Choose an option in a dropdown (combobox or listbox).",
    {
      ref,
      option: { type: "string", description: "The visible label of the option to choose." },
    },
    ["ref", "option"],
  ),
  tool(
    "navigate",
    "Go to a URL. Prefer clicking links; use this only when the instruction names a page or you are stuck.",
    {
      url: { type: "string", description: "Absolute URL, or a path relative to the current page." },
    },
    ["url"],
  ),
  tool(
    "assert",
    [
      "Check that the page is in the state the instruction expects. A failed assertion ends the run as failed, so assert",
      "what the instruction says should happen, not what you hope. Kinds:",
      "text_visible (needs text: a substring of visible text, copied from the snapshot or computed from the instruction),",
      "element_visible (needs ref), url_matches (needs pattern: a substring of the URL, or /regex/),",
      "input_value (needs ref and value).",
    ].join(" "),
    {
      kind: {
        type: "string",
        enum: ["text_visible", "element_visible", "url_matches", "input_value"],
      },
      text: { type: "string", description: "For text_visible." },
      ref: { ...ref, description: "For element_visible and input_value." },
      pattern: { type: "string", description: "For url_matches." },
      value: { type: "string", description: "For input_value: the expected value." },
    },
    ["kind"],
  ),
  tool(
    "done",
    "Finish the test. Use status 'pass' only after your assertions have verified everything the instruction asks for. Use 'fail' when the app clearly does not do what the instruction expects.",
    {
      status: { type: "string", enum: ["pass", "fail"] },
      summary: {
        type: "string",
        description: "One or two sentences a developer can read in a CI summary.",
      },
    },
    ["status", "summary"],
  ),
];

const base = z.object({
  intent: z.string().trim().min(1),
  reasoning: z.string().trim().min(1),
});

const schemas = {
  click: base.extend({ ref: z.string().min(1) }),
  type: base.extend({ ref: z.string().min(1), text: z.string() }),
  select: base.extend({ ref: z.string().min(1), option: z.string().min(1) }),
  navigate: base.extend({ url: z.string().min(1) }),
  assert: base.extend({
    kind: z.enum(["text_visible", "element_visible", "url_matches", "input_value"]),
    text: z.string().optional(),
    ref: z.string().optional(),
    pattern: z.string().optional(),
    value: z.string().optional(),
  }),
  done: base.extend({
    status: z.enum(["pass", "fail"]),
    summary: z.string().trim().min(1),
  }),
};

export interface ParsedToolCall {
  action: ProposedAction;
  intent: string;
  reasoning: string;
}

export class ToolInputError extends Error {
  override name = "ToolInputError";
}

function need<T>(value: T | undefined, field: string, kind: string): T {
  if (value === undefined || value === "") {
    throw new ToolInputError(`assert kind "${kind}" needs "${field}"`);
  }
  return value;
}

/** Validates a tool call from any provider and turns it into a ProposedAction. */
export function parseToolCall(name: string, input: unknown): ParsedToolCall {
  if (!(name in schemas)) {
    throw new ToolInputError(
      `unknown tool "${name}"; use one of ${Object.keys(schemas).join(", ")}`,
    );
  }
  const result = schemas[name as keyof typeof schemas].safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
      .join("; ");
    throw new ToolInputError(`invalid ${name} input: ${issues}`);
  }
  const data = result.data as Record<string, unknown> & { intent: string; reasoning: string };
  const { intent: i, reasoning: r } = data;
  let action: ProposedAction;
  switch (name) {
    case "click":
      action = { type: "click", ref: data.ref as string };
      break;
    case "type":
      action = { type: "type", ref: data.ref as string, text: data.text as string };
      break;
    case "select":
      action = { type: "select", ref: data.ref as string, option: data.option as string };
      break;
    case "navigate":
      action = { type: "navigate", url: data.url as string };
      break;
    case "assert": {
      const a = data as z.infer<typeof schemas.assert>;
      switch (a.kind) {
        case "text_visible":
          action = { type: "assert", kind: a.kind, text: need(a.text, "text", a.kind) };
          break;
        case "element_visible":
          action = { type: "assert", kind: a.kind, ref: need(a.ref, "ref", a.kind) };
          break;
        case "url_matches":
          action = { type: "assert", kind: a.kind, pattern: need(a.pattern, "pattern", a.kind) };
          break;
        case "input_value":
          action = {
            type: "assert",
            kind: a.kind,
            ref: need(a.ref, "ref", a.kind),
            value: need(a.value, "value", a.kind),
          };
          break;
      }
      break;
    }
    default: {
      const d = data as z.infer<typeof schemas.done>;
      action = { type: "done", status: d.status, summary: d.summary };
    }
  }
  return { action, intent: i, reasoning: r };
}
