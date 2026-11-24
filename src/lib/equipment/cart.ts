// The cart (spec rule 4, frame 46c). Lives in the visitor's browser as
//   { from, to, fulfilment, lines: [{ productId, quantity }] }
// and is re-checked against the database on load and on every date change.
// A line that no longer fits is never dropped quietly: it offers named
// fixes — take fewer, swap for a similar free product, or remove — and
// checkout stays shut until every line is settled.

export type CartLine = { productId: string; quantity: number };

export type Cart = {
  from: string;
  to: string;
  fulfilment: "collect" | "delivery";
  lines: CartLine[];
  /** A signed-in ministry booker chose the internal rate. */
  internal?: boolean;
};

export const CART_KEY = "ffsa-hire-cart";

export function emptyCart(from: string, to: string): Cart {
  return { from, to, fulfilment: "collect", lines: [] };
}

/** Parse whatever is in storage; anything malformed becomes null. */
export function parseCart(raw: string | null): Cart | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    if (!c || typeof c.from !== "string" || typeof c.to !== "string" || !Array.isArray(c.lines)) return null;
    return {
      from: c.from,
      to: c.to,
      fulfilment: c.fulfilment === "delivery" ? "delivery" : "collect",
      ...(c.internal === true ? { internal: true } : {}),
      lines: c.lines
        .filter((l: unknown): l is CartLine => {
          const x = l as CartLine;
          return !!x && typeof x.productId === "string" && Number.isInteger(x.quantity) && x.quantity > 0;
        })
        .slice(0, 50),
    };
  } catch {
    return null;
  }
}

/** Add to a cart, merging with a line for the same product. */
export function addLine(cart: Cart, line: CartLine): Cart {
  const existing = cart.lines.find((l) => l.productId === line.productId);
  const lines = existing
    ? cart.lines.map((l) => (l.productId === line.productId ? { ...l, quantity: l.quantity + line.quantity } : l))
    : [...cart.lines, line];
  return { ...cart, lines };
}

export function setQuantity(cart: Cart, productId: string, quantity: number): Cart {
  return {
    ...cart,
    lines:
      quantity <= 0
        ? cart.lines.filter((l) => l.productId !== productId)
        : cart.lines.map((l) => (l.productId === productId ? { ...l, quantity } : l)),
  };
}

export function swapLine(cart: Cart, fromId: string, toId: string): Cart {
  const line = cart.lines.find((l) => l.productId === fromId);
  if (!line) return cart;
  return addLine(
    { ...cart, lines: cart.lines.filter((l) => l.productId !== fromId) },
    { productId: toId, quantity: line.quantity }
  );
}

export type LineFit = "fits" | "short" | "none";

/** How a line sits against what's free on the cart's dates. */
export function lineFit(quantity: number, free: number): LineFit {
  if (free >= quantity) return "fits";
  return free > 0 ? "short" : "none";
}

export type SwapCandidate = {
  id: string;
  categoryId: string | null;
  free: number;
  priceCents: number;
};

/**
 * "Swap for a similar free product": same store category, enough free for
 * the whole line, priced within 30% of the original — the closest price wins.
 */
export function pickSwap(
  original: { id: string; categoryId: string | null; priceCents: number },
  quantity: number,
  candidates: SwapCandidate[]
): SwapCandidate | null {
  if (!original.categoryId) return null;
  const band = Math.max(original.priceCents * 0.3, 1);
  const fits = candidates.filter(
    (c) =>
      c.id !== original.id &&
      c.categoryId === original.categoryId &&
      c.free >= quantity &&
      Math.abs(c.priceCents - original.priceCents) <= band
  );
  fits.sort(
    (a, b) => Math.abs(a.priceCents - original.priceCents) - Math.abs(b.priceCents - original.priceCents)
  );
  return fits[0] ?? null;
}
