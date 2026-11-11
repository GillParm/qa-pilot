/**
 * Library entry point. The CLI is a thin layer over these functions.
 */
export { runAgent, type RunOptions, type RunResult } from "./agent/run.js";
export { DEFAULT_LIMITS, resolveLimits, Budget } from "./agent/limits.js";
export { SYSTEM_PROMPT, renderStepPrompt, describeStep } from "./agent/prompt.js";
export { ACTION_TOOLS, parseToolCall, type ToolSpec } from "./actions/tools.js";
export { executeProposed, performAction } from "./actions/execute.js";
export { captureSnapshot, type PageSnapshot } from "./snapshot/capture.js";
export { trimTree, renderTree, type AriaNode, type AriaChild } from "./snapshot/tree.js";
export { resolveRef, locatorForHandle } from "./locator/resolve.js";
export { toLocator, toCode, describeLocator } from "./locator/spec.js";
export { exportSpec, exportRun, readRun, type ExportOptions } from "./export/spec.js";
export { healSpec, type HealOptions, type HealResult } from "./heal/heal.js";
export { parseSpec } from "./heal/parse.js";
export { parseSuite, loadSuite, resolveTests, type Suite } from "./suite/config.js";
export { runSuite, type SuiteSummary, type TestResult } from "./suite/runner.js";
export { renderSuiteMarkdown } from "./suite/markdown.js";
export { renderReport, writeReport } from "./report/html.js";
export * from "./llm/index.js";
export * from "./types.js";
export { VERSION } from "./version.js";
