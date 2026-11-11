// Exported by qa-pilot 0.1.0 from run 20261111-002924-adding-to-the-cart-updates-the-cart-count.
// Instruction: Add the trail mug to the cart and check that the cart link in the header now shows 1 item.
// Replays the recorded steps with plain Playwright; no model is called.
// Point it at another deployment with QA_PILOT_BASE_URL=https://... npx playwright test
// qa-pilot: {"generator":"qa-pilot","version":"0.1.0","run":"20261111-002924-adding-to-the-cart-updates-the-cart-count","instruction":"Add the trail mug to the cart and check that the cart link in the header now shows 1 item.","startUrl":"http://localhost:3200/products/trail-mug","model":"anthropic/claude-opus-5-5"}
import { expect, test } from "@playwright/test";

const BASE_URL = process.env.QA_PILOT_BASE_URL ?? "http://localhost:3200";

test("Adding to the cart updates the cart count", async ({ page }) => {
  await page.goto(new URL("/products/trail-mug", BASE_URL).toString());

  await test.step("Add the trail mug to the cart", async () => {
    await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  });

  await test.step("Cart link shows 1 item", async () => {
    await expect(page.getByText("Cart (1)")).toBeVisible();
  });

  // Run summary: Adding the trail mug to the cart updated the header cart link to "Cart (1)".
});
