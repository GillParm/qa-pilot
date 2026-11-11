### qa-pilot: Tin & Ember demo shop

**3 of 5 tests did not end as expected.** 2 passed, 2 failed, 1 stopped. Model gemini-3.5-flash-lite, 47 steps, $0.04, 6 min 7 s.

| Test | Expected | Result | Steps | Cost | What happened |
| --- | --- | --- | ---: | ---: | --- |
| Product page shows the price | pass | pass | 15 | $0.01 | Successfully opened Trail mug product page and verified price $18.00. |
| Adding to the cart updates the cart count | pass | **stopped** | 15 | $0.01 | Stopped: step limit reached (15 steps). |
| Order total follows the quantity | pass | **fail** | 4 | $0.0031 | Assertion failed at step 4 (Check order total is $54.00): text "$54.00" was not visible within 10s |
| Sign-up accepts an email with a plus sign | pass | **fail** | 5 | $0.0039 | The application rejected a valid email address with a plus sign, preventing signup. |
| Sign-up rejects a malformed email | pass | pass | 8 | $0.0063 | Successfully attempted sign up with invalid email 'not-an-email' and verified the validation error message 'Enter a valid email address.' is displayed. |
