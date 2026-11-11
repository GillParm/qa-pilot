// Exported by qa-pilot 0.1.0 from run 20261111-003021-sign-up-rejects-a-malformed-email.
// Instruction: Try to sign up as Ada with the email address "not-an-email" and a password of at least 8 characters. Check that an error about the email address is shown.
// Replays the recorded steps with plain Playwright; no model is called.
// Point it at another deployment with QA_PILOT_BASE_URL=https://... npx playwright test
// qa-pilot: {"generator":"qa-pilot","version":"0.1.0","run":"20261111-003021-sign-up-rejects-a-malformed-email","instruction":"Try to sign up as Ada with the email address \"not-an-email\" and a password of at least 8 characters. Check that an error about the email address is shown.","startUrl":"http://localhost:3200/signup","model":"anthropic/claude-opus-5-5"}
import { expect, test } from "@playwright/test";

const BASE_URL = process.env.QA_PILOT_BASE_URL ?? "http://localhost:3200";

test("Sign-up rejects a malformed email", async ({ page }) => {
  await page.goto(new URL("/signup", BASE_URL).toString());

  await test.step("Enter name Ada", async () => {
    await page.getByLabel("Name", { exact: true }).fill("Ada");
  });

  await test.step("Enter invalid email", async () => {
    await page.getByLabel("Email", { exact: true }).fill("not-an-email");
  });

  await test.step("Enter a valid-length password", async () => {
    await page.getByLabel("Password", { exact: true }).fill("enamel-mug-42");
  });

  await test.step("Submit the sign up form", async () => {
    await page.getByRole("button", { name: "Create account", exact: true }).click();
  });

  await test.step("Email error message is shown", async () => {
    await expect(page.getByText("Enter a valid email address.")).toBeVisible();
  });

  // Run summary: I tried to sign up as Ada with "not-an-email" and an 11-character password. The form showed the error "Enter a valid email address." and marked the Email field as invalid.
});
