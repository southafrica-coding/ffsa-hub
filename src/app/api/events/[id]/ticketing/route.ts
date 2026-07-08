import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateEvent } from "@/services/events";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";

// Slugs that show up at /e/<slug> on the public storefront.
// Lowercase a-z, 0-9, dashes; can't start or end with a dash.
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

// PATCH /api/events/[id]/ticketing
// Body: { ticketing_enabled?: boolean; public_slug?: string | null }
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
  if (!(await canManageEvents(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: {
    ticketing_enabled?: boolean;
    public_slug?: string | null;
    xero_item_code?: string | null;
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
  // Per-event Xero item code — its presence opts the event into posting
  // a PAID sales invoice to Xero on each paid ticket order. Empty ⇒ null
  // (off). Trimmed; Xero item codes are case-sensitive so we don't fold case.
  if (body.xero_item_code !== undefined) {
    const code = body.xero_item_code?.trim();
    patch.xero_item_code = code ? code : null;
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
  if (error) {
    if (error.message?.includes("idx_events_public_slug")) {
      return NextResponse.json(
        { error: "That slug is already taken by another event." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ event: data });
}
