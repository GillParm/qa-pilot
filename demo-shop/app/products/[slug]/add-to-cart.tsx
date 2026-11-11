"use client";

import { useState } from "react";
import { useCart } from "../../components/cart-context";

export function AddToCart({
  product,
  label,
}: {
  product: { slug: string; name: string; price: number };
  label: string;
}) {
  const { add, ready, lines } = useCart();
  const [added, setAdded] = useState(false);
  const inCart = lines.find((l) => l.slug === product.slug)?.quantity ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      {/* Disabled until the cart has loaded, so an early click is never lost. */}
      <button
        type="button"
        className="button"
        disabled={!ready}
        onClick={() => {
          add(product);
          setAdded(true);
        }}
      >
        {label}
      </button>
      <p role="status" className="font-semibold">
        {added ? `Added to cart. ${inCart} in your cart.` : ""}
      </p>
    </div>
  );
}
