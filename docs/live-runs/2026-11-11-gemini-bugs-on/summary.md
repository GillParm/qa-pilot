### qa-pilot: Tin & Ember demo shop

**2 of 5 tests did not end as expected.** 3 passed, 2 failed. Model gemini-3.5-flash-lite, 24 steps, $0.02, 2 min 15 s.

| Test | Expected | Result | Steps | Cost | What happened |
| --- | --- | --- | ---: | ---: | --- |
| Product page shows the price | pass | pass | 4 | $0.0034 | Successfully navigated to Trail mug product page and verified the price $18.00. |
| Adding to the cart updates the cart count | pass | pass | 4 | $0.0032 | Successfully added the trail mug to the cart and verified the cart link shows 1 item. |
| Order total follows the quantity | pass | **fail** | 4 | $0.0032 | Assertion failed at step 4 (Check that order total is $54.00): text "$54.00" was not visible within 10s |
| Sign-up accepts an email with a plus sign | pass | **fail** | 6 | $0.0048 | The app rejects email addresses containing a plus sign (e.g. ada+qa7bce1e@example.com) as invalid, failing the requirement. |
| Sign-up rejects a malformed email | pass | pass | 6 | $0.0048 | Successfully tested signup with an invalid email address and verified the error message is displayed. |
