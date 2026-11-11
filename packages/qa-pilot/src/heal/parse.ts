import ts from "typescript";
import { SPEC_MARKER, type SpecMetadata } from "../export/spec.js";
import type { ExecutedAction, LocatorSpec } from "../types.js";

/** Values the spec reads at runtime, supplied by the healer. */
export interface SpecEnv {
  BASE_URL: string;
  RUN: string;
}

export interface SourceRange {
  start: number;
  end: number;
}

export interface ParsedStatement {
  /** The action with values evaluated against the env. */
  action: ExecutedAction;
  /** Where the locator expression sits in the source, for interaction steps and element asserts. */
  locatorRange?: SourceRange;
  /** Source text of the statement, for messages. */
  text: string;
  line: number;
}

export interface ParsedStep {
  /** test.step title (the intent recorded at export); undefined for statements outside a step. */
  title?: string;
  statements: ParsedStatement[];
}

export interface ParsedSpec {
  testName: string;
  steps: ParsedStep[];
  metadata?: SpecMetadata;
  /** Value of the BASE_URL fallback in the spec, if it has one. */
  defaultBaseUrl?: string;
}

export class SpecParseError extends Error {
  override name = "SpecParseError";
}

type Expr = ts.Expression;

function unwrap(expr: Expr): Expr {
  let e = expr;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) {
    e = e.expression;
  }
  return e;
}

/** Evaluates string-ish expressions: literals, `...${RUN}...` templates, new URL(x, BASE_URL).toString(). */
function evalString(expr: Expr, env: SpecEnv, sf: ts.SourceFile): string {
  const e = unwrap(expr);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isTemplateExpression(e)) {
    let out = e.head.text;
    for (const span of e.templateSpans) {
      out += evalIdentifier(span.expression, env, sf);
      out += span.literal.text;
    }
    return out;
  }
  if (ts.isIdentifier(e)) return evalIdentifier(e, env, sf);
  // new URL(path, BASE_URL).toString()
  if (
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    e.expression.name.text === "toString"
  ) {
    const target = unwrap(e.expression.expression);
    if (
      ts.isNewExpression(target) &&
      ts.isIdentifier(target.expression) &&
      target.expression.text === "URL"
    ) {
      const [first, second] = target.arguments ?? [];
      if (first) {
        const base = second ? evalString(second, env, sf) : undefined;
        return new URL(evalString(first, env, sf), base).toString();
      }
    }
  }
  throw new SpecParseError(`cannot evaluate ${e.getText(sf)} (line ${line(e, sf)})`);
}

function evalIdentifier(expr: Expr, env: SpecEnv, sf: ts.SourceFile): string {
  const e = unwrap(expr);
  if (ts.isIdentifier(e) && (e.text === "RUN" || e.text === "BASE_URL")) return env[e.text];
  throw new SpecParseError(`unsupported value ${e.getText(sf)} (line ${line(e, sf)})`);
}

function line(node: ts.Node, sf: ts.SourceFile): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function objectOptions(expr: Expr | undefined, env: SpecEnv, sf: ts.SourceFile) {
  const out: { name?: string; exact?: boolean } = {};
  if (!expr) return out;
  const e = unwrap(expr);
  if (!ts.isObjectLiteralExpression(e))
    throw new SpecParseError(`expected options object at line ${line(e, sf)}`);
  for (const prop of e.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    if (prop.name.text === "name") out.name = evalString(prop.initializer, env, sf);
    if (prop.name.text === "exact") out.exact = prop.initializer.kind === ts.SyntaxKind.TrueKeyword;
  }
  return out;
}

/** Parses page.getByRole/getByLabel/getByText(...)[.first()|.nth(n)] into a LocatorSpec. */
export function parseLocator(expr: Expr, env: SpecEnv, sf: ts.SourceFile): LocatorSpec | undefined {
  let e = unwrap(expr);
  let nth: number | undefined;
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    const method = e.expression.name.text;
    if (method === "first" && e.arguments.length === 0) {
      nth = 0;
      e = unwrap(e.expression.expression);
    } else if (method === "nth" && e.arguments.length === 1) {
      const arg = unwrap(e.arguments[0]!);
      if (!ts.isNumericLiteral(arg)) return undefined;
      nth = Number(arg.text);
      e = unwrap(e.expression.expression);
    }
  }
  if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression)) return undefined;
  const receiver = unwrap(e.expression.expression);
  if (!ts.isIdentifier(receiver) || receiver.text !== "page") return undefined;
  const method = e.expression.name.text;
  const [a0, a1] = e.arguments;
  if (!a0) return undefined;
  let spec: LocatorSpec;
  if (method === "getByRole") {
    const options = objectOptions(a1, env, sf);
    spec = { kind: "role", role: evalString(a0, env, sf) };
    if (options.name !== undefined) spec.name = options.name;
    if (options.exact) spec.exact = true;
  } else if (method === "getByLabel" || method === "getByText") {
    const options = objectOptions(a1, env, sf);
    spec = { kind: method === "getByLabel" ? "label" : "text", text: evalString(a0, env, sf) };
    if (options.exact) spec.exact = true;
  } else {
    return undefined;
  }
  if (nth !== undefined) spec.nth = nth;
  return spec;
}

function regexPattern(expr: Expr, env: SpecEnv, sf: ts.SourceFile): string {
  const e = unwrap(expr);
  if (ts.isRegularExpressionLiteral(e)) return e.text; // "/.../flags", which parseUrlPattern reads back
  return evalString(e, env, sf);
}

/** Parses one `await ...;` statement into an action. */
function parseStatement(stmt: ts.Statement, env: SpecEnv, sf: ts.SourceFile): ParsedStatement {
  const text = stmt.getText(sf);
  const where = line(stmt, sf);
  const fail = (): never => {
    throw new SpecParseError(`line ${where}: unsupported statement for healing: ${text}`);
  };
  if (!ts.isExpressionStatement(stmt)) return fail();
  const awaited = unwrap(stmt.expression);
  if (!ts.isAwaitExpression(awaited)) return fail();
  const call = unwrap(awaited.expression);
  if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return fail();
  const method = call.expression.name.text;
  const target = unwrap(call.expression.expression);
  const range = (node: ts.Node): SourceRange => ({ start: node.getStart(sf), end: node.getEnd() });
  const done = (action: ExecutedAction, locatorNode?: ts.Node): ParsedStatement => ({
    action,
    ...(locatorNode ? { locatorRange: range(locatorNode) } : {}),
    text,
    line: where,
  });

  // page.goto(url)
  if (method === "goto" && ts.isIdentifier(target) && target.text === "page" && call.arguments[0]) {
    return done({ type: "navigate", url: evalString(call.arguments[0], env, sf) });
  }

  // expect(x).toBeVisible() / toHaveURL(re) / toHaveValue(v)
  if (
    ts.isCallExpression(target) &&
    ts.isIdentifier(target.expression) &&
    target.expression.text === "expect" &&
    target.arguments[0]
  ) {
    const subject = unwrap(target.arguments[0]);
    if (method === "toHaveURL" && call.arguments[0]) {
      return done({
        type: "assert",
        kind: "url_matches",
        pattern: regexPattern(call.arguments[0], env, sf),
      });
    }
    const locator = parseLocator(subject, env, sf);
    if (!locator) return fail();
    if (method === "toBeVisible") {
      if (locator.kind === "text") {
        return done({ type: "assert", kind: "text_visible", text: locator.text, locator }, subject);
      }
      return done({ type: "assert", kind: "element_visible", locator }, subject);
    }
    if (method === "toHaveValue" && call.arguments[0]) {
      return done(
        {
          type: "assert",
          kind: "input_value",
          locator,
          value: evalString(call.arguments[0], env, sf),
        },
        subject,
      );
    }
    return fail();
  }

  // locator.click() / fill(v) / selectOption(v)
  const locator = parseLocator(target, env, sf);
  if (!locator) return fail();
  if (method === "click") return done({ type: "click", locator }, target);
  if (method === "fill" && call.arguments[0]) {
    return done({ type: "type", locator, text: evalString(call.arguments[0], env, sf) }, target);
  }
  if (method === "selectOption" && call.arguments[0]) {
    return done(
      { type: "select", locator, option: evalString(call.arguments[0], env, sf) },
      target,
    );
  }
  return fail();
}

function isCall(node: ts.Node, name: string): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === name;
  if (ts.isPropertyAccessExpression(callee)) return callee.getText() === name;
  return false;
}

function functionBody(expr: Expr | undefined): ts.NodeArray<ts.Statement> | undefined {
  if (!expr) return undefined;
  const e = unwrap(expr);
  if ((ts.isArrowFunction(e) || ts.isFunctionExpression(e)) && ts.isBlock(e.body)) {
    return e.body.statements;
  }
  return undefined;
}

/**
 * Parses a spec written by `qa-pilot export` (or hand-edited in the same style)
 * into replayable steps. Throws SpecParseError on anything it cannot replay.
 */
export function parseSpec(source: string, env: SpecEnv, fileName = "spec.ts"): ParsedSpec {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  let metadata: SpecMetadata | undefined;
  const markerLine = source.split("\n").find((l) => l.startsWith(`// ${SPEC_MARKER}`));
  if (markerLine) {
    try {
      metadata = JSON.parse(markerLine.slice(`// ${SPEC_MARKER}`.length).trim()) as SpecMetadata;
    } catch {
      // A damaged marker is not fatal; it only carries context for the model.
    }
  }

  let defaultBaseUrl: string | undefined;
  let testCall: ts.CallExpression | undefined;
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === "BASE_URL" && decl.initializer) {
          const init = unwrap(decl.initializer);
          if (
            ts.isBinaryExpression(init) &&
            init.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
          ) {
            const right = unwrap(init.right);
            if (ts.isStringLiteral(right)) defaultBaseUrl = right.text;
          }
        }
      }
    }
    if (ts.isExpressionStatement(stmt) && isCall(unwrap(stmt.expression), "test")) {
      if (testCall) throw new SpecParseError("the healer handles one test() per file");
      testCall = unwrap(stmt.expression) as ts.CallExpression;
    }
  }
  if (!testCall) throw new SpecParseError("no test(...) call found");

  const [nameArg, fnArg] = testCall.arguments;
  const testName = nameArg ? evalString(nameArg, env, sf) : "test";
  const body = functionBody(fnArg);
  if (!body) throw new SpecParseError("test() needs an inline async function");

  const steps: ParsedStep[] = [];
  for (const stmt of body) {
    if (ts.isExpressionStatement(stmt)) {
      const awaited = unwrap(stmt.expression);
      if (ts.isAwaitExpression(awaited) && isCall(unwrap(awaited.expression), "test.step")) {
        const stepCall = unwrap(awaited.expression) as ts.CallExpression;
        const [titleArg, stepFn] = stepCall.arguments;
        const stepBody = functionBody(stepFn);
        if (!stepBody)
          throw new SpecParseError(`line ${line(stmt, sf)}: test.step needs an inline function`);
        steps.push({
          ...(titleArg ? { title: evalString(titleArg, env, sf) } : {}),
          statements: stepBody.map((s) => parseStatement(s, env, sf)),
        });
        continue;
      }
    }
    steps.push({ statements: [parseStatement(stmt, env, sf)] });
  }
  return {
    testName,
    steps,
    ...(metadata ? { metadata } : {}),
    ...(defaultBaseUrl ? { defaultBaseUrl } : {}),
  };
}
