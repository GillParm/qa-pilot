import { describe, expect, it } from "vitest";
import { filterByTags, parseSuite, resolveTests, SuiteError } from "../../src/suite/config.js";

const yaml = `
name: Demo shop
baseUrl: http://localhost:3200
limits:
  maxSteps: 20
tests:
  - name: Cart total follows quantity
    path: /products/trail-mug
    instruction: Add the mug to the cart, set quantity to 3 and check the total is $54.00.
    tags: [cart]
  - name: Known bug stays visible
    url: http://localhost:3200/signup
    instruction: Sign up with ada+test@example.com.
    expect: fail
    tags: [signup, known-bug]
    limits:
      maxCostUsd: 0.25
`;

describe("parseSuite", () => {
  it("parses a suite and fills defaults", () => {
    const suite = parseSuite(yaml);
    expect(suite.name).toBe("Demo shop");
    expect(suite.limits).toEqual({ maxSteps: 20 });
    expect(suite.tests[0]).toMatchObject({ expect: "pass", tags: ["cart"] });
    expect(suite.tests[1]).toMatchObject({ expect: "fail", limits: { maxCostUsd: 0.25 } });
  });

  it("names the field that is wrong", () => {
    expect(() =>
      parseSuite(
        `name: x\ntests:\n  - name: a\n    instruction: b\n    expect: maybe\n`,
        "bad.yaml",
      ),
    ).toThrow(/bad\.yaml is not a valid suite:\n {2}tests\.0\.expect/);
    expect(() => parseSuite(`name: x\ntests: []\n`)).toThrow(/tests/);
    expect(() =>
      parseSuite(`name: x\ntests:\n  - name: a\n    instruction: b\n    colour: red\n`),
    ).toThrow(/Unrecognized key/);
  });

  it("rejects url and path together, duplicates and broken YAML", () => {
    expect(() =>
      parseSuite(
        `name: x\ntests:\n  - name: a\n    instruction: b\n    url: http://a.test/\n    path: /b\n`,
      ),
    ).toThrow(/either url or path/);
    expect(() =>
      parseSuite(`name: x\ntests:\n  - {name: a, instruction: b}\n  - {name: a, instruction: c}\n`),
    ).toThrow(/duplicate test name "a"/);
    expect(() => parseSuite("name: [unclosed")).toThrow(SuiteError);
  });
});

describe("resolveTests", () => {
  const suite = parseSuite(yaml);

  it("joins baseUrl and path, and keeps full urls", () => {
    const tests = resolveTests(suite);
    expect(tests.map((t) => t.startUrl)).toEqual([
      "http://localhost:3200/products/trail-mug",
      "http://localhost:3200/signup",
    ]);
  });

  it("points every test at an override base URL, such as a preview deployment", () => {
    const tests = resolveTests(suite, "https://pr-12.preview.test");
    expect(tests.map((t) => t.startUrl)).toEqual([
      "https://pr-12.preview.test/products/trail-mug",
      "https://pr-12.preview.test/signup",
    ]);
  });

  it("needs a base URL for path-only tests", () => {
    const noBase = parseSuite(`name: x\ntests:\n  - {name: a, instruction: b, path: /x}\n`);
    expect(() => resolveTests(noBase)).toThrow(/no baseUrl/);
  });

  it("filters by tag", () => {
    const tests = resolveTests(suite);
    expect(filterByTags(tests, ["signup"]).map((t) => t.name)).toEqual(["Known bug stays visible"]);
    expect(filterByTags(tests, [])).toHaveLength(2);
  });
});
