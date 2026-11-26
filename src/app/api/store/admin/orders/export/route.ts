import { listOrders } from "@/services/store";
import { formatZar } from "@/lib/store/money";
import { requireStoreStaff } from "../../_guard";

function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formulas, then quote.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

type Row = {
  reference: string; created_at: string; status: string; payment_method: string; buyer_name: string; buyer_email: string;
  total_cents: number; discount_cents?: number | null; fulfilment_method: string; delivery_address: Record<string, string> | null;
  store_order_items?: Array<{ title: string; variant_label: string | null; quantity: number; purpose: string }>;
  store_fulfilments?: Array<{ status: string }> | { status: string } | null;
};

// GET /api/store/admin/orders/export — CSV of orders for packing and finance.
export async function GET(request: Request) {
  const guard = await requireStoreStaff("view");
  if (!guard.ok) return guard.response;
  const status = new URL(request.url).searchParams.get("status") ?? undefined;
  const { data, error } = await listOrders(guard.supabase, { status, limit: 5000 });
  if (error) return new Response("We couldn't export the orders. Try again.", { status: 500 });
  const header = ["Reference", "Created", "Status", "Paid by", "Name", "Email", "Total", "Coupon discount", "Items", "Fulfilment", "Fulfilment status", "Address"];
  const lines = ((data ?? []) as Row[]).map((o) => {
    const f = Array.isArray(o.store_fulfilments) ? o.store_fulfilments[0] : o.store_fulfilments;
    const items = (o.store_order_items ?? []).map((i) => `${i.quantity}× ${i.title}${i.variant_label ? ` (${i.variant_label})` : ""}${i.purpose !== "self" ? ` [${i.purpose}]` : ""}`).join("; ");
    const a = o.delivery_address;
    return [
      o.reference, o.created_at, o.status, o.payment_method, o.buyer_name, o.buyer_email, formatZar(o.total_cents).replace(/ /g, " "), o.discount_cents ? formatZar(o.discount_cents) : "", items,
      o.fulfilment_method, f?.status ?? "", a ? [a.line1, a.line2, a.city, a.province, a.postal_code].filter(Boolean).join(", ") : "",
    ].map(csvCell).join(",");
  });
  return new Response([header.map(csvCell).join(","), ...lines].join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="store-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
