### qa-pilot: Tin & Ember demo shop

**All 5 tests ended as expected.** 5 passed, 0 failed. Model gemini-3.5-flash-lite, 28 steps, $0.02, 3 min 3 s.

| Test | Expected | Result | Steps | Cost | What happened |
| --- | --- | --- | ---: | ---: | --- |
| Product page shows the price | pass | pass | 4 | $0.0034 | Opened the Trail mug product page from the product list and verified the price is $18.00. |
| Adding to the cart updates the cart count | pass | pass | 5 | $0.0041 | Added the trail mug to the cart and verified the cart link in the header shows 1 item. |
| Order total follows the quantity | pass | pass | 6 | $0.0049 | Trail mug added to cart, quantity changed to 3, and order total verified as $54.00. |
| Sign-up accepts an email with a plus sign | pass | pass | 7 | $0.0055 | Signed up as Ada with ada+qaa3e9c2@example.com and verified the welcome message. |
| Sign-up rejects a malformed email | pass | pass | 6 | $0.0048 | Tried to sign up with invalid email 'not-an-email', verified that the email error message 'Enter a valid email address.' is shown. |
