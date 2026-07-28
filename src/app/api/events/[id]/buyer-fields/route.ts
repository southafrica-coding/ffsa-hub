import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateEvent } from "@/services/events";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";
import { sanitizeBuyerFields } from "@/lib/ticketing/buyer-fields";

// PATCH /api/events/[id]/buyer-fields — save the event's standard
// "Your details" field config (events.buyer_fields, migration 140).
// The incoming array is sanitized + resolved server-side (email forced
// on+required, hidden fields never required) so the stored config is
// always safe for the storefronts and the checkout validator.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvents(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: { buyer_fields?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!("buyer_fields" in body)) {
    return NextResponse.json({ error: "Missing buyer_fields" }, { status: 400 });
  }

  const buyerFields = sanitizeBuyerFields(body.buyer_fields);

  const { data, error } = await updateEvent(supabase, id, {
    buyer_fields: buyerFields,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data, buyer_fields: buyerFields });
}
