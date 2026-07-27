import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getTicketType,
  updateTicketType,
  deleteTicketType,
} from "@/services/ticketing";
import { computeDisplayPriceCents } from "@/lib/payments/ticket-pricing";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import { sanitizeCheckoutQuestions } from "@/lib/ticketing/checkout-questions";

// PATCH /api/events/[id]/ticket-types/[ticketTypeId]
// Partial update. If target_net_cents or pricing_mode changes, the
// server recomputes display_price_cents from current fee profiles.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; ticketTypeId: string }> }
) {
  const { id: eventId, ticketTypeId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canManageEvents(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: {
    name?: string;
    description?: string | null;
    pricing_mode?: "fixed" | "pwyw";
    target_net_cents?: number;
    capacity?: number | null;
    max_per_order?: number | null;
    sales_start_at?: string | null;
    sales_end_at?: string | null;
    sort_order?: number;
    is_active?: boolean;
    questions?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.description !== undefined) {
    patch.description = body.description?.trim() || null;
  }
  if (body.capacity !== undefined) patch.capacity = body.capacity;
  if (body.max_per_order !== undefined) patch.max_per_order = body.max_per_order;
  if (body.sales_start_at !== undefined) patch.sales_start_at = body.sales_start_at;
  if (body.sales_end_at !== undefined) patch.sales_end_at = body.sales_end_at;
  if (body.sort_order !== undefined) patch.sort_order = body.sort_order;
  if (body.is_active !== undefined) patch.is_active = body.is_active;
  if (body.questions !== undefined) {
    patch.questions = sanitizeCheckoutQuestions(body.questions);
  }

  // Re-price if either pricing input changed. We need the current
  // row to know the "other" value (e.g. only pricing_mode in the
  // body — combine with the saved target_net_cents).
  const priceChanged =
    body.target_net_cents !== undefined || body.pricing_mode !== undefined;
  if (priceChanged) {
    const { data: existing, error: readErr } = await getTicketType(
      supabase,
      ticketTypeId
    );
    if (readErr || !existing) {
      return NextResponse.json({ error: "Ticket type not found" }, { status: 404 });
    }
    const pricingMode =
      body.pricing_mode ?? (existing.pricing_mode as "fixed" | "pwyw");
    const targetNetCents =
      body.target_net_cents ?? (existing.target_net_cents as number);

    if (pricingMode !== "fixed" && pricingMode !== "pwyw") {
      return NextResponse.json(
        { error: "pricing_mode must be 'fixed' or 'pwyw'" },
        { status: 400 }
      );
    }

    // Gross-up rates are per currency, so price against the event's own.
    const { data: parentEvent } = await supabase
      .from("events")
      .select("currency")
      .eq("id", eventId)
      .single();

    const priced = await computeDisplayPriceCents(
      supabase,
      pricingMode,
      targetNetCents,
      parentEvent?.currency
    );
    if (priced.error) {
      return NextResponse.json({ error: priced.error }, { status: 400 });
    }
    patch.pricing_mode = pricingMode;
    patch.target_net_cents = targetNetCents;
    patch.display_price_cents = priced.displayPriceCents!;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await updateTicketType(supabase, ticketTypeId, patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ticketType: data });
}

// DELETE /api/events/[id]/ticket-types/[ticketTypeId]
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; ticketTypeId: string }> }
) {
  const { ticketTypeId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await canManageEvents(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { error } = await deleteTicketType(supabase, ticketTypeId);
  if (error) {
    // FK from tickets / orders.promo_code_id may block deletion if
    // any sales have happened — surface a friendly message.
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "Can't delete a tier that already has tickets sold. Deactivate it instead." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ deleted: true });
}
