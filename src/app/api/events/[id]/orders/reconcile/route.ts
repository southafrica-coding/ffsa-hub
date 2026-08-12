import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import {
  reconcileStripeOrder,
  type ReconcileOrder,
} from "@/lib/ticketing/reconcile-stripe";

export const maxDuration = 60;

// POST /api/events/[id]/orders/reconcile
//
// Manual, on-demand version of the reconcile-payments cron, scoped to a
// single event. Asks Stripe directly whether each pending Stripe order
// was actually paid and settles the ones it reports as paid.
//
// Why this exists alongside the cron: the cron only looks back a few days
// (and, on the Hobby plan, runs once daily), so a batch of orders that got
// stuck pending while the webhook was mis-configured — and whose buyers
// never returned to the thanks page — falls outside its window and never
// self-heals. This button lets staff recover the whole pending backlog for
// an event immediately, with no time limit. Idempotent throughout via the
// `.eq("status", "pending")` guard in settlePaidOrder.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (
    !(await canManageEvents(supabase, user.id, ["events.manage_registrations"]))
  ) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Reconcile with the admin client so the settle/fulfil writes aren't
  // blocked by RLS — mirrors how the cron backstop runs.
  const admin = createAdminClient();

  const { data: pending, error } = await admin
    .from("orders")
    .select(
      "id, status, total_cents, payment_provider, provider_reference, created_at"
    )
    .eq("event_id", eventId)
    .eq("status", "pending")
    .eq("payment_provider", "stripe")
    .not("provider_reference", "is", null)
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let checked = 0;
  let settled = 0;
  let stillPending = 0;
  let errors = 0;

  for (const order of (pending ?? []) as ReconcileOrder[]) {
    checked += 1;
    const r = await reconcileStripeOrder(admin, order);
    if (r.outcome === "settled") {
      settled += 1;
    } else if (r.outcome === "not_paid_yet") {
      stillPending += 1;
    } else if (r.outcome === "error" || r.outcome === "amount_mismatch") {
      errors += 1;
      console.error(
        "[orders/reconcile] order",
        order.id,
        r.outcome,
        r.outcome === "error" ? r.error : ""
      );
    }
  }

  return NextResponse.json({ checked, settled, stillPending, errors });
}
