import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, getRateLimiter, retryAfterSeconds } from "@/lib/rate-limit";
import { rangeLabel, sastToday } from "@/lib/equipment/dates";
import { summaryText } from "@/lib/equipment/helper";
import {
  checkPickAgainstStock,
  parsePickRequest,
  problemText,
  summarisePick,
  type StockItem,
} from "@/lib/equipment/hire-request";
import { itemTitle, loadStore } from "@/lib/equipment/storefront";
import { notifyHireQuoteRequest } from "@/lib/email/send-hire-quote-request";
import { listProducts, type EquipmentProduct } from "@/services/equipment";
import { insertQuoteLines, insertQuoteRequest } from "@/services/equipment-helper";

/**
 * The pick list (/hire/request): gear chosen by someone who knows what they
 * need. Public: no account needed. The body can set only what
 * parsePickRequest allows. Prices come from the store, never the body.
 * Stock is checked again here, as the visitor sees it, and a list that no
 * longer fits is refused line by line. It lands as an external order in
 * status `quote` for the rental manager to confirm.
 */

const LIMIT = { limit: 6, windowSeconds: 60 * 60 };

export async function POST(request: Request) {
  const limited = await getRateLimiter().hit(`hire-request:${clientIp(request)}`, LIMIT);
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many requests from this connection. Try again later, or email us." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(limited)) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }
  const parsed = parsePickRequest(body, sastToday());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const p = parsed.value;

  const supabase = await createClient();
  const [store, productsRes] = await Promise.all([
    loadStore(supabase, { from: p.from, to: p.to }),
    listProducts(supabase, { listedOnly: true }),
  ]);
  if (store.error || productsRes.error) {
    console.error("[hire-request] stock check failed:", store.error ?? productsRes.error?.message);
    return NextResponse.json({ error: "We couldn't check what's free just now. Try again." }, { status: 502 });
  }
  const products = new Map(((productsRes.data ?? []) as EquipmentProduct[]).map((x) => [x.id, x]));
  const stock: StockItem[] = store.items.map((i) => ({
    id: i.id,
    title: itemTitle(i),
    forHire: i.forHire,
    free: i.free,
    priceCents: i.priceCents,
    periodText: i.periodText,
    depositCents: products.get(i.id)?.deposit_cents ?? 0,
    maxPerOrder: products.get(i.id)?.max_per_order ?? null,
  }));

  const checked = checkPickAgainstStock(p.lines, stock);
  if (!checked.ok) {
    return NextResponse.json(
      { error: "Some of your list isn't free any more.", problems: checked.problems.map((x) => ({ ...x, text: problemText(x) })) },
      { status: 409 }
    );
  }

  const summary = summarisePick(p, checked.lines);
  const admin = createAdminClient();
  const { data: order, error } = await insertQuoteRequest(admin, {
    customer_name: p.name,
    customer_email: p.email,
    customer_phone: p.phone,
    customer_org: p.org ?? null,
    starts_on: p.from,
    ends_on: p.to,
    fulfilment: p.fulfilment === "delivery" ? "delivery" : "collect",
    delivery_address: p.fulfilment === "delivery" ? p.venue ?? null : null,
    notes: summaryText(summary, "Picked from the store."),
  });
  if (error || !order) {
    console.error("[hire-request] order insert failed:", error?.message);
    return NextResponse.json({ error: "We couldn't send your list. Try again, or email us." }, { status: 500 });
  }

  const { error: linesError } = await insertQuoteLines(
    admin,
    order.id,
    checked.lines.map((l) => ({
      product_id: l.productId,
      quantity: l.quantity,
      unit_price_cents: l.unitPriceCents,
      deposit_cents: l.depositCents,
      line_total_cents: l.lineTotalCents,
    }))
  );
  // The notes carry the full list, so a failed line insert loses nothing.
  if (linesError) console.error("[hire-request] order lines failed:", linesError.message);

  after(() =>
    notifyHireQuoteRequest({
      orderId: order.id,
      orderNumber: order.number,
      customerName: p.name,
      customerEmail: p.email,
      whenLabel: rangeLabel(p.from, p.to),
      summary,
      source: "picked",
    })
  );

  return NextResponse.json({ ok: true, number: order.number });
}
