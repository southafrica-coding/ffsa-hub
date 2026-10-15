// ────────────────────────────────────────────────────────────
// FFSA Hub — "Invoice me, pay later" ticket orders (migration 238)
// ────────────────────────────────────────────────────────────
// A pay-later order holds its seats (inventory is reserved at checkout,
// exactly like a card order) but issues NO tickets yet. Instead the buyer
// gets an AUTHORISED Xero invoice — lines on the event's Xero Item, in the
// org of the BUYER'S country (USA → US, everyone else → SA — the same rule as
// Training), in the event's own currency (both orgs take ZAR and USD) — emailed by the
// Hub with the online pay link + PDF. They can pay in full or in parts;
// once Xero shows it fully paid, the order settles through the same path
// as a card payment and the tickets go out.
// ────────────────────────────────────────────────────────────

import type { createAdminClient } from "@/lib/supabase/admin";
import {
  createScheduledInvoice,
  createXeroEventItem,
  getXeroInvoicePaymentStates,
  listXeroItems,
  voidInvoice,
  type XeroRegion,
} from "@/services/xero";
import { sendSchoolInvoiceEmail, type StoredTemplate } from "@/services/invoice-email-delivery";
import { settlePaidOrder } from "./settle";
import { resolveEventBrand } from "./fulfillment";
import { resolveEventSender, type EventEmailEvent } from "@/lib/email/event-sender";

type AdminClient = ReturnType<typeof createAdminClient>;

export { xeroRegionForOrder, todayYmd, invoiceDueDate, suggestItemCode } from "./pay-later-rules";
import { xeroRegionForOrder, invoiceDueDate } from "./pay-later-rules";

type OrderLine = { ticket_type_id: string; qty: number; per_ticket_cents: number };

async function defaultTemplate(supabase: AdminClient, region: XeroRegion): Promise<StoredTemplate | null> {
  // Not in the generated types yet (migration 237).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("invoice_email_templates")
    .select("*")
    .eq("xero_region", region)
    .eq("is_default", true)
    .maybeSingle();
  return (data as unknown as StoredTemplate) ?? null;
}

/** Email (or re-email) an invoiced order's Xero invoice to the buyer. */
export async function emailOrderInvoice(
  supabase: AdminClient,
  orderId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, status, buyer_email, buyer_first_name, buyer_last_name, xero_invoice_id, xero_invoice_number, xero_region, events(title, brand, public_slug, sending_identity_id, email_show_event_logo, logo_url)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order?.xero_invoice_id || !order.xero_region) return { ok: false, error: "This order has no Xero invoice." };
  if (order.status !== "invoiced") return { ok: false, error: `The order is ${order.status}, not awaiting payment.` };

  const region = order.xero_region as XeroRegion;
  const template = await defaultTemplate(supabase, region);
  if (!template) return { ok: false, error: `No default invoice email template for the ${region.toUpperCase()} org.` };

  const ev = (order.events as unknown as EventEmailEvent & { title: string }) ?? null;
  const eventTitle = ev?.title ?? "event";
  // From the event's sender name and address (migration 241); replies stay
  // with finance, where payment questions belong.
  const sender = ev ? await resolveEventSender(supabase, ev, resolveEventBrand(ev)) : null;
  const sent = await sendSchoolInvoiceEmail(supabase, {
    region,
    invoiceId: order.xero_invoice_id,
    template,
    to: order.buyer_email,
    firstName: order.buyer_first_name || "there",
    fullName: `${order.buyer_first_name} ${order.buyer_last_name}`.trim(),
    ...(sender ? { sender: { name: sender.fromName, email: sender.fromEmail }, headerLogoUrl: sender.headerLogoUrl } : {}),
    ledger: {
      category: "event_invoice",
      reason: `Ticket invoice ${order.xero_invoice_number ?? ""} for ${eventTitle}`.replace(/\s+/g, " "),
    },
  });
  await supabase
    .from("orders")
    .update(
      sent.ok
        ? { invoice_emailed_at: new Date().toISOString(), invoice_error: null }
        : { invoice_error: `Email: ${sent.error}` }
    )
    .eq("id", orderId);
  return sent.ok ? { ok: true } : sent;
}

/**
 * Raise the Xero invoice for a freshly created pay-later order, move it to
 * "invoiced" and email it. A Xero failure is returned so checkout can
 * cancel the order and free the seats; an email failure is NOT fatal (the
 * invoice exists — staff can resend from the orders tab).
 */
export async function invoicePayLaterOrder(
  supabase: AdminClient,
  orderId: string
): Promise<{ ok: true; emailed: boolean } | { ok: false; error: string }> {
  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, status, currency, buyer_country, buyer_email, buyer_first_name, buyer_last_name, lines, discount_cents, donation_cents, total_cents, events(id, title, start_date, xero_item_code, pay_later_due_date)"
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: "Order not found" };
  const event = order.events as unknown as {
    id: string;
    title: string;
    start_date: string | null;
    xero_item_code: string | null;
    pay_later_due_date: string | null;
  } | null;
  if (!event?.xero_item_code) return { ok: false, error: "This event has no Xero item set up for invoices." };

  const lines = ((order.lines as unknown as OrderLine[] | null) ?? []).filter((l) => l.qty > 0);
  const { data: tiers } = await supabase
    .from("ticket_types")
    .select("id, name")
    .in("id", lines.map((l) => l.ticket_type_id));
  const tierName = new Map((tiers ?? []).map((t) => [t.id, t.name]));

  const itemCode = event.xero_item_code;
  const lineItems: Array<{ itemCode: string; description: string; amount: number }> = [];
  const quantities: number[] = [];
  for (const l of lines) {
    lineItems.push({
      itemCode,
      description: `${event.title} — ${tierName.get(l.ticket_type_id) ?? "Ticket"}`,
      amount: l.per_ticket_cents / 100,
    });
    quantities.push(l.qty);
  }
  if (order.discount_cents > 0) {
    lineItems.push({ itemCode, description: "Discount (promo code)", amount: -order.discount_cents / 100 });
    quantities.push(1);
  }
  if (order.donation_cents > 0) {
    lineItems.push({ itemCode, description: "Gift / donation", amount: order.donation_cents / 100 });
    quantities.push(1);
  }

  const region = xeroRegionForOrder(order);
  const dueDate = invoiceDueDate(event);

  // The buyer's org must hold the event's item. An event switched on before
  // buyers were routed by country may only have it in one org — add it to
  // this one (Event Registration Revenue, tax exempt) rather than fail the
  // order.
  try {
    const items = await listXeroItems(supabase, region);
    if (!items.some((i) => i.code.trim().toLowerCase() === itemCode.trim().toLowerCase())) {
      const made = await createXeroEventItem(supabase, region, { code: itemCode, name: event.title, description: event.title });
      if (!made.ok) return { ok: false, error: `${region === "us" ? "US" : "SA"} Xero has no item ${itemCode}: ${made.error}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't read Xero items" };
  }
  const created = await createScheduledInvoice(supabase, {
    region,
    studentEmail: order.buyer_email,
    studentName: `${order.buyer_first_name} ${order.buyer_last_name}`.trim() || order.buyer_email,
    dueDate,
    reference: `${event.title} tickets`.slice(0, 255),
    lineItems,
    lineQuantities: quantities,
    autoSend: true,
    xeroEmail: false,
    currencyCode: order.currency ?? "ZAR",
  });
  if (!created.success || !created.invoiceId) {
    return { ok: false, error: created.error ?? "Xero didn't create the invoice" };
  }
  if (created.status !== "AUTHORISED") {
    // A draft has no online pay link; don't leave a half-made invoice behind.
    await voidInvoice(supabase, created.invoiceId, region).catch(() => undefined);
    return { ok: false, error: "Xero kept the invoice as a draft (the item code may not exist in that org)." };
  }

  await supabase
    .from("orders")
    .update({
      status: "invoiced",
      expires_at: null,
      xero_invoice_id: created.invoiceId,
      xero_invoice_number: created.invoiceNumber ?? null,
      xero_region: region,
      invoice_due_date: dueDate,
      provider_reference: created.invoiceNumber ?? created.invoiceId,
    })
    .eq("id", orderId);

  const emailed = await emailOrderInvoice(supabase, orderId);
  if (!emailed.ok) console.error("[pay-later] invoice email failed for order", orderId, emailed.error);
  return { ok: true, emailed: emailed.ok };
}

async function releaseSeats(supabase: AdminClient, lines: OrderLine[]) {
  for (const l of lines) {
    if (l.qty > 0) {
      await supabase.rpc("release_ticket_inventory", { p_ticket_type_id: l.ticket_type_id, p_qty: l.qty });
    }
  }
}

/** Cancel an unpaid invoiced order: void the Xero invoice and free its seats. */
export async function cancelInvoicedOrder(
  supabase: AdminClient,
  orderId: string,
  opts: { voidInXero: boolean } = { voidInXero: true }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, status, lines, xero_invoice_id, xero_region, invoice_paid_cents")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return { ok: false, error: "Order not found" };
  if (order.status !== "invoiced") return { ok: false, error: `Only unpaid invoiced orders can be cancelled (this one is ${order.status}).` };
  if (order.invoice_paid_cents > 0) {
    return { ok: false, error: "Part of this invoice is already paid. Sort out the payment in Xero first." };
  }
  if (opts.voidInXero && order.xero_invoice_id && order.xero_region) {
    const voided = await voidInvoice(supabase, order.xero_invoice_id, order.xero_region as XeroRegion);
    if (!voided.success) return { ok: false, error: `Couldn't void the Xero invoice: ${voided.error}` };
  }
  const { data: flipped } = await supabase
    .from("orders")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", orderId)
    .eq("status", "invoiced")
    .select("id")
    .maybeSingle();
  if (flipped) await releaseSeats(supabase, (order.lines as unknown as OrderLine[] | null) ?? []);
  return { ok: true };
}

export type TicketInvoiceSyncResult = {
  checked: number;
  partPaid: number;
  settled: number;
  cancelled: number;
  errors: string[];
};

/**
 * Pull payment state from Xero for invoiced orders (all of them, or just the
 * given Xero invoice ids from a webhook) and act on it: record part
 * payments, settle fully-paid orders (tickets go out), and cancel orders
 * whose invoice was voided/deleted in Xero (seats freed).
 */
export async function syncTicketInvoicePayments(
  supabase: AdminClient,
  opts: { invoiceIds?: string[] } = {}
): Promise<TicketInvoiceSyncResult> {
  const result: TicketInvoiceSyncResult = { checked: 0, partPaid: 0, settled: 0, cancelled: 0, errors: [] };
  let q = supabase
    .from("orders")
    .select("id, total_cents, invoice_paid_cents, xero_invoice_id, xero_region")
    .eq("status", "invoiced")
    .not("xero_invoice_id", "is", null);
  if (opts.invoiceIds) {
    if (opts.invoiceIds.length === 0) return result;
    q = q.in("xero_invoice_id", opts.invoiceIds);
  }
  const { data: orders, error } = await q;
  if (error) return { ...result, errors: [error.message] };

  for (const region of ["za", "us"] as const) {
    const mine = (orders ?? []).filter((o) => o.xero_region === region);
    if (mine.length === 0) continue;
    const states = await getXeroInvoicePaymentStates(supabase, region, mine.map((o) => o.xero_invoice_id!));
    if (states.error) result.errors.push(`${region}: ${states.error}`);

    for (const o of mine) {
      const st = states.data.get(o.xero_invoice_id!);
      if (!st) continue;
      result.checked++;
      if (st.status === "PAID") {
        const settled = await settlePaidOrder(supabase, {
          orderId: o.id,
          expectedTotalCents: o.total_cents,
          providerPaymentId: o.xero_invoice_id,
          amountCents: null,
          fromStatuses: ["invoiced"],
        });
        await supabase.from("orders").update({ invoice_paid_cents: o.total_cents }).eq("id", o.id);
        if (settled.outcome === "settled") result.settled++;
        if (settled.outcome === "error") result.errors.push(`order ${o.id}: ${settled.error}`);
      } else if (st.status === "VOIDED" || st.status === "DELETED") {
        const c = await cancelInvoicedOrder(supabase, o.id, { voidInXero: false });
        if (c.ok) result.cancelled++;
        else result.errors.push(`order ${o.id}: ${c.error}`);
      } else {
        const paidCents = Math.round(st.amountPaid * 100);
        if (paidCents !== o.invoice_paid_cents) {
          await supabase.from("orders").update({ invoice_paid_cents: paidCents }).eq("id", o.id);
          result.partPaid++;
        }
      }
    }
  }
  return result;
}
