import { describe, expect, it } from "vitest";
import { pullPrice, summarisePulls, uncoveredCash } from "./outreach-pulls";

describe("pullPrice", () => {
  it("prices the cash without the fee the bank showed separately", () => {
    const p = pullPrice({ zarOut: 2873.3, fee: 65, localReceived: 500000 });
    expect(p.cost).toBe(2808.3);
    expect(p.localPerZar).toBeCloseTo(178.0436563, 6);
    expect(p.zarPerLocal).toBeCloseTo(0.0056166, 7);
  });

  it("has no rate until both sides are in", () => {
    expect(pullPrice({ zarOut: 0, fee: 0, localReceived: 500000 }).localPerZar).toBeNull();
    expect(pullPrice({ zarOut: 100, fee: 0, localReceived: 0 }).localPerZar).toBeNull();
    expect(pullPrice({ zarOut: 100, fee: 100, localReceived: 10 }).localPerZar).toBeNull();
  });
});

describe("summarisePulls", () => {
  const pulls = [
    { id: "p1", batch_date: "2026-11-01", zar_withdrawn: "2873.30", bank_fee: "65.00", local_currency: "BIF", local_currency_received: "500000" },
    { id: "p2", batch_date: "2026-11-05", zar_withdrawn: "1720.00", bank_fee: "0", local_currency: "BIF", local_currency_received: "300000" },
  ];
  const allocations = [
    { batch_id: "p1", local_currency: "BIF", local_amount: "370000", zar_amount: "2078.14" },
    { batch_id: "p1", local_currency: "BIF", local_amount: "130000", zar_amount: "730.16" },
    { batch_id: "p2", local_currency: "BIF", local_amount: "70000", zar_amount: "401.33" },
    { batch_id: null, local_currency: "BIF", local_amount: "10000", zar_amount: "57.33" },
  ];

  it("shows what's spent and left of each pull", () => {
    const [a, b] = summarisePulls(pulls, allocations);
    expect(a).toMatchObject({ cost: 2808.3, localSpent: 500000, localLeft: 0, zarSpent: 2808.3, zarLeft: 0 });
    expect(b).toMatchObject({ cost: 1720, localSpent: 70000, localLeft: 230000, zarSpent: 401.33, zarLeft: 1318.67 });
  });

  it("collects spending no pull covers", () => {
    expect(uncoveredCash(allocations)).toEqual([{ currency: "BIF", local: 10000, zar: 57.33 }]);
    expect(uncoveredCash(allocations.filter((a) => a.batch_id))).toEqual([]);
  });
});
