import type { Metadata } from "next";
import { Suspense } from "react";
import { CartView } from "./cart-view";
import { readFlags } from "@/lib/flags";

export const metadata: Metadata = { title: "Your cart" };

async function CartWithFlags() {
  const flags = await readFlags();
  return <CartView bugs={flags.bugs} />;
}

export default function CartPage() {
  return (
    <>
      <h1 className="display text-4xl sm:text-5xl">Your cart</h1>
      <Suspense fallback={<p className="mt-8 text-stone">Loading your cart</p>}>
        <CartWithFlags />
      </Suspense>
    </>
  );
}
