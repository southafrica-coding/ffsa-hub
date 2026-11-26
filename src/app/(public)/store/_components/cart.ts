"use client";

// The cart lives in the browser (localStorage) until checkout, where the
// server re-prices it. Nothing here is trusted for money.

import { useCallback, useEffect, useState } from "react";

export type CartLine = {
  key: string;
  productId: string;
  variantId?: string | null;
  quantity: number;
  purpose: "self" | "gift" | "code_pack";
  giftEmail?: string | null;
  giftMessage?: string | null;
};

const KEY = "ffsa-store-cart-v1";
const EVENT = "ffsa-store-cart";

function read(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((l) => l && typeof l.productId === "string") : [];
  } catch {
    return [];
  }
}

function write(lines: CartLine[]) {
  window.localStorage.setItem(KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event(EVENT));
}

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setLines(read());
    sync();
    setReady(true);
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const add = useCallback((line: Omit<CartLine, "key">) => {
    const current = read();
    // Same thing for yourself again: bump the quantity (merch) instead of a new line.
    const same = current.find(
      (l) => l.purpose === "self" && line.purpose === "self" && l.productId === line.productId && (l.variantId ?? null) === (line.variantId ?? null)
    );
    if (same) same.quantity = Math.min(same.quantity + line.quantity, 50);
    else current.push({ ...line, key: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` });
    write(current);
  }, []);

  const update = useCallback((key: string, patch: Partial<CartLine>) => {
    write(read().map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }, []);

  const remove = useCallback((key: string) => write(read().filter((l) => l.key !== key)), []);
  const clear = useCallback(() => write([]), []);

  return { lines, ready, add, update, remove, clear, count: lines.reduce((s, l) => s + (l.purpose === "code_pack" ? 1 : l.quantity), 0) };
}
