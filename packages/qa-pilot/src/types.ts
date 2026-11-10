/**
 * Shared data types. Everything that ends up in run.json is defined here, so the
 * report, the exporter and the healer all read the same shapes.
 */

/** A Playwright locator described as data, so it can be executed and printed as code. */
export type LocatorSpec =
  | { kind: "role"; role: string; name?: string; exact?: boolean; nth?: number }
  | { kind: "label"; text: string; exact?: boolean; nth?: number }
  | { kind: "text"; text: string; exact?: boolean; nth?: number };

export type AssertKind = "text_visible" | "element_visible" | "url_matches" | "input_value";

export const ACTION_TYPES = ["click", "type", "select", "navigate", "assert", "done"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** What the model asked for. Elements are referenced by snapshot ref (e.g. "e12"). */
export type ProposedAction =
  | { type: "click"; ref: string }
  | { type: "type"; ref: string; text: string; unique?: boolean }
  | { type: "select"; ref: string; option: string }
  | { type: "navigate"; url: string }
  | { type: "assert"; kind: "text_visible"; text: string }
  | { type: "assert"; kind: "element_visible"; ref: string }
  | { type: "assert"; kind: "url_matches"; pattern: string }
  | { type: "assert"; kind: "input_value"; ref: string; value: string }
  | { type: "done"; status: "pass" | "fail"; summary: string };

/** What actually ran, with refs replaced by locators. This is what export replays. */
export type ExecutedAction =
  | { type: "click"; locator: LocatorSpec }
  | { type: "type"; locator: LocatorSpec; text: string; unique?: boolean }
  | { type: "select"; locator: LocatorSpec; option: string }
  | { type: "navigate"; url: string }
  | { type: "assert"; kind: "text_visible"; text: string; locator: LocatorSpec }
  | { type: "assert"; kind: "element_visible"; locator: LocatorSpec }
  | { type: "assert"; kind: "url_matches"; pattern: string }
  | { type: "assert"; kind: "input_value"; locator: LocatorSpec; value: string }
  | { type: "done"; status: "pass" | "fail"; summary: string };

/** Short description of the element a ref pointed at, for reports and healing prompts. */
export interface ElementInfo {
  role: string;
  name?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface LlmCallRecord extends TokenUsage {
  provider: string;
  model: string;
  costUsd: number;
  attempts: number;
  latencyMs: number;
}

export interface ConsoleEntry {
  type: string;
  text: string;
  url?: string;
  at: string;
}

export interface NetworkFailure {
  method: string;
  url: string;
  status?: number;
  failure?: string;
  resourceType: string;
  at: string;
}

/**
 * Outcome of a single step:
 * - ok: the action ran, or the assertion held
 * - failed: an assertion did not hold (the run fails)
 * - error: the action could not be carried out (bad ref, timeout); the model is told and may recover
 */
export type StepOutcome = "ok" | "failed" | "error";

export interface StepRecord {
  index: number;
  intent: string;
  reasoning: string;
  proposed: ProposedAction;
  action?: ExecutedAction;
  target?: ElementInfo;
  outcome: StepOutcome;
  error?: string;
  urlBefore: string;
  urlAfter: string;
  screenshot?: string;
  startedAt: string;
  durationMs: number;
  llm?: LlmCallRecord;
  console: ConsoleEntry[];
  network: NetworkFailure[];
}

export type Verdict = "pass" | "fail" | "error";

export interface RunLimits {
  maxSteps: number;
  maxCostUsd: number;
  actionTimeoutMs: number;
  runTimeoutMs: number;
  llmRetries: number;
  actionRetries: number;
  maxConsecutiveErrors: number;
}

export interface RunTotals {
  steps: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface RunRecord {
  schemaVersion: 1;
  id: string;
  name: string;
  instruction: string;
  startUrl: string;
  provider: string;
  model: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  verdict: Verdict;
  summary: string;
  /** Why the run stopped, when it was not the model's own `done`. */
  stopReason?: string;
  steps: StepRecord[];
  totals: RunTotals;
  limits: RunLimits;
  video?: string;
  console: ConsoleEntry[];
  network: NetworkFailure[];
  environment: {
    qaPilotVersion: string;
    playwrightVersion: string;
    browser: string;
    viewport: { width: number; height: number };
    headless: boolean;
  };
}
