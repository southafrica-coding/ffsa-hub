import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import { syncStripeTicketOrderToXero } from "@/services/xero";

// POST /api/events/[id]/orders/[orderId]/xero
//
// "Push to Xero" for one Stripe ticket order: posts its PAID invoice to
// the US Xero org if it has none (or retries a payment that failed),
// then a credit note for any refund not yet in Xero. Idempotent — an
// order already fully in Xero is left alone. Also how staff bring an
// order from before this shipped into Xero.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; orderId: string }> }
) {
  const { id: eventId, orderId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canManageEvents(supabase, user.id, ["events.manage_registrations"]))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: order } = await admin
    .from("orders")
    .select("id, event_id, payment_provider")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.event_id !== eventId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.payment_provider !== "stripe") {
    return NextResponse.json(
      { error: "Only Stripe orders are invoiced in Xero." },
      { status: 400 }
    );
  }

  const result = await syncStripeTicketOrderToXero(admin, orderId);
  if (!result.success) {
    return NextResponse.json({ error: result.error ?? "Xero sync failed" }, { status: 502 });
  }
  return NextResponse.json(result);
}
