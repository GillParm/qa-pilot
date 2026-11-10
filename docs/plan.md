# qa-pilot plan

qa-pilot is a command-line tool and library that tests a web app from a plain-English instruction. It drives a real
browser with Playwright, lets a language model pick one action at a time from an accessibility snapshot, and reports
pass or fail with evidence. A passing run can be exported as an ordinary Playwright test that replays the same flow
with no model involved, and a broken export can be repaired ("healed") when a selector changes.

This document is the plan written before the code. Decisions that changed during the build are noted in the README.

## Goals

- `qa-pilot run "<instruction>" --url <url>` returns pass or fail, with a run folder full of evidence.
- Every executed action maps to a Playwright locator built from role, accessible name and position, so the run can be
  replayed deterministically.
- `qa-pilot export <run-dir>` writes a `.spec.ts` that runs green with `npx playwright test` and no API key.
- `qa-pilot heal <spec> --url <url>` repairs a spec whose selector broke, shows a unified diff and writes only with
  `--write`.
- `qa-pilot suite tests.yaml` runs many instructions and writes a summary that a GitHub Action can post on a pull
  request.
- Hard limits on steps, cost and time, so a confused model cannot run up a bill or hang CI.

## Non-goals

- Visual testing, multi-tab flows, file uploads, drag and drop, iframes beyond what the snapshot already includes.
- A hosted service. Everything runs locally or in CI.
- Publishing to npm in this iteration (the package is publishable, but the Action builds from source).

## Architecture

```
instruction + url
      │
      ▼
 ┌──────────┐  snapshot (ARIA, ai mode, refs)   ┌──────────────┐
 │  Agent   │ ─────────────────────────────────▶│ LLM provider │  Anthropic / Gemini / scripted fake
 │  loop    │ ◀──────────── one tool call ──────│  interface   │
 └────┬─────┘  click|type|select|navigate|      └──────────────┘
      │        assert|done + reasoning
      ▼
 ref ─▶ locator resolver (getByRole / getByLabel / getByText, + nth) ─▶ Playwright executes
      │
      ▼
 Evidence recorder: run.json, screenshot per step, video, console errors, failed requests
      │
      ├──▶ report.html (self-contained)
      └──▶ exporter ─▶ <name>.spec.ts ─▶ healer (when a locator breaks)
```

### Snapshot

Playwright 1.65 has `page.ariaSnapshotJSON({ mode: "ai" })`, which returns the accessibility tree with element refs
(`e12`) and `page.getByRef()` to resolve them. qa-pilot uses the JSON form, trims it (drops unnamed wrappers, long text,
long option lists, cursor hints), and renders a compact YAML-like text for the model. The model cites refs; it never
writes selectors.

### From ref to locator

When the model picks `e12`, qa-pilot grabs the element handle for that ref, then tries candidate locators in order:
`getByLabel(name, exact)` for form controls, `getByRole(role, { name, exact })`, the same with `.nth(i)`, and finally
`getByRole(role).nth(i)`. The first candidate that resolves to exactly that element wins. The result is stored as data
(`{ kind: "role", role: "button", name: "Add to cart", exact: true, nth: 1 }`), which is what makes export
deterministic: the exporter only turns that data into code.

### Actions

Exactly six tools: `click`, `type`, `select`, `navigate`, `assert`, `done`. Every call carries a short `intent`
(used as the step title in exports and as the healing hint) and `reasoning` (shown in the report). `assert` has four
kinds: text visible, element visible, URL matches, input value. `done` carries pass or fail and a summary.

A failed assertion fails the run immediately, like a test assertion would. Action errors (element not found, not
clickable) are fed back to the model so it can recover, within a retry limit.

### Providers

`LLMProvider.chooseTool(request)` takes a system prompt, messages and tool schemas, and returns one tool call plus token
usage. Implementations:

- Anthropic (default `claude-opus-5-5`): tool use with `tool_choice: auto` (forced choice is rejected on this model),
  strict tool schemas, effort set through `output_config`, refusal handling.
- Gemini (`gemini-3.5-flash-lite`): function calling through `@google/genai`, mode `ANY`.
- Fake: a scripted provider for tests that targets elements by role and name and finds the ref itself.

Each step is a single stateless request: system prompt, instruction, a short history of earlier steps and the current
snapshot. That keeps cost per step bounded, works the same across providers and avoids replaying thinking blocks.

### Limits

`maxSteps` (25), `maxCostUsd` (1.00, from a per-model price table), per-action timeout, whole-run timeout, LLM retries
with exponential backoff and jitter (honouring `retry-after`), and action retries.

### Evidence

`qa-pilot-runs/<timestamp>-<slug>/` holds `run.json`, `steps/NN.png`, `video.webm`, and `report.html`. Console errors
and failed requests (`requestfailed` and HTTP status >= 400) are attached to the step during which they happened.

### Export

The exporter writes one `test()` with one `test.step()` per action, titled with the step intent. Navigation is written
relative to a `BASE_URL` constant that reads `QA_PILOT_BASE_URL`, so the same spec runs against localhost or a preview
deployment. Values the model marked as unique per run (a new account email) become a timestamped variable. A
`qa-pilot` metadata comment records the instruction, source run and model.

### Healing

`qa-pilot heal` parses the spec with the TypeScript compiler API, replays each step in a real browser, and when an
interaction's locator no longer resolves it sends the step intent, the old locator and the current snapshot to the
model. The proposed ref is turned back into a locator by the same resolver, verified by performing the action, and the
replay continues. Assertions are never healed, because a missing element there is usually the bug the test exists to
catch. The result is a unified diff; `--write` saves it.

## Demo shop

Next.js 16 app on port 3200 with an in-memory catalogue, product pages, a cart and a sign-up form. Two seeded bugs,
on by default and switched off with `DEMO_BUGS=off`:

1. Changing an item's quantity in the cart does not update the order total.
2. Sign-up rejects valid email addresses that contain `+`.

`DEMO_RENAME=1` renames the "Add to cart" button to "Add to bag", which breaks exported specs and gives the healer
something to fix.

## Milestones

1. Plan and scaffold: workspaces, TypeScript, lint, vitest, CI skeleton.
2. Core: snapshot, locator resolver, actions, providers, limits, evidence capture, agent loop.
3. HTML report.
4. Export to Playwright.
5. Self-healing.
6. CLI and suite runner.
7. Demo shop and sample suite.
8. GitHub Action and CI.
9. Live runs with a real model and the README.

## Testing

- Unit (vitest): snapshot trimming, locator mapping, exporter output, heal parsing and diffs, limits and cost
  accounting, YAML parsing, report generation.
- Integration: the agent loop with the fake provider against the demo shop (bugs on and off), an exported spec run with
  `playwright test`, and a heal of a renamed button.
- Live: one test behind `QA_PILOT_LIVE=1` that calls a real model; skipped without keys.

## Budget

Anthropic spend for building this is capped at $15. Development iterations use the scripted fake or the Gemini free
tier. Live Claude runs are the sample suite with bugs on and off and one heal demo; their raw outputs are committed under
`docs/live-runs/`.
