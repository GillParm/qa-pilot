# Live results

Everything here was measured on real runs on 2026-11-11 (UTC) on a MacBook (Apple silicon), with the demo shop served
by `next start` on localhost. The raw outputs are committed next to this file in [live-runs](live-runs); every number
below can be checked against a `summary.json`, a `run.json` or a Playwright JSON report there. Costs are computed from
the token usage each API response reported and the list prices in
[`pricing.ts`](../packages/qa-pilot/src/llm/pricing.ts); they are estimates, not invoices.

## 1. Sample suite with Claude, bugs on

`npx qa-pilot suite examples/demo-shop.suite.yaml` against the demo shop with its default settings (both seeded bugs
on). Model `claude-opus-5-5`, effort `medium` (the default). Raw data:
[2026-11-11-claude-bugs-on](live-runs/2026-11-11-claude-bugs-on).

| Test                                      | Expected | Result             | Steps | Tokens in / out |      Cost |       Time |
| ----------------------------------------- | -------- | ------------------ | ----: | --------------- | --------: | ---------: |
| Product page shows the price              | pass     | pass               |     4 | 13,211 / 583    |    $0.065 |     19.9 s |
| Adding to the cart updates the cart count | pass     | pass               |     3 | 9,608 / 461     |    $0.048 |     19.4 s |
| Order total follows the quantity          | pass     | **fail**           |     4 | 12,923 / 612    |    $0.064 |     31.1 s |
| Sign-up accepts an email with a plus sign | pass     | **fail**           |     5 | 15,781 / 842    |    $0.080 |     21.2 s |
| Sign-up rejects a malformed email         | pass     | pass               |     6 | 18,881 / 887    |    $0.093 |     22.0 s |
| **Suite**                                 |          | 3 of 5 as expected |    22 | 70,404 / 3,385  | **$0.35** | 1 min 54 s |

Both seeded bugs were caught, in two different ways:

- **Bug 1 (order total).** The model added the mug, opened the cart, set the quantity to 3 and asserted that "$54.00"
  was visible. The assertion waited the full 10 seconds and failed; the screenshot shows "Order total $18.00". Its
  reasoning for that step: "Three trail mugs at $18.00 each should total $54.00. The summary still shows $18.00, but
  the assertion will wait in case it is still updating."
- **Bug 2 (plus-sign email).** After submitting the form the model saw the error and ended the test with
  `done(fail)`: "Signup fails for a valid email with a plus sign (ada+qa07aea1@example.com). The form shows "Enter a
  valid email address.", marks the Email field invalid and stays on /signup. No welcome message for Ada appears."

The suite exited with code 1.

## 2. Sample suite with Claude, bugs off

Same command with `DEMO_BUGS=off` and `--export-dir examples/specs`. Raw data:
[2026-11-11-claude-bugs-off](live-runs/2026-11-11-claude-bugs-off).

| Test                                      | Expected | Result             | Steps | Tokens in / out |      Cost |       Time |
| ----------------------------------------- | -------- | ------------------ | ----: | --------------- | --------: | ---------: |
| Product page shows the price              | pass     | pass               |     4 | 13,218 / 798    |    $0.069 |     20.1 s |
| Adding to the cart updates the cart count | pass     | pass               |     3 | 9,614 / 491     |    $0.048 |     13.6 s |
| Order total follows the quantity          | pass     | pass               |     5 | 16,213 / 727    |    $0.079 |     19.7 s |
| Sign-up accepts an email with a plus sign | pass     | pass               |     6 | 18,959 / 896    |    $0.094 |     24.0 s |
| Sign-up rejects a malformed email         | pass     | pass               |     6 | 18,877 / 874    |    $0.093 |     28.2 s |
| **Suite**                                 |          | 5 of 5 as expected |    24 | 76,881 / 3,786  | **$0.38** | 1 min 46 s |

The suite exited with code 0 and exported one spec per test into [examples/specs](../examples/specs). Those files are
committed exactly as exported.

Across both suite runs a step cost about $0.016 on average (46 model calls, $0.73). Steps took 2.8 to 7.5 seconds,
apart from the failing assertion's 10-second wait; model latency alone ranged from 2.1 to 7.1 seconds with a median of
3.2 seconds. Each request carried about 3,200 input tokens: the fixed system prompt and tool schemas, the
instruction, the step history and the snapshot.

## 3. Replaying the exported specs, no model

`npx playwright test -c examples/playwright.config.ts`, with `QA_PILOT_BASE_URL` pointing at each server. Raw
Playwright JSON reports: [2026-11-11-replay-exported-specs](live-runs/2026-11-11-replay-exported-specs).

| Server   | Passed | Failed                                                                                | Wall time |
| -------- | -----: | ------------------------------------------------------------------------------------- | --------: |
| Bugs off |      5 | 0                                                                                     |     2.2 s |
| Bugs on  |      3 | 2: "Order total follows the quantity" and "Sign-up accepts an email with a plus sign" |    13.2 s |

The two failures are both `expect(locator).toBeVisible()` timing out on `getByText('$54.00')` and
`getByText('Welcome, Ada')`. In other words the exported specs catch both bugs on their own, in seconds and for free.
The sign-up spec uses `` `ada+${RUN}@example.com` `` and was replayed several times against the same server without
hitting "An account with this email already exists."

## 4. Healing a renamed button

The demo shop was started with `DEMO_RENAME=1`, which renames "Add to cart" to "Add to bag". Transcript and files:
[2026-11-11-heal-renamed-button](live-runs/2026-11-11-heal-renamed-button).

1. The exported `order-total-follows-the-quantity.spec.ts` failed under `playwright test`: `locator.click: Timeout
8000ms exceeded` waiting for `getByRole('button', { name: 'Add to cart', exact: true })`.
2. `qa-pilot heal ... --url http://localhost:3202` (no `--write`) replayed the spec, found the broken click, and made
   one model call. Claude proposed the "Add to bag" button: "The "Add to cart" button looks like it was renamed to "Add
   to bag". It's the only add action on the trail mug product page, so it does the same job." The healer verified it
   by clicking, ran the remaining three steps, re-ran the healed spec from a clean context, printed the diff and left
   the file unchanged. Cost: $0.0078.
3. The same command with `--write` saved the file (another $0.0078).
4. The healed spec passed under `playwright test` against the renamed shop in 974 ms.

## 5. Gemini development run

Before the Claude runs, the suite was run once with `gemini-3.5-flash-lite` on the free tier against the bugs-on shop,
using an earlier build. Raw data: [2026-11-11-gemini-dev-run](live-runs/2026-11-11-gemini-dev-run).

| Test                                      | Result                                                           | Steps |
| ----------------------------------------- | ---------------------------------------------------------------- | ----: |
| Product page shows the price              | pass, after asserting "$18.00" thirteen times                    |    15 |
| Adding to the cart updates the cart count | stopped at the 15-step limit, asserting "Cart (1)" over and over |    15 |
| Order total follows the quantity          | fail: caught bug 1                                               |     4 |
| Sign-up accepts an email with a plus sign | fail: caught bug 2 with `done(fail)`                             |     5 |
| Sign-up rejects a malformed email         | pass                                                             |     8 |

List-price cost $0.04 (actual cost $0, free tier); 6 min 7 s, partly because several calls needed a second attempt
(recorded per step in the console output) and some single calls took over 40 seconds.
The repeated assertions led to the guard that now refuses an assertion that has already passed and points the model
at `done`, plus a line in the system prompt. The Gemini runs with the current build are described below if they were
completed.

## 6. What was not measured

- The AI suite inside GitHub Actions: the repository has no `ANTHROPIC_API_KEY` secret, so the workflow skips it. The
  same commands were run locally (sections 1 and 2).
- Accuracy over many runs. Each Claude suite ran once per mode; these numbers show the tool working, not a
  statistically meaningful pass rate.
- Other models (`claude-sonnet-5-5`, `claude-haiku-5-5`, `gemini-3.8-flash`): supported by the price table and the
  `--model` flag but not run.

## Spend while building

Anthropic usage for building this project, from the costs recorded in the run data: one provider smoke test ($0.011),
the two suite runs ($0.35 and $0.38), two heal calls ($0.016) and one run of the live test (its run folder is
temporary; capped at $0.30 by the test). That is at most $1.06 of the $15 budget. Gemini runs used the free tier.
