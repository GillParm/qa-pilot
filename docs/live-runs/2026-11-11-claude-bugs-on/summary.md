### qa-pilot: Tin & Ember demo shop

**2 of 5 tests did not end as expected.** 3 passed, 2 failed. Model claude-opus-5-5, 22 steps, $0.35, 1 min 54 s.

| Test | Expected | Result | Steps | Cost | What happened |
| --- | --- | --- | ---: | ---: | --- |
| Product page shows the price | pass | pass | 4 | $0.06 | Opened the Trail mug product page from the product list and confirmed it shows the price $18.00. |
| Adding to the cart updates the cart count | pass | pass | 3 | $0.05 | Clicking "Add to cart" on the trail mug page changed the header cart link to "Cart (1)", as expected. |
| Order total follows the quantity | pass | **fail** | 4 | $0.06 | Assertion failed at step 4 (Check order total is $54.00): text "$54.00" was not visible within 10s |
| Sign-up accepts an email with a plus sign | pass | **fail** | 5 | $0.08 | Signup fails for a valid email with a plus sign (ada+qa07aea1@example.com). The form shows "Enter a valid email address.", marks the Email field invalid and stays on /signup. No welcome message for Ada appears. |
| Sign-up rejects a malformed email | pass | pass | 6 | $0.09 | I signed up as Ada with the email "not-an-email" and a valid 8+ character password. The form showed the error "Enter a valid email address." and flagged the Email field as invalid. |
