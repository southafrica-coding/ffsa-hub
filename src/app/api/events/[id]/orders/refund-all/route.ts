import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { canManageEvent, ORDERS_GATE } from "@/lib/auth/event-access";
import { refundEventOrders } from "@/services/order-refunds";
import { getEventById } from "@/services/events";

// POST /api/events/[id]/orders/refund-all
//
// Refunds every still-outstanding order on the event in one pass — the
// "we're cancelling this event, refund everyone" action. Each order goes
// through refundOrder() (real money via Stripe / PayFast, tickets voided,
// inventory released, buyer emailed), so the per-order guarantees hold.
//
// The event's cancellation_message (migration 139), if set, is included in
// every refund email as a buyer-facing note. Body (optional):
//   reason  string  internal note, stored on each refund + sent to provider
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canManageEvent(supabase, user.id, ORDERS_GATE.keys, id, ORDERS_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };

  const { data: event } = await getEventById(supabase, id);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const result = await refundEventOrders(supabase, user.id, id, {
    reason: typeof body.reason === "string" ? body.reason : null,
    cancellationMessage: event.cancellation_message ?? null,
  });

  return NextResponse.json(result);
}
