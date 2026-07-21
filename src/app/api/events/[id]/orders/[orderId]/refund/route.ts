import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import { refundOrder, syncPendingRefunds } from "@/services/order-refunds";

// POST /api/events/[id]/orders/[orderId]/refund
//
// Refunds an order for real: calls Stripe / PayFast to move the money,
// records the attempt in order_refunds, updates the order, voids the
// tickets and releases inventory on a full refund, and emails the buyer.
// See src/services/order-refunds.ts for the ordering guarantees.
//
// Body (all optional):
//   amount_cents  number   defaults to everything still outstanding
//   reason        string   free text, stored and sent to the provider
//   method        string   "provider" (default) | "manual"
//   dry_run       boolean  build + return the signed provider request
//                          without sending it. The only way to inspect
//                          a PayFast refund payload, since PayFast has
//                          no sandbox for refunds.
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

  const body = (await request.json().catch(() => ({}))) as {
    amount_cents?: unknown;
    reason?: unknown;
    method?: unknown;
    dry_run?: unknown;
  };

  const method = body.method === "manual" ? "manual" : "provider";
  const amountCents =
    typeof body.amount_cents === "number" ? body.amount_cents : undefined;
  if (body.amount_cents !== undefined && amountCents === undefined) {
    return NextResponse.json(
      { error: "amount_cents must be a number of cents." },
      { status: 400 }
    );
  }

  const result = await refundOrder(supabase, user.id, {
    orderId,
    amountCents,
    reason: typeof body.reason === "string" ? body.reason : null,
    method,
    dryRun: body.dry_run === true,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.httpStatus }
    );
  }
  return NextResponse.json(result);
}

// PATCH /api/events/[id]/orders/[orderId]/refund
//
// Re-checks any refund still sitting at "pending" against the provider.
// Needed because PayFast accepts a refund and settles it asynchronously
// without sending an ITN — nothing tells us it landed unless we ask.
export async function PATCH(
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

  const result = await syncPendingRefunds(supabase, orderId);
  return NextResponse.json(result);
}
