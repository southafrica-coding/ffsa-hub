import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  updatePromoCode,
  deletePromoCode,
  getPromoCode,
  listTicketTypesByEvent,
} from "@/services/ticketing";
import { getAuthedUser } from "@/lib/api-auth";
import { EVENT_CREATE_GATE, writeBlocked } from "@/lib/auth/event-access";
import { gateChildRow } from "@/lib/auth/event-route";
import { validatePromoConfig, type PromoConfigInput } from "@/lib/ticketing/promo-config";
import type { FormField } from "@/lib/forms/schema";

// PATCH /api/events/[id]/promo-codes/[promoCodeId]
// Partial update. The patch is merged over the stored code and the whole
// result re-validated (same rules as create), so any field — discount,
// scope, limits, dates, waived steps — can be edited safely. Orders
// already placed keep the discount and waivers they were sold with.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; promoCodeId: string }> }
) {
  const { id: eventId, promoCodeId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const denied = await gateChildRow(supabase, user.id, eventId, "promo_codes", promoCodeId, EVENT_CREATE_GATE);
  if (denied) return denied;

  let body: PromoConfigInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Object.keys(body).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Activate / deactivate is always allowed on its own — even for a code
  // saved before today's validation rules.
  const keys = Object.keys(body);
  if (keys.length === 1 && keys[0] === "is_active") {
    if (typeof body.is_active !== "boolean") {
      return NextResponse.json({ error: "is_active must be true or false" }, { status: 400 });
    }
    const { data, error } = await updatePromoCode(supabase, eventId, promoCodeId, {
      is_active: body.is_active,
    });
    if (writeBlocked(error)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ promoCode: data });
  }

  const { data: existing, error: existingErr } = await getPromoCode(supabase, promoCodeId);
  if (existingErr || !existing || existing.event_id !== eventId) {
    return NextResponse.json({ error: "Promo code not found" }, { status: 404 });
  }
  const { data: tiers, error: tiersErr } = await listTicketTypesByEvent(supabase, eventId);
  if (tiersErr) {
    return NextResponse.json({ error: tiersErr.message }, { status: 500 });
  }

  const merged: PromoConfigInput = { ...existing };
  for (const k of keys as Array<keyof PromoConfigInput>) merged[k] = body[k];
  const v = validatePromoConfig(
    merged,
    ((tiers ?? []) as Array<{ id: string; questions: FormField[] | null }>)
  );
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }

  const { data, error } = await updatePromoCode(supabase, eventId, promoCodeId, v.config);
  if (writeBlocked(error, data)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
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

// DELETE /api/events/[id]/promo-codes/[promoCodeId]
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; promoCodeId: string }> }
) {
  const { id: eventId, promoCodeId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const denied = await gateChildRow(supabase, user.id, eventId, "promo_codes", promoCodeId, EVENT_CREATE_GATE);
  if (denied) return denied;

  // A redeemed code is history on its orders — deactivate it instead.
  const { data: existing } = await getPromoCode(supabase, promoCodeId);
  if (existing && existing.event_id === eventId && existing.redemption_count > 0) {
    return NextResponse.json(
      { error: "Can't delete a code that's been redeemed on an order. Deactivate it instead." },
      { status: 409 }
    );
  }

  const { data, error } = await deletePromoCode(supabase, eventId, promoCodeId);
  if (writeBlocked(error, data)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (error) {
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Can't delete a code that's been redeemed on an order. Deactivate it instead." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deleted: true });
}
