/**
 * Pure functions over Playwright's AI-mode ARIA snapshot JSON
 * (`page.ariaSnapshotJSON({ mode: "ai" })`): trimming it down to what a model
 * needs, rendering it as compact text, and indexing element refs.
 */

export interface AriaNode {
  role: string;
  name?: string;
  ref?: string;
  text?: string;
  url?: string;
  placeholder?: string;
  level?: number;
  checked?: boolean | "mixed";
  disabled?: boolean;
  expanded?: boolean;
  pressed?: boolean | "mixed";
  selected?: boolean;
  invalid?: boolean | string;
  active?: boolean;
  cursor?: string;
  children?: AriaChild[];
}

export type AriaChild = AriaNode | string;

export interface TrimOptions {
  /** Longest text fragment or name kept before cutting with an ellipsis. */
  maxTextLength: number;
  /** Options kept per combobox or listbox. */
  maxOptions: number;
}

export interface RenderOptions {
  /** Hard cap on rendered lines; the rest is summarised in one line. */
  maxLines: number;
}

export const DEFAULT_TRIM: TrimOptions = { maxTextLength: 160, maxOptions: 25 };
export const DEFAULT_RENDER: RenderOptions = { maxLines: 400 };

/** Roles that only group other content. Unnamed ones are replaced by their children. */
const TRANSPARENT_ROLES = new Set(["generic", "group", "none", "presentation", "rowgroup"]);

/** Roles that hold a user-editable value, rendered as value="...". */
const VALUE_ROLES = new Set(["textbox", "searchbox", "spinbutton", "combobox", "slider"]);

export const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "switch",
  "slider",
  "spinbutton",
  "treeitem",
]);

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function isAriaNode(value: unknown): value is AriaNode {
  return typeof value === "object" && value !== null && typeof (value as AriaNode).role === "string";
}

/** Validates the untyped JSON Playwright returns and normalises it to a child list. */
export function toChildren(json: unknown): AriaChild[] {
  const list = Array.isArray(json) ? json : [json];
  const out: AriaChild[] = [];
  for (const item of list) {
    if (typeof item === "string") out.push(item);
    else if (isAriaNode(item)) out.push(item);
  }
  return out;
}

function trimNode(node: AriaNode, opts: TrimOptions): AriaChild[] {
  const children = trimChildren(node.children ?? [], opts, node.role);
  const name = node.name ? truncate(normalizeText(node.name), opts.maxTextLength) : undefined;
  const text = node.text ? truncate(normalizeText(node.text), opts.maxTextLength) : undefined;

  // Images without a name carry no information for the model.
  if (node.role === "img" && !name) return [];

  const clickable = node.cursor === "pointer";
  if (TRANSPARENT_ROLES.has(node.role) && !name && !clickable) {
    // Hoist the children; keep a lone text value as plain text.
    if (children.length === 0 && text) return [text];
    return children;
  }

  const trimmed: AriaNode = { role: node.role };
  if (name) trimmed.name = name;
  if (node.ref) trimmed.ref = node.ref;
  if (text) trimmed.text = text;
  if (node.url) trimmed.url = node.url;
  if (node.placeholder) trimmed.placeholder = truncate(node.placeholder, opts.maxTextLength);
  if (node.level !== undefined) trimmed.level = node.level;
  if (node.checked !== undefined) trimmed.checked = node.checked;
  if (node.disabled) trimmed.disabled = true;
  if (node.expanded !== undefined) trimmed.expanded = node.expanded;
  if (node.pressed !== undefined) trimmed.pressed = node.pressed;
  if (node.selected) trimmed.selected = true;
  if (node.invalid) trimmed.invalid = node.invalid;
  if (clickable && !INTERACTIVE_ROLES.has(node.role)) trimmed.cursor = "pointer";
  if (children.length > 0) trimmed.children = children;
  return [trimmed];
}

function trimChildren(children: AriaChild[], opts: TrimOptions, parentRole?: string): AriaChild[] {
  const out: AriaChild[] = [];
  for (const child of children) {
    if (typeof child === "string") {
      const text = truncate(normalizeText(child), opts.maxTextLength);
      if (text) out.push(text);
    } else {
      out.push(...trimNode(child, opts));
    }
  }
  if (parentRole === "combobox" || parentRole === "listbox") {
    const options = out.filter((c) => typeof c !== "string" && c.role === "option");
    if (options.length > opts.maxOptions) {
      const kept = new Set(options.slice(0, opts.maxOptions));
      const rest = options.length - opts.maxOptions;
      const filtered = out.filter((c) => typeof c === "string" || c.role !== "option" || kept.has(c));
      filtered.push(`… ${rest} more options`);
      return filtered;
    }
  }
  return out;
}

/** Drops noise from the snapshot while keeping every element a test might touch. */
export function trimTree(children: AriaChild[], opts: TrimOptions = DEFAULT_TRIM): AriaChild[] {
  return trimChildren(children, opts);
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function describeLine(node: AriaNode): string {
  const parts: string[] = [node.role];
  if (node.name) parts.push(quote(node.name));
  if (node.level !== undefined) parts.push(`[level=${node.level}]`);
  if (node.checked === true) parts.push("[checked]");
  if (node.checked === "mixed") parts.push("[checked=mixed]");
  if (node.disabled) parts.push("[disabled]");
  if (node.expanded !== undefined) parts.push(`[expanded=${node.expanded}]`);
  if (node.pressed === true) parts.push("[pressed]");
  if (node.selected) parts.push("[selected]");
  if (node.invalid) parts.push("[invalid]");
  if (node.cursor === "pointer") parts.push("[clickable]");
  if (node.ref) parts.push(`[ref=${node.ref}]`);
  if (node.url) parts.push(`url=${node.url}`);
  if (node.placeholder) parts.push(`placeholder=${quote(node.placeholder)}`);
  if (node.text !== undefined && VALUE_ROLES.has(node.role)) parts.push(`value=${quote(node.text)}`);
  return parts.join(" ");
}

/**
 * Renders the tree as indented lines, close to Playwright's own YAML format:
 *   - button "Add to cart" [ref=e13]
 *   - textbox "Email" [ref=e7] value="ada@example.com"
 */
export function renderTree(children: AriaChild[], opts: RenderOptions = DEFAULT_RENDER): string {
  const lines: string[] = [];
  let omitted = 0;

  const visit = (items: AriaChild[], depth: number) => {
    for (const item of items) {
      const indent = "  ".repeat(depth);
      if (lines.length >= opts.maxLines) {
        omitted += countLines(item);
        continue;
      }
      if (typeof item === "string") {
        lines.push(`${indent}- text: ${item}`);
        continue;
      }
      let line = `${indent}- ${describeLine(item)}`;
      if (item.text !== undefined && !VALUE_ROLES.has(item.role)) line += `: ${item.text}`;
      else if (item.children?.length) line += ":";
      lines.push(line);
      if (item.children) visit(item.children, depth + 1);
    }
  };
  visit(children, 0);
  if (omitted > 0) lines.push(`- … ${omitted} more lines not shown`);
  return lines.join("\n");
}

function countLines(item: AriaChild): number {
  if (typeof item === "string") return 1;
  return 1 + (item.children ?? []).reduce((sum, child) => sum + countLines(child), 0);
}

/** Maps every ref in the (trimmed) tree to its node. */
export function indexRefs(children: AriaChild[]): Map<string, AriaNode> {
  const map = new Map<string, AriaNode>();
  const visit = (items: AriaChild[]) => {
    for (const item of items) {
      if (typeof item === "string") continue;
      if (item.ref) map.set(item.ref, item);
      if (item.children) visit(item.children);
    }
  };
  visit(children);
  return map;
}

/**
 * The accessible name of a node. AI-mode snapshots omit names that repeat the
 * printed descendants (a heading wrapping a link), so fall back to that text.
 */
export function accessibleName(node: AriaNode): string {
  if (node.name) return node.name;
  if (node.text && !VALUE_ROLES.has(node.role)) return node.text;
  const parts: string[] = [];
  for (const child of node.children ?? []) {
    if (typeof child === "string") parts.push(child);
    else parts.push(accessibleName(child));
  }
  return normalizeText(parts.join(" "));
}
