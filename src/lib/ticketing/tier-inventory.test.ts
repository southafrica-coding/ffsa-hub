import { describe, expect, it } from "vitest";
import {
  formatTierCount,
  orderHoldsInventory,
  tallyTierInventory,
  type InventoryOrder,
} from "./tier-inventory";

const NOW = new Date("2026-10-26T12:00:00Z");
const LATER = "2026-10-26T12:20:00Z";
const EARLIER = "2026-10-26T11:00:00Z";
const EB = "early-bird";
const GEN = "general";

function paid(qty: number, tier = EB, status = "paid"): InventoryOrder {
  return {
    status,
    lines: [{ ticket_type_id: tier, qty }],
    tickets: Array.from({ length: qty }, () => ({ ticket_type_id: tier, status: "valid" })),
  };
}

function pending(qty: number, expiresAt: string | null, tier = EB): InventoryOrder {
  return { status: "pending", expires_at: expiresAt, lines: [{ ticket_type_id: tier, qty }], tickets: [] };
}

describe("orderHoldsInventory", () => {
  it("holds for paid, part-refunded and invoiced orders", () => {
    for (const status of ["paid", "partially_refunded", "invoiced"]) {
      expect(orderHoldsInventory({ status }, NOW)).toBe(true);
    }
  });

  it("holds for a pending order only inside its window", () => {
    expect(orderHoldsInventory({ status: "pending", expires_at: LATER }, NOW)).toBe(true);
    expect(orderHoldsInventory({ status: "pending", expires_at: EARLIER }, NOW)).toBe(false);
    expect(orderHoldsInventory({ status: "pending", expires_at: NOW.toISOString() }, NOW)).toBe(false);
    // A comped order mid-settle has no window.
    expect(orderHoldsInventory({ status: "pending", expires_at: null }, NOW)).toBe(true);
  });

  it("never holds for dead orders", () => {
    for (const status of ["expired", "cancelled", "refunded"]) {
      expect(orderHoldsInventory({ status, expires_at: LATER }, NOW)).toBe(false);
    }
  });
});

describe("tallyTierInventory", () => {
  it("reproduces the reported event: 8 paid tickets, abandoned checkouts don't count", () => {
    // 7 paid orders / 8 tickets (one buyer took two), plus the pending
    // orders that had pushed quantity_sold to 14 — some from the same
    // buyer who later paid. All of those windows are long closed.
    const orders: InventoryOrder[] = [
      paid(2),
      paid(1), paid(1), paid(1), paid(1), paid(1), paid(1),
      pending(1, EARLIER), pending(1, EARLIER), pending(2, EARLIER),
      pending(1, EARLIER), pending(1, EARLIER),
    ];
    const counts = tallyTierInventory(orders, NOW);
    expect(counts.get(EB)).toEqual({ sold: 8, held: 0 });
    expect(counts.get(GEN)).toBeUndefined();
    expect(formatTierCount(counts.get(EB)!, 15)).toBe("8 / 15 sold");
  });

  it("shows live checkouts and open invoices as held, not sold", () => {
    const orders: InventoryOrder[] = [
      paid(3),
      pending(2, LATER),
      { status: "invoiced", expires_at: null, lines: [{ ticket_type_id: EB, qty: 1 }], tickets: [] },
    ];
    const c = tallyTierInventory(orders, NOW).get(EB)!;
    expect(c).toEqual({ sold: 3, held: 3 });
    expect(formatTierCount(c, 15)).toBe("3 / 15 sold · 3 held");
  });

  it("nets out refunds and cancellations", () => {
    const fullyRefunded: InventoryOrder = {
      status: "refunded",
      lines: [{ ticket_type_id: EB, qty: 2 }],
      tickets: [
        { ticket_type_id: EB, status: "void" },
        { ticket_type_id: EB, status: "void" },
      ],
    };
    const orders: InventoryOrder[] = [
      paid(2),
      paid(1, EB, "partially_refunded"), // tickets still scan
      fullyRefunded,
      { status: "cancelled", lines: [{ ticket_type_id: EB, qty: 4 }], tickets: [] },
      { status: "expired", lines: [{ ticket_type_id: EB, qty: 1 }], tickets: [] },
    ];
    expect(tallyTierInventory(orders, NOW).get(EB)).toEqual({ sold: 3, held: 0 });
  });

  it("ignores voided tickets and a released hold", () => {
    const orders: InventoryOrder[] = [
      {
        status: "paid",
        lines: [{ ticket_type_id: EB, qty: 2 }],
        tickets: [
          { ticket_type_id: EB, status: "valid" },
          { ticket_type_id: EB, status: "void" },
        ],
      },
      { ...pending(1, LATER), inventory_released_at: EARLIER },
    ];
    expect(tallyTierInventory(orders, NOW).get(EB)).toEqual({ sold: 1, held: 0 });
  });

  it("counts checked-in tickets as sold and splits multi-tier orders", () => {
    const orders: InventoryOrder[] = [
      {
        status: "paid",
        lines: [
          { ticket_type_id: EB, qty: 1 },
          { ticket_type_id: GEN, qty: 2 },
        ],
        tickets: [
          { ticket_type_id: EB, status: "checked_in" },
          { ticket_type_id: GEN, status: "valid" },
          { ticket_type_id: GEN, status: "valid" },
        ],
      },
      {
        status: "pending",
        expires_at: LATER,
        lines: [
          { ticket_type_id: EB, qty: 1 },
          { ticket_type_id: GEN, qty: 1 },
        ],
      },
    ];
    const counts = tallyTierInventory(orders, NOW);
    expect(counts.get(EB)).toEqual({ sold: 1, held: 1 });
    expect(counts.get(GEN)).toEqual({ sold: 2, held: 1 });
  });

  it("tolerates malformed lines", () => {
    const orders: InventoryOrder[] = [
      { status: "pending", expires_at: LATER, lines: null },
      { status: "pending", expires_at: LATER, lines: [{ ticket_type_id: EB, qty: 0 }, { qty: 3 }] },
    ];
    expect(tallyTierInventory(orders, NOW).size).toBe(0);
  });
});

describe("formatTierCount", () => {
  it("formats with and without capacity", () => {
    expect(formatTierCount({ sold: 0, held: 0 }, null)).toBe("0 sold");
    expect(formatTierCount({ sold: 4, held: 1 }, null)).toBe("4 sold · 1 held");
    expect(formatTierCount({ sold: 8, held: 2 }, 15)).toBe("8 / 15 sold · 2 held");
  });
});
