// What a ticket tier has sold, and what is only held, counted from the
// orders themselves.
//
// ticket_types.quantity_sold is NOT a sold count: checkout adds to it the
// moment a buyer is sent to pay, so it is "seats committed" (sold + live
// holds) and drives capacity. Showing it as "sold" is what made one Early
// Bird tier read 14/15 against 8 paid tickets (migration 270). The admin
// figure comes from here instead, and agrees with the Orders tab:
//
//   sold  tickets issued on paid / partially-refunded orders, less voids
//         (a full refund voids them and moves the order to "refunded")
//   held  tickets on orders still inside their checkout window, plus
//         unpaid pay-later invoices — they hold a seat but aren't sold
//
// A pending order past expires_at holds nothing, even before the database
// sweep (release_ticket_holds) has given its seats back.

export const SOLD_STATUSES = ["paid", "partially_refunded"] as const;

type OrderLine = { ticket_type_id?: string | null; qty?: number | null };

export type InventoryOrder = {
  status: string;
  expires_at?: string | null;
  inventory_released_at?: string | null;
  lines?: unknown;
  tickets?: Array<{ ticket_type_id: string | null; status?: string | null }> | null;
};

export type TierCount = { sold: number; held: number };

/**
 * Mirrors public.order_holds_inventory() in migration 270: does this order
 * still count against tier capacity?
 */
export function orderHoldsInventory(
  order: { status: string; expires_at?: string | null },
  now: Date
): boolean {
  if (
    order.status === "paid" ||
    order.status === "partially_refunded" ||
    order.status === "invoiced"
  ) {
    return true;
  }
  if (order.status !== "pending") return false;
  if (!order.expires_at) return true;
  return new Date(order.expires_at).getTime() > now.getTime();
}

function linesOf(order: InventoryOrder): OrderLine[] {
  return Array.isArray(order.lines) ? (order.lines as OrderLine[]) : [];
}

/** Sold and held tickets per ticket_type_id, across an event's orders. */
export function tallyTierInventory(
  orders: InventoryOrder[],
  now: Date = new Date()
): Map<string, TierCount> {
  const counts = new Map<string, TierCount>();
  const bump = (id: string, key: keyof TierCount, n: number) => {
    const c = counts.get(id) ?? { sold: 0, held: 0 };
    c[key] += n;
    counts.set(id, c);
  };

  for (const o of orders) {
    if ((SOLD_STATUSES as readonly string[]).includes(o.status)) {
      for (const t of o.tickets ?? []) {
        if (t.ticket_type_id && t.status !== "void") bump(t.ticket_type_id, "sold", 1);
      }
      continue;
    }
    // Unpaid but still holding a seat: a live checkout or an open invoice.
    if (o.inventory_released_at || !orderHoldsInventory(o, now)) continue;
    for (const l of linesOf(o)) {
      const qty = typeof l.qty === "number" ? Math.floor(l.qty) : 0;
      if (l.ticket_type_id && qty > 0) bump(l.ticket_type_id, "held", qty);
    }
  }
  return counts;
}

/** "8 / 15 sold · 2 held" — the held part only when something is held. */
export function formatTierCount(count: TierCount, capacity: number | null): string {
  const sold = capacity == null ? `${count.sold} sold` : `${count.sold} / ${capacity} sold`;
  return count.held > 0 ? `${sold} · ${count.held} held` : sold;
}
