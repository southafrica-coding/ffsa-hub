import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/api-auth";
import { gateOrder } from "@/lib/auth/event-route";
import { fulfillOrder } from "@/lib/ticketing/fulfillment";

// POST /api/events/[id]/orders/[orderId]/resend-email
//
// Manually re-trigger fulfilment for a paid order. fulfillOrder
// is idempotent — when tickets already exist it short-circuits
// issuance and just re-sends the confirmation email through
// Resend. Use cases:
//   - Buyer reports "never got my email" / "lost the QR".
//   - Email template changed and staff want to re-email existing
//     orders without burning another payment.
//   - Bounce / delivery issue cleared and a retry is desired.
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
  const orderGate = await gateOrder(supabase, user.id, eventId, orderId);
  if ("response" in orderGate) return orderGate.response;

  // fulfillOrder validates the order exists and is paid; returns
  // a structured { ok, error } rather than throwing.
  const result = await fulfillOrder(supabase, orderId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ resent: true });
}
