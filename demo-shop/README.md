# Tin & Ember demo shop

A small Next.js 16 store with two bugs planted on purpose, used as the target for qa-pilot's sample suite and tests.
Everything is in memory: the catalogue is a module, the cart lives in `localStorage`, and accounts are kept in a `Map`
until the server restarts.

Pages: the product list (`/`), a page per product (`/products/trail-mug`), the cart (`/cart`) and sign-up (`/signup`).

## Run it

```bash
npm run build -w demo-shop
npm run start -w demo-shop                    # http://localhost:3200, bugs on
DEMO_BUGS=off npm run start -w demo-shop      # bugs off
DEMO_RENAME=1 npm run start -w demo-shop      # "Add to cart" becomes "Add to bag"
```

The switches are read at request time, so one build serves every combination. To run two at once, pass a different
port: `DEMO_BUGS=off npx next start --port 3201` from this folder.

## The seeded bugs

Both live in `lib/shop.ts` and are on unless `DEMO_BUGS=off`.

1. **The order total ignores quantity changes.** Changing a line's quantity in the cart updates the quantity and the
   header count, but the order total keeps the old line total. One trail mug at $18.00 set to 3 still shows
   "Order total $18.00" instead of $54.00.
2. **Sign-up rejects valid emails that contain "+".** The email pattern leaves `+` out of the local part, so
   `ada+test@example.com` gets "Enter a valid email address." The check runs in a server action, so the bug is
   server-side.

## The rename switch

`DEMO_RENAME=1` changes the product page button from "Add to cart" to "Add to bag". Nothing else changes, which makes
it a clean way to break a selector in an exported spec and watch `qa-pilot heal` repair it.

## Notes for test authors

- The "Add to cart" button stays disabled until the cart has loaded from storage, so an early click is never lost.
- Cart quantity pickers are labelled per item, for example "Quantity for Trail mug".
- The page does not reveal whether bugs are on; a tester has to find out.
