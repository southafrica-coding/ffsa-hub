import { describe, it, expect } from "vitest";
import { addLine, emptyCart, lineFit, parseCart, pickSwap, setQuantity, swapLine } from "./cart";

describe("cart", () => {
  const base = emptyCart("2026-11-06", "2026-11-09");

  it("merges lines for the same product", () => {
    const c = addLine(addLine(base, { productId: "a", quantity: 1 }), { productId: "a", quantity: 2 });
    expect(c.lines).toEqual([{ productId: "a", quantity: 3 }]);
  });

  it("takes fewer, removes, and swaps", () => {
    let c = addLine(base, { productId: "sm58", quantity: 2 });
    c = addLine(c, { productId: "tv", quantity: 2 });
    expect(setQuantity(c, "tv", 1).lines[1]).toEqual({ productId: "tv", quantity: 1 });
    expect(setQuantity(c, "tv", 0).lines).toHaveLength(1);
    expect(swapLine(c, "sm58", "atm510").lines).toEqual([
      { productId: "tv", quantity: 2 },
      { productId: "atm510", quantity: 2 },
    ]);
  });

  it("reads storage defensively", () => {
    expect(parseCart(null)).toBeNull();
    expect(parseCart("not json")).toBeNull();
    expect(parseCart('{"from":"2026-11-06","to":"2026-11-09","lines":[{"productId":"a","quantity":0},{"productId":"b","quantity":2}]}'))
      .toEqual({ from: "2026-11-06", to: "2026-11-09", fulfilment: "collect", lines: [{ productId: "b", quantity: 2 }] });
  });

  it("says whether a line fits", () => {
    expect(lineFit(2, 4)).toBe("fits");
    expect(lineFit(2, 1)).toBe("short");
    expect(lineFit(2, 0)).toBe("none");
  });
});

describe("pickSwap (frame 46c: 2 × SM58 → 2 × ATM510, same price, free)", () => {
  const sm58 = { id: "sm58", categoryId: "mics", priceCents: 20_000 };

  it("picks a free product in the same category at about the same price", () => {
    expect(
      pickSwap(sm58, 2, [
        { id: "atm510", categoryId: "mics", free: 4, priceCents: 20_000 },
        { id: "beta58", categoryId: "mics", free: 4, priceCents: 24_000 },
        { id: "speaker", categoryId: "speakers", free: 9, priceCents: 20_000 },
      ])?.id
    ).toBe("atm510");
  });

  it("won't offer something that can't cover the whole line, or costs far more", () => {
    expect(pickSwap(sm58, 2, [{ id: "a", categoryId: "mics", free: 1, priceCents: 20_000 }])).toBeNull();
    expect(pickSwap(sm58, 2, [{ id: "b", categoryId: "mics", free: 4, priceCents: 40_000 }])).toBeNull();
    expect(pickSwap({ ...sm58, categoryId: null }, 2, [{ id: "c", categoryId: null, free: 4, priceCents: 20_000 }])).toBeNull();
  });
});
