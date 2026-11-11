import { describeLocator } from "../locator/spec.js";
import type { PageSnapshot } from "../snapshot/capture.js";
import type { ConsoleEntry, NetworkFailure, ProposedAction, StepRecord } from "../types.js";

/** Kept byte-for-byte stable across steps so providers can cache it. */
export const SYSTEM_PROMPT = `You are qa-pilot, a careful QA engineer testing a web application in a real browser.

Each turn you get a test instruction, the steps taken so far, and an accessibility snapshot of the current page. Respond by calling exactly one tool: click, type, select, navigate, assert or done.

Reading the snapshot:
- Each line is an element: its role, its accessible name in quotes, states in brackets, and a ref such as [ref=e12].
- Target elements only with a ref from the current snapshot. Refs change between turns, so never reuse an old one.
- "text:" lines are plain text. url= is a link's target. value= is a field's current value.

Testing:
- Follow the instruction literally. Do everything it asks and nothing it does not.
- Verify each outcome the instruction expects with assert before calling done with status pass. Assertions are what make the test meaningful, and they are what gets exported as a repeatable test.
- Assert each fact once. When every outcome the instruction expects has passed, call done straight away.
- Assert exact, specific facts. Copy text from the snapshot, or compute what the instruction implies (for example three items at $18.00 should total $54.00). Prefer short, distinctive substrings.
- A failed assertion ends the test as failed. When the app is wrong, that is the correct result: do not work around a bug or change your expectation to match what the app shows.
- If an action fails, read the error and try another way, such as a different element.
- If the page is still loading, assert what you expect to appear: assertions wait for it, up to the action timeout.
- If the app clearly cannot do what the instruction asks (an error message, a missing feature), call done with status fail and say what went wrong.
- When a value must be new on every run (an email for a new account, a username), put the run token in it, for example ada+<run token>@example.com.
- Write intent like a test step title, in a few words. Keep reasoning to one or two sentences.`;

const MAX_HISTORY_DETAIL = 25;

function quoteShort(value: string, max = 80): string {
  const text = value.length > max ? `${value.slice(0, max - 1)}…` : value;
  return JSON.stringify(text);
}

/** One line describing what a step did, for the model and for logs. */
export function describeStep(step: Pick<StepRecord, "proposed" | "action" | "target">): string {
  const a = step.action;
  const target = step.target
    ? `${step.target.role}${step.target.name ? ` ${quoteShort(step.target.name, 60)}` : ""}`
    : a && "locator" in a
      ? describeLocator(a.locator)
      : "";
  const p: ProposedAction = step.proposed;
  switch (p.type) {
    case "click":
      return `click ${target || p.ref}`;
    case "type":
      return `type ${quoteShort(p.text)} into ${target || p.ref}`;
    case "select":
      return `select ${quoteShort(p.option)} in ${target || p.ref}`;
    case "navigate":
      return `navigate to ${a?.type === "navigate" ? a.url : p.url}`;
    case "done":
      return `done (${p.status}): ${p.summary}`;
    case "assert":
      switch (p.kind) {
        case "text_visible":
          return `assert text visible ${quoteShort(p.text)}`;
        case "element_visible":
          return `assert ${target || p.ref} is visible`;
        case "url_matches":
          return `assert URL matches ${quoteShort(p.pattern)}`;
        case "input_value":
          return `assert ${target || p.ref} has value ${quoteShort(p.value)}`;
      }
  }
}

function outcomeText(step: StepRecord): string {
  if (step.outcome === "ok") return step.proposed.type === "assert" ? "passed" : "ok";
  return `${step.outcome === "failed" ? "FAILED" : "ERROR"}: ${step.error ?? "unknown error"}`;
}

export interface StepPromptInput {
  instruction: string;
  startUrl: string;
  runToken: string;
  stepNumber: number;
  maxSteps: number;
  history: StepRecord[];
  snapshot: PageSnapshot;
  console: ConsoleEntry[];
  network: NetworkFailure[];
  /** Extra feedback for this turn, e.g. why the previous reply was rejected. */
  feedback?: string;
}

/** The user message for one step. Everything that changes between steps lives here. */
export function renderStepPrompt(input: StepPromptInput): string {
  const lines: string[] = [];
  lines.push(`Instruction: ${input.instruction}`);
  lines.push(`Start URL: ${input.startUrl}`);
  lines.push(`Run token: ${input.runToken}`);
  lines.push(`This is step ${input.stepNumber} of at most ${input.maxSteps}.`);
  lines.push("");

  if (input.history.length === 0) {
    lines.push("Steps so far: none. The browser has just opened the start URL.");
  } else {
    lines.push("Steps so far:");
    const skipped = Math.max(0, input.history.length - MAX_HISTORY_DETAIL);
    if (skipped > 0) lines.push(`(${skipped} earlier steps not shown)`);
    for (const step of input.history.slice(skipped)) {
      lines.push(`${step.index}. ${describeStep(step)} — ${outcomeText(step)}`);
    }
  }
  lines.push("");

  if (input.console.length > 0) {
    lines.push("Console errors since the last step:");
    for (const entry of input.console.slice(0, 5)) lines.push(`- ${entry.text.slice(0, 200)}`);
    lines.push("");
  }
  if (input.network.length > 0) {
    lines.push("Failed network requests since the last step:");
    for (const n of input.network.slice(0, 5)) {
      lines.push(`- ${n.method} ${n.url} ${n.status ?? n.failure ?? ""}`.trim());
    }
    lines.push("");
  }

  lines.push(
    `Current page: ${input.snapshot.title ? `${JSON.stringify(input.snapshot.title)} ` : ""}${input.snapshot.url}`,
  );
  lines.push("Snapshot:");
  lines.push(input.snapshot.text || "(the page has no accessible content)");

  if (input.feedback) {
    lines.push("");
    lines.push(`Note: ${input.feedback}`);
  }
  lines.push("");
  lines.push("Call exactly one tool for the next step.");
  return lines.join("\n");
}

export const NO_TOOL_FEEDBACK =
  "Your last reply did not call a tool. Reply with exactly one tool call: click, type, select, navigate, assert or done.";

export function repeatedAssertFeedback(step: number): string {
  return `That assertion already passed at step ${step}. Do not repeat it. If everything the instruction expects has been verified, call done with status pass; otherwise do the next part of the instruction.`;
}

export const DONE_WITHOUT_ASSERT_FEEDBACK =
  "You called done with status pass before any assertion passed. Use assert to verify what the instruction expects, then call done.";
