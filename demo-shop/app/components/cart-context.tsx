"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { addLine, itemCount, removeLine, setLineQuantity, type CartLine } from "@/lib/shop";

const STORAGE_KEY = "tin-and-ember-cart";

interface CartState {
  lines: CartLine[];
  count: number;
  /** False until the cart has been read from storage; buttons wait for it. */
  ready: boolean;
  add: (product: { slug: string; name: string; price: number }) => void;
  setQuantity: (slug: string, quantity: number, bugs: boolean) => void;
  remove: (slug: string) => void;
}

const CartContext = createContext<CartState | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after mount
      if (saved) setLines(JSON.parse(saved) as CartLine[]);
    } catch {
      // A broken saved cart starts empty.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // Storage can be unavailable (private mode); the cart still works for this tab.
    }
  }, [lines, ready]);

  const add = useCallback((p: { slug: string; name: string; price: number }) => {
    setLines((current) => addLine(current, p));
  }, []);
  const setQuantity = useCallback((slug: string, quantity: number, bugs: boolean) => {
    setLines((current) => setLineQuantity(current, slug, quantity, bugs));
  }, []);
  const remove = useCallback((slug: string) => {
    setLines((current) => removeLine(current, slug));
  }, []);

  const value = useMemo(
    () => ({ lines, count: itemCount(lines), ready, add, setQuantity, remove }),
    [lines, ready, add, setQuantity, remove],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartState {
  const cart = useContext(CartContext);
  if (!cart) throw new Error("useCart must be used inside CartProvider");
  return cart;
}

export function CartLink() {
  const { count, ready } = useCart();
  return (
    <Link href="/cart" className="nav-link">
      Cart ({ready ? count : 0})
    </Link>
  );
}
