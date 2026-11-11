// Exported by qa-pilot 0.1.0 from run 20261111-002938-order-total-follows-the-quantity.
// Instruction: Add the trail mug ($18.00) to the cart, open the cart, change its quantity to 3 and check that the order total is $54.00.
// Replays the recorded steps with plain Playwright; no model is called.
// Point it at another deployment with QA_PILOT_BASE_URL=https://... npx playwright test
// qa-pilot: {"generator":"qa-pilot","version":"0.1.0","run":"20261111-002938-order-total-follows-the-quantity","instruction":"Add the trail mug ($18.00) to the cart, open the cart, change its quantity to 3 and check that the order total is $54.00.","startUrl":"http://localhost:3200/products/trail-mug","model":"anthropic/claude-opus-5-5"}
import { expect, test } from "@playwright/test";

const BASE_URL = process.env.QA_PILOT_BASE_URL ?? "http://localhost:3200";

test("Order total follows the quantity", async ({ page }) => {
  await page.goto(new URL("/products/trail-mug", BASE_URL).toString());

  await test.step("Add the trail mug to the cart", async () => {
    await page.getByRole("button", { name: "Add to bag", exact: true }).click();
  });

  await test.step("Open the cart", async () => {
    await page.getByRole("link", { name: "Cart (1)", exact: true }).click();
  });

  await test.step("Set trail mug quantity to 3", async () => {
    await page.getByLabel("Quantity for Trail mug", { exact: true }).selectOption("3");
  });

  await test.step("Verify order total is $54.00", async () => {
    await expect(page.getByText("$54.00")).toBeVisible();
  });

  // Run summary: Added the trail mug to the cart and set quantity to 3. The order total showed $54.00 (3 × $18.00), as expected.
});
