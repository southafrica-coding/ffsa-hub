// Data access for the event helper and the pick list. Both land as an
// equipment order in status `quote`: from the helper with no lines (the
// rental manager works out the gear), from the pick list with the chosen
// lines at store prices. A quote holds no units
// (spec rule 2), so it never blocks anyone else's booking. Takes an ADMIN
// client — the customer has no account, and anon can't write orders.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ── Quote requests ─────────────────────────────────────────

export async function insertQuoteRequest(
  admin: Client,
  data: {
    customer_name: string;
    customer_email: string;
    customer_phone: string | null;
    customer_org: string | null;
    starts_on: string;
    ends_on: string;
    notes: string;
    fulfilment?: "collect" | "delivery";
    delivery_address?: string | null;
  }
) {
  return admin
    .from("equipment_orders")
    .insert({ ...data, kind: "external", status: "quote" })
    .select("id, number")
    .single();
}

/** The picked gear, at store prices, for the manager to confirm. */
export async function insertQuoteLines(
  admin: Client,
  orderId: string,
  lines: { product_id: string; quantity: number; unit_price_cents: number; deposit_cents: number; line_total_cents: number }[]
) {
  return admin.from("equipment_order_lines").insert(lines.map((l) => ({ ...l, order_id: orderId })));
}
