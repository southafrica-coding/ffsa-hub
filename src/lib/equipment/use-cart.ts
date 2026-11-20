"use client";

// The hire cart in this browser's localStorage, shared by the item page,
// the cart, checkout and the tab bar. Every write tells the other mounted
// components (same tab via a custom event, other tabs via "storage").
// Storage can be missing or blocked (private mode), so every access is
// guarded and the cart simply starts empty.

import { useCallback, useEffect, useState } from "react";
import { CART_KEY, parseCart, type Cart } from "./cart";

const EVENT = "ffsa-hire-cart";

function read(): Cart | null {
  try {
    return parseCart(window.localStorage.getItem(CART_KEY));
  } catch {
    return null;
  }
}

export function writeCart(cart: Cart | null) {
  try {
    if (cart && cart.lines.length > 0) window.localStorage.setItem(CART_KEY, JSON.stringify(cart));
    else window.localStorage.removeItem(CART_KEY);
  } catch {
    /* storage blocked: the cart lives only for this page */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** [cart, setCart, loaded] — loaded is false until the first read on the client. */
export function useCart(): [Cart | null, (c: Cart | null) => void, boolean] {
  const [cart, setState] = useState<Cart | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const sync = () => setState(read());
    sync();
    setLoaded(true);
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const set = useCallback((c: Cart | null) => {
    setState(c);
    writeCart(c);
  }, []);

  return [cart, set, loaded];
}

export function cartCount(cart: Cart | null): number {
  return cart?.lines.reduce((n, l) => n + l.quantity, 0) ?? 0;
}
