"use client";

// Re-check the browser cart with the server whenever its dates, lines or
// rate change (spec rule 4). The answer says what fits, what doesn't, and
// what the settled lines come to.

import { useEffect, useState } from "react";
import type { Cart } from "@/lib/equipment/cart";
import type { CheckedCart } from "@/lib/equipment/checkout-server";

export type CartCheck = CheckedCart & {
  internalAllowed: boolean;
  me: { name: string; email: string } | null;
  ministries: { id: string; name: string }[];
};

export function useCheckedCart(cart: Cart | null) {
  const [data, setData] = useState<CartCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = cart ? JSON.stringify([cart.from, cart.to, cart.internal ?? false, cart.lines]) : "";

  useEffect(() => {
    if (!cart || cart.lines.length === 0) {
      setData(null);
      setError(null);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    fetch("/api/equipment/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: cart.from, to: cart.to, lines: cart.lines, internal: cart.internal === true }),
      signal: ctl.signal,
    })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(json.error ?? "We couldn't check your cart. Try again.");
          setData(null);
        } else {
          setError(null);
          setData(json as CartCheck);
        }
      })
      .catch((e) => {
        if (e?.name !== "AbortError") setError("We couldn't reach the store. Check your connection.");
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, error, loading };
}
