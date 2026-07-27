import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createTicketType } from "@/services/ticketing";
import { computeDisplayPriceCents } from "@/lib/payments/ticket-pricing";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import { sanitizeCheckoutQuestions } from "@/lib/ticketing/checkout-questions";

// POST /api/events/[id]/ticket-types
// Body: { name, description?, pricing_mode?, target_net_cents,
//         capacity?, max_per_order?, sales_start_at?, sales_end_at?,
//         sort_order?, is_active? }
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

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (typeof body.target_net_cents !== "number") {
    return NextResponse.json(
      { error: "target_net_cents is required" },
      { status: 400 }
    );
  }
  const pricingMode = body.pricing_mode ?? "fixed";
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
    body.target_net_cents,
    parentEvent?.currency
  );
  if (priced.error) {
    return NextResponse.json({ error: priced.error }, { status: 400 });
  }

  const { data, error } = await createTicketType(supabase, {
    event_id: eventId,
    name: body.name.trim(),
    description: body.description?.trim() || null,
    pricing_mode: pricingMode,
    target_net_cents: body.target_net_cents,
    display_price_cents: priced.displayPriceCents!,
    capacity: body.capacity ?? null,
    max_per_order: body.max_per_order ?? null,
    sales_start_at: body.sales_start_at ?? null,
    sales_end_at: body.sales_end_at ?? null,
    sort_order: body.sort_order ?? 0,
    is_active: body.is_active ?? true,
    // Sanitize server-side so a malformed builder payload can never land
    // an unrenderable question schema on the tier.
    questions: sanitizeCheckoutQuestions(body.questions),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ticketType: data });
}
