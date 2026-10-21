import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import {
  cancelInvoicedOrder,
  emailOrderInvoice,
  holdPayLaterOrder,
  invoicePayLaterOrder,
  syncTicketInvoicePayments,
} from "@/lib/ticketing/pay-later";

// POST /api/events/[id]/orders/[orderId]/invoice
// Body: { action: "resend" | "check" | "cancel" | "retry" }
//
// Staff actions on a pay-later (invoiced) order:
//   resend — email the Xero invoice to the buyer again
//   check  — ask Xero now (instead of waiting for the webhook / daily sync);
//            a fully paid invoice settles the order and issues the tickets
//   cancel — void the Xero invoice and free the held seats (unpaid only)
//   retry  — make the invoice for an order on hold (our side failed at
//            checkout); it stays on hold with the new reason if it fails again
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; orderId: string }> }
) {
  const { id: eventId, orderId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvents(supabase, user.id, ["events.manage_registrations"]))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { action?: string };
  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, event_id, xero_invoice_id")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.event_id !== eventId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (body.action === "resend") {
    const r = await emailOrderInvoice(admin, orderId);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
  }
  if (body.action === "check") {
    if (!order.xero_invoice_id) return NextResponse.json({ error: "No Xero invoice on this order" }, { status: 400 });
    const r = await syncTicketInvoicePayments(admin, { invoiceIds: [order.xero_invoice_id] });
    if (r.errors.length) return NextResponse.json({ error: r.errors.join("; ") }, { status: 502 });
    const { data: after } = await admin
      .from("orders")
      .select("status, invoice_paid_cents")
      .eq("id", orderId)
      .single();
    return NextResponse.json({ ok: true, status: after?.status, invoice_paid_cents: after?.invoice_paid_cents });
  }
  if (body.action === "retry") {
    if (order.xero_invoice_id) return NextResponse.json({ error: "This order already has its invoice." }, { status: 400 });
    const r = await invoicePayLaterOrder(admin, orderId);
    if (!r.ok) {
      await holdPayLaterOrder(admin, orderId, r.error);
      return NextResponse.json({ error: r.error }, { status: 502 });
    }
    const { data: after } = await admin.from("orders").select("xero_invoice_number").eq("id", orderId).single();
    return NextResponse.json({ ok: true, invoiceNumber: after?.xero_invoice_number ?? null, emailed: r.emailed });
  }
  if (body.action === "cancel") {
    const r = await cancelInvoicedOrder(admin, orderId);
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
