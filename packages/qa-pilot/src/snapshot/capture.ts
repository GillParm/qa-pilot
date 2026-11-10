import type { Page } from "playwright";
import {
  DEFAULT_RENDER,
  DEFAULT_TRIM,
  indexRefs,
  renderTree,
  toChildren,
  trimTree,
  type AriaChild,
  type AriaNode,
  type RenderOptions,
  type TrimOptions,
} from "./tree.js";

export interface PageSnapshot {
  url: string;
  title: string;
  /** Trimmed tree. */
  nodes: AriaChild[];
  /** Rendered text sent to the model. */
  text: string;
  /** Ref → node, for every ref the model can see. */
  refs: Map<string, AriaNode>;
}

export interface CaptureOptions {
  trim?: TrimOptions;
  render?: RenderOptions;
  timeoutMs?: number;
}

/**
 * Takes an AI-mode ARIA snapshot. Refs in it stay valid until the next
 * snapshot of the same frame, so resolve any ref before snapshotting again.
 */
export async function captureSnapshot(page: Page, opts: CaptureOptions = {}): Promise<PageSnapshot> {
  const json = await page.ariaSnapshotJSON({ mode: "ai", timeout: opts.timeoutMs ?? 10_000 });
  const nodes = trimTree(toChildren(json), opts.trim ?? DEFAULT_TRIM);
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    nodes,
    text: renderTree(nodes, opts.render ?? DEFAULT_RENDER),
    refs: indexRefs(nodes),
  };
}
