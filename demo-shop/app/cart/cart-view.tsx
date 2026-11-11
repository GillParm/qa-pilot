"use client";

import Link from "next/link";
import { useCart } from "../components/cart-context";
import { ProductArt } from "../components/product-art";
import { findProduct } from "@/lib/products";
import { formatPrice, orderTotal } from "@/lib/shop";

const QUANTITIES = [1, 2, 3, 4, 5];

export function CartView({ bugs }: { bugs: boolean }) {
  const { lines, ready, setQuantity, remove } = useCart();

  if (!ready) return <p className="mt-8 text-stone">Loading your cart</p>;

  if (lines.length === 0) {
    return (
      <p className="mt-8 text-lg">
        Your cart is empty.{" "}
        <Link href="/" className="font-semibold underline">
          Browse the products
        </Link>{" "}
        to add something.
      </p>
    );
  }

  return (
    <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <ul aria-label="Items in your cart" className="divide-y-2 divide-line border-y-2 border-line">
        {lines.map((line) => {
          const product = findProduct(line.slug);
          const selectId = `qty-${line.slug}`;
          return (
            <li key={line.slug} className="flex flex-wrap items-center gap-x-6 gap-y-3 py-5">
              {product ? <ProductArt product={product} size="sm" /> : null}
              <div className="min-w-40 flex-1">
                <Link href={`/products/${line.slug}`} className="text-lg font-bold hover:underline">
                  {line.name}
                </Link>
                <p className="text-stone">{formatPrice(line.price)} each</p>
              </div>
              <div className="flex items-center gap-3">
                <label htmlFor={selectId} className="font-semibold">
                  Quantity
                </label>
                <select
                  id={selectId}
                  aria-label={`Quantity for ${line.name}`}
                  className="select"
                  value={line.quantity}
                  onChange={(e) => setQuantity(line.slug, Number(e.target.value), bugs)}
                >
                  {QUANTITIES.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="button button-quiet"
                onClick={() => remove(line.slug)}
              >
                Remove {line.name}
              </button>
            </li>
          );
        })}
      </ul>
      <aside
        aria-label="Order summary"
        className="self-start rounded-2xl border-4 border-rim bg-white p-6"
      >
        <p className="text-xl">
          Order total{" "}
          <strong className="display ml-2 text-3xl">{formatPrice(orderTotal(lines))}</strong>
        </p>
        <p className="mt-3 text-stone">Shipping is free. Checkout is not part of this demo.</p>
      </aside>
    </div>
  );
}
