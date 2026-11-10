import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateEvent } from "@/services/events";
import { getAuthedUser } from "@/lib/api-auth";
import { canManageEvent, EVENT_CREATE_GATE, writeBlocked } from "@/lib/auth/event-access";
import { EVENT_CURRENCIES, isEventCurrency } from "@/lib/currencies";
import { computeDisplayPriceCents } from "@/lib/payments/ticket-pricing";

// Slugs that show up at /e/<slug> on the public storefront.
// Lowercase a-z, 0-9, dashes; can't start or end with a dash.
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

// PATCH /api/events/[id]/ticketing
// Body: { ticketing_enabled?: boolean; public_slug?: string | null;
//         currency?: "ZAR" | "USD" }
export async function PATCH(
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

  let body: {
    ticketing_enabled?: boolean;
    public_slug?: string | null;
    currency?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.ticketing_enabled === "boolean") {
    patch.ticketing_enabled = body.ticketing_enabled;
  }
  if (body.public_slug !== undefined) {
    if (body.public_slug === null || body.public_slug.trim() === "") {
      patch.public_slug = null;
    } else {
      const normalized = body.public_slug.toLowerCase().trim();
      if (!SLUG_PATTERN.test(normalized)) {
        return NextResponse.json(
          {
            error:
              "Slug must be lowercase letters, digits and dashes (1–64 chars, no leading/trailing dash).",
          },
          { status: 400 }
        );
      }
      patch.public_slug = normalized;
    }
  }

  // Selling currency. Changing it re-prices every fixed tier (the
  // gross-up must use that currency's fee profile), so it's only
  // allowed while the event has taken no real money.
  let currencyChangedTo: string | null = null;
  if (body.currency !== undefined) {
    if (!isEventCurrency(body.currency)) {
      return NextResponse.json(
        {
          error: `Currency must be one of ${EVENT_CURRENCIES.map((c) => c.code).join(", ")}.`,
        },
        { status: 400 }
      );
    }
    const { data: current } = await supabase
      .from("events")
      .select("currency")
      .eq("id", eventId)
      .single();

    if (current && current.currency !== body.currency) {
      // A paid or refunded order recorded in the old currency would be
      // silently misreported against the new one.
      const { count } = await supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .neq("status", "pending");
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          {
            error:
              "This event already has orders, so its currency can't be changed. Create a new event to sell in a different currency.",
          },
          { status: 409 }
        );
      }
      patch.currency = body.currency;
      currencyChangedTo = body.currency;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Don't let staff enable ticketing without a slug — the public
  // storefront URL needs one.
  if (patch.ticketing_enabled === true) {
    if (patch.public_slug === null) {
      return NextResponse.json(
        { error: "Cannot clear the slug while ticketing is enabled." },
        { status: 400 }
      );
    }
    if (patch.public_slug === undefined) {
      const { data: existing } = await supabase
        .from("events")
        .select("public_slug")
        .eq("id", eventId)
        .single();
      if (!existing?.public_slug) {
        return NextResponse.json(
          { error: "Set a URL slug before enabling ticketing." },
          { status: 400 }
        );
      }
    }
  }

  const { data, error } = await updateEvent(supabase, eventId, patch);
  if (writeBlocked(error, data)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  if (error) {
    if (error.message?.includes("idx_events_public_slug")) {
      return NextResponse.json(
        { error: "That slug is already taken by another event." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Re-gross-up existing tiers against the new currency's fee profile.
  // Staff keep the same target net (what FFSA wants to keep); only the
  // displayed, fee-inclusive price moves.
  if (currencyChangedTo) {
    const { data: tiers } = await supabase
      .from("ticket_types")
      .select("id, pricing_mode, target_net_cents")
      .eq("event_id", eventId)
      .eq("pricing_mode", "fixed");

    for (const tier of (tiers ?? []) as Array<{
      id: string;
      pricing_mode: "fixed" | "pwyw";
      target_net_cents: number;
    }>) {
      const { displayPriceCents, error: priceErr } =
        await computeDisplayPriceCents(
          supabase,
          tier.pricing_mode,
          tier.target_net_cents,
          currencyChangedTo
        );
      if (priceErr || displayPriceCents === undefined) {
        // The currency is saved but a tier couldn't be re-priced —
        // surface it rather than leaving a stale price on the storefront.
        return NextResponse.json(
          {
            error: `Currency saved, but ticket prices couldn't be recalculated: ${priceErr ?? "unknown error"}. Re-save each ticket type.`,
          },
          { status: 500 }
        );
      }
      const { data: pricedRows, error: saveErr } = await supabase
        .from("ticket_types")
        .update({ display_price_cents: displayPriceCents })
        .eq("id", tier.id)
        .select("id");
      if (writeBlocked(saveErr, pricedRows)) {
        return NextResponse.json(
          {
            error:
              "Currency saved, but you don't have permission to update ticket prices for this event.",
          },
          { status: 403 }
        );
      }
      if (saveErr) {
        return NextResponse.json(
          { error: `Currency saved, but a ticket price could not be updated: ${saveErr.message}` },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json({ event: data });
}
