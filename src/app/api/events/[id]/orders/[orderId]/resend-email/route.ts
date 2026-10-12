import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
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
  const { orderId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canManageEvents(supabase, user.id, ["events.manage_registrations"]))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // fulfillOrder validates the order exists and is paid; returns
  // a structured { ok, error } rather than throwing.
  const result = await fulfillOrder(supabase, orderId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ resent: true });
}
