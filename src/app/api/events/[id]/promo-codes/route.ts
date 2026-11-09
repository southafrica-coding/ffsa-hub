import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createPromoCode, listTicketTypesByEvent } from "@/services/ticketing";
import { getAuthedUser } from "@/lib/api-auth";
import { canManageEvent, EVENT_CREATE_GATE, writeBlocked } from "@/lib/auth/event-access";
import { validatePromoConfig, type PromoConfigInput } from "@/lib/ticketing/promo-config";
import type { FormField } from "@/lib/forms/schema";

// POST /api/events/[id]/promo-codes
// Body: { code, kind: 'percent'|'fixed_amount'|'comp'|'none',
//         percent_off?, amount_off_cents?, applies_to_ticket_type_id?,
//         max_redemptions?, valid_from?, valid_until?, is_active?,
//         waives_waiver?, waived_questions?: [{ ticket_type_id, question_id }] }
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
  if (!(await canManageEvent(supabase, user.id, EVENT_CREATE_GATE.keys, eventId, EVENT_CREATE_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: PromoConfigInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Tier scope and waived questions are checked against the event's
  // real tiers, so a code can't point at another event's tier.
  const { data: tiers, error: tiersErr } = await listTicketTypesByEvent(supabase, eventId);
  if (writeBlocked(tiersErr)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (tiersErr) {
    return NextResponse.json({ error: tiersErr.message }, { status: 500 });
  }
  const v = validatePromoConfig(
    body,
    ((tiers ?? []) as Array<{ id: string; questions: FormField[] | null }>)
  );
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }

  const { data, error } = await createPromoCode(supabase, {
    event_id: eventId,
    ...v.config,
    created_by: user.id,
  });

  if (writeBlocked(error, data)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "That code is already in use on this event." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ promoCode: data });
}
