### qa-pilot: Tin & Ember demo shop

**All 5 tests ended as expected.** 5 passed, 0 failed. Model claude-opus-5-5, 24 steps, $0.38, 1 min 46 s.

| Test | Expected | Result | Steps | Cost | What happened |
| --- | --- | --- | ---: | ---: | --- |
| Product page shows the price | pass | pass | 4 | $0.07 | Opened Trail mug from the product list. The product page at /products/trail-mug shows the price $18.00. |
| Adding to the cart updates the cart count | pass | pass | 3 | $0.05 | Adding the trail mug to the cart updated the header cart link to "Cart (1)". |
| Order total follows the quantity | pass | pass | 5 | $0.08 | Added the trail mug to the cart and set quantity to 3. The order total showed $54.00 (3 × $18.00), as expected. |
| Sign-up accepts an email with a plus sign | pass | pass | 6 | $0.09 | Signed up as Ada with ada+qa9d2e76@example.com and an 8+ character password; "Welcome, Ada" message appeared, confirming the account for the plus-sign email. |
| Sign-up rejects a malformed email | pass | pass | 6 | $0.09 | I tried to sign up as Ada with "not-an-email" and an 11-character password. The form showed the error "Enter a valid email address." and marked the Email field as invalid. |
