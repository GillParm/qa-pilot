// Exported by qa-pilot 0.1.0 from run 20261111-002957-sign-up-accepts-an-email-with-a-plus-sign.
// Instruction: Sign up as Ada with a new email address that contains a plus sign, such as ada+something@example.com, and a password of at least 8 characters. Check that the welcome message for Ada appears.
// Replays the recorded steps with plain Playwright; no model is called.
// Point it at another deployment with QA_PILOT_BASE_URL=https://... npx playwright test
// qa-pilot: {"generator":"qa-pilot","version":"0.1.0","run":"20261111-002957-sign-up-accepts-an-email-with-a-plus-sign","instruction":"Sign up as Ada with a new email address that contains a plus sign, such as ada+something@example.com, and a password of at least 8 characters. Check that the welcome message for Ada appears.","startUrl":"http://localhost:3200/signup","model":"anthropic/claude-opus-5-5"}
import { expect, test } from "@playwright/test";

const BASE_URL = process.env.QA_PILOT_BASE_URL ?? "http://localhost:3200";
// Values that must be new on every run (emails, usernames) include this.
const RUN = Date.now().toString(36);

test("Sign-up accepts an email with a plus sign", async ({ page }) => {
  await page.goto(new URL("/signup", BASE_URL).toString());

  await test.step("Enter name Ada", async () => {
    await page.getByLabel("Name", { exact: true }).fill("Ada");
  });

  await test.step("Enter email with plus sign", async () => {
    await page.getByLabel("Email", { exact: true }).fill(`ada+${RUN}@example.com`);
  });

  await test.step("Enter an 8+ character password", async () => {
    await page.getByLabel("Password", { exact: true }).fill("Ember2024!");
  });

  await test.step("Submit the sign-up form", async () => {
    await page.getByRole("button", { name: "Create account", exact: true }).click();
  });

  await test.step("Verify welcome message for Ada", async () => {
    await expect(page.getByText("Welcome, Ada")).toBeVisible();
  });

  // Run summary: Signed up as Ada with ada+qa9d2e76@example.com and an 8+ character password; "Welcome, Ada" message appeared, confirming the account for the plus-sign email.
});
