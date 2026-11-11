// Exported by qa-pilot 0.1.0 from run 20261111-002904-product-page-shows-the-price.
// Instruction: From the product list, open the Trail mug product page and check that it shows the price $18.00.
// Replays the recorded steps with plain Playwright; no model is called.
// Point it at another deployment with QA_PILOT_BASE_URL=https://... npx playwright test
// qa-pilot: {"generator":"qa-pilot","version":"0.1.0","run":"20261111-002904-product-page-shows-the-price","instruction":"From the product list, open the Trail mug product page and check that it shows the price $18.00.","startUrl":"http://localhost:3200/","model":"anthropic/claude-opus-5-5"}
import { expect, test } from "@playwright/test";

const BASE_URL = process.env.QA_PILOT_BASE_URL ?? "http://localhost:3200";

test("Product page shows the price", async ({ page }) => {
  await page.goto(new URL("/", BASE_URL).toString());

  await test.step("Open the Trail mug product page", async () => {
    await page.getByRole("link", { name: "Trail mug", exact: true }).click();
  });

  await test.step("Verify Trail mug price is $18.00", async () => {
    await expect(page.getByText("$18.00").first()).toBeVisible();
  });

  await test.step("Verify Trail mug product page opened", async () => {
    await expect(page).toHaveURL(/\/products\/trail-mug/);
  });

  // Run summary: Opened Trail mug from the product list. The product page at /products/trail-mug shows the price $18.00.
});
