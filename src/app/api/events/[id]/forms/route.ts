import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createForm, generateUniqueFormSlug } from "@/services/forms";
import { getEventById } from "@/services/events";
import { emptyFormSchema } from "@/lib/forms/schema";
import { getAuthedUser } from "@/lib/api-auth";
import { writeBlocked, canManageEvent, FORMS_GATE } from "@/lib/auth/event-access";
import type { Json } from "@/types/database";

// POST /api/events/[id]/forms — create a new form scoped to the event.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvent(supabase, user.id, FORMS_GATE.keys, eventId, FORMS_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const { data: event } = await getEventById(supabase, eventId);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const slug = await generateUniqueFormSlug(supabase, body.name);

  const { data, error } = await createForm(supabase, {
    slug,
    name: body.name.trim(),
    event_id: eventId,
    label_id: event.base_label_id, // defaults to the event base label
    schema: emptyFormSchema() as unknown as Json,
    is_active: false, // starts as a draft until published
    records_attendance: true, // event QR forms record attendance by default
    double_opt_in: false, // single opt-in for event forms (crowd context)
    created_by: user.id,
  });

  if (writeBlocked(error)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ form: data });
}
