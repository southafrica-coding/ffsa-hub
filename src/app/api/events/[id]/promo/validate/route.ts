import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findActivePromoCode } from "@/services/ticketing";
import { promoUnavailableReason, toPromoTerms } from "@/lib/ticketing/promo-codes";

// POST /api/events/[id]/promo/validate
// Public, non-committing preview of a promo code. Returns the code's terms
// (discount, tier restriction and the steps it waives) so the storefront can
// show the buyer their discount live and hide the waiver / questions the
// code skips. The authoritative discount and waivers are re-validated and
// re-computed at /checkout — this route never increments redemption_count
// or touches reservations.
//
// Uses the service-role client, like /checkout does: promo_codes is
// readable only by staff under RLS, so an anon client would tell every
// signed-out buyer their perfectly good code "isn't valid". The buyer
// has already typed the code — this only confirms terms for one they
// named.

type ValidateBody = {
  code?: string;
  // Optional context — if the code is tier-restricted, we use this to tell the
  // buyer "this only applies to <tier>" before they get to checkout.
  ticket_type_ids?: string[];
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const supabase = createAdminClient();

  let body: ValidateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  const code = body.code?.trim();
  if (!code) {
    return NextResponse.json(
      { ok: false, error: "Enter a code." },
      { status: 400 }
    );
  }

  const ticketTypeIds = Array.isArray(body.ticket_type_ids)
    ? body.ticket_type_ids.filter((s): s is string => typeof s === "string")
    : [];

  const { data: promo, error } = await findActivePromoCode(supabase, eventId, code);

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Couldn't validate code. Please try again." },
      { status: 500 }
    );
  }
  if (!promo) {
    return NextResponse.json({ ok: false, error: "That code isn't valid." });
  }

  const unavailable = promoUnavailableReason(promo, new Date());
  if (unavailable) {
    return NextResponse.json({ ok: false, error: unavailable });
  }
  if (
    promo.applies_to_ticket_type_id &&
    ticketTypeIds.length > 0 &&
    !ticketTypeIds.includes(promo.applies_to_ticket_type_id)
  ) {
    return NextResponse.json({
      ok: false,
      error: "That code doesn't apply to the tier in your cart yet.",
      tier_restricted: true,
    });
  }

  return NextResponse.json({ ok: true, ...toPromoTerms(promo) });
}
