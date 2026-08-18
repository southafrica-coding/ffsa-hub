import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/events/[id]/promo/validate
// Public, non-committing preview of a promo code. Returns the code's discount
// terms (kind / percent_off / amount_off / tier restriction) so the storefront
// can show the buyer their discount live. The authoritative discount is still
// re-validated and re-computed at /checkout — this route never increments
// redemption_count or touches reservations.
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

  const { data: promo, error } = await supabase
    .from("promo_codes")
    .select("*")
    .eq("event_id", eventId)
    .ilike("code", code)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "Couldn't validate code. Please try again." },
      { status: 500 }
    );
  }
  if (!promo) {
    return NextResponse.json({ ok: false, error: "That code isn't valid." });
  }

  const now = new Date();
  if (promo.valid_from && new Date(promo.valid_from) > now) {
    return NextResponse.json({ ok: false, error: "That code isn't active yet." });
  }
  if (promo.valid_until && new Date(promo.valid_until) <= now) {
    return NextResponse.json({ ok: false, error: "That code has expired." });
  }
  if (
    promo.max_redemptions != null &&
    promo.redemption_count >= promo.max_redemptions
  ) {
    return NextResponse.json({
      ok: false,
      error: "That code has been fully redeemed.",
    });
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

  return NextResponse.json({
    ok: true,
    code: promo.code,
    kind: promo.kind as "percent" | "fixed_amount" | "comp",
    percent_off: promo.percent_off ?? null,
    amount_off_cents: promo.amount_off_cents ?? null,
    applies_to_ticket_type_id: promo.applies_to_ticket_type_id ?? null,
  });
}
