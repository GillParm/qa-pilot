# qa-pilot (package)

The library and CLI behind qa-pilot: an agent that tests web apps from plain-English instructions, records evidence,
exports passing runs as Playwright specs and heals specs whose selectors broke.

See the [repository README](../../README.md) for usage, the GitHub Action and the measured results.

## Library use

```ts
import { createProvider, exportSpec, runAgent } from "qa-pilot";

const { record, runDir } = await runAgent({
  instruction: "Add the trail mug to the cart and check the cart link shows 1 item",
  url: "http://localhost:3200/products/trail-mug",
  provider: createProvider({ provider: "anthropic" }),
  limits: { maxSteps: 15, maxCostUsd: 0.5 },
});

console.log(record.verdict, record.summary, `${runDir}/report.html`);
if (record.verdict === "pass") console.log(exportSpec(record));
```

## Source map

| Path            | What lives there                                                              |
| --------------- | ----------------------------------------------------------------------------- |
| `src/agent/`    | the step loop, prompts, limits and cost tracking                              |
| `src/snapshot/` | capturing, trimming and rendering the ARIA snapshot                           |
| `src/locator/`  | locator specs, rendering them as code, resolving refs to locators             |
| `src/actions/`  | the six tool schemas and the executor                                         |
| `src/llm/`      | the provider interface, Anthropic, Gemini, the scripted fake, prices, retries |
| `src/evidence/` | run folders, screenshots, video, console and network capture                  |
| `src/report/`   | the HTML report                                                               |
| `src/export/`   | run.json to `.spec.ts`                                                        |
| `src/heal/`     | parsing specs and repairing broken locators                                   |
| `src/suite/`    | suite YAML, the runner, Markdown and HTML summaries                           |
| `src/ci/`       | Playwright JSON reports and the pull request comment                          |
| `src/cli.ts`    | the `qa-pilot` command                                                        |
