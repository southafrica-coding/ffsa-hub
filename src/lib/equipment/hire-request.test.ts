import { describe, expect, it } from "vitest";
import { checkPickAgainstStock, parsePickRequest, problemText, summarisePick, type StockItem } from "./hire-request";

const TODAY = "2026-11-10";
const SPEAKER = "11111111-1111-4111-8111-111111111111";
const MIC = "22222222-2222-4222-8222-222222222222";

const base = {
  from: "2026-12-11",
  to: "2026-12-13",
  lines: [{ productId: SPEAKER, quantity: 2 }],
  fulfilment: "collect",
  name: "Thandi Mokoena",
  email: "thandi@example.com",
  phone: "082 555 0100",
};

const stock: StockItem[] = [
  { id: SPEAKER, title: "Powered speaker", free: 2, priceCents: 45000, periodText: "per weekend", depositCents: 100000, maxPerOrder: null },
  { id: MIC, title: "Wireless mic", free: 4, priceCents: 15000, periodText: "per weekend", depositCents: 20000, maxPerOrder: 2 },
];

describe("parsePickRequest", () => {
  it("accepts a list and merges repeated products", () => {
    const r = parsePickRequest({ ...base, lines: [...base.lines, { productId: SPEAKER, quantity: 1 }] }, TODAY);
    expect(r.ok && r.value.lines).toEqual([{ productId: SPEAKER, quantity: 3 }]);
  });

  it("needs at least one item, a contact and sensible dates", () => {
    expect(parsePickRequest({ ...base, lines: [] }, TODAY)).toEqual({ ok: false, error: "Choose at least one item." });
    expect(parsePickRequest({ ...base, phone: "" }, TODAY).ok).toBe(false);
    expect(parsePickRequest({ ...base, from: "2026-11-01" }, TODAY).ok).toBe(false);
    expect(parsePickRequest({ ...base, to: "2026-12-10" }, TODAY).ok).toBe(false);
  });

  it("refuses fields it doesn't know, like a price", () => {
    expect(parsePickRequest({ ...base, total_cents: 0 }, TODAY).ok).toBe(false);
    expect(parsePickRequest({ ...base, lines: [{ productId: SPEAKER, quantity: 1, price: 0 }] }, TODAY).ok).toBe(false);
  });
});

describe("checkPickAgainstStock", () => {
  it("prices lines that fit at store prices", () => {
    const r = checkPickAgainstStock([{ productId: SPEAKER, quantity: 2 }], stock);
    expect(r).toEqual({
      ok: true,
      lines: [expect.objectContaining({ quantity: 2, unitPriceCents: 45000, lineTotalCents: 90000, depositCents: 100000 })],
    });
  });

  it("refuses, by name, anything more than is free or than one order may take", () => {
    const r = checkPickAgainstStock(
      [
        { productId: SPEAKER, quantity: 3 },
        { productId: MIC, quantity: 3 },
        { productId: "33333333-3333-4333-8333-333333333333", quantity: 1 },
      ],
      stock
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.map(problemText)).toEqual([
      "Only 2 of Powered speaker are free on your dates. You asked for 3.",
      "Only 2 of Wireless mic are free on your dates. You asked for 3.",
      "An item isn't free on your dates any more.",
    ]);
  });
});

describe("summarisePick", () => {
  it("lists the gear with totals for the rental manager", () => {
    const parsed = parsePickRequest({ ...base, fulfilment: "delivery", venue: "Grace Church" }, TODAY);
    if (!parsed.ok) throw new Error(parsed.error);
    const checked = checkPickAgainstStock(parsed.value.lines, stock);
    if (!checked.ok) throw new Error("bad fixture");
    const s = summarisePick(parsed.value, checked.lines);
    expect(s.flags).toEqual(["Wants delivery"]);
    expect(s.sections[0].rows).toEqual([["2× Powered speaker", "R 900.00 per weekend"]]);
    expect(s.counts[0]).toMatch(/^Hire R 900\.00 excl\. VAT, deposit R 2 000\.00/);
  });
});
