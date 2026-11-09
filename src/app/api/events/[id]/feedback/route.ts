import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEventById } from "@/services/events";
import {
  createFeedbackForm,
  generateUniqueFeedbackSlug,
} from "@/services/event-feedback";
import { emptyFeedbackSchema, debriefTemplate } from "@/lib/feedback/schema";
import { getAuthedUser } from "@/lib/api-auth";
import { writeBlocked, canManageEvent, EVENT_CREATE_GATE } from "@/lib/auth/event-access";

// POST /api/events/[id]/feedback — create a feedback form for the event.
// Body: { title, useTemplate? } — useTemplate seeds the standard
// post-event debrief questions instead of an empty form.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvent(supabase, user.id, EVENT_CREATE_GATE.keys, eventId, EVENT_CREATE_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: { title?: string; useTemplate?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = body.title?.trim();
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const { data: event } = await getEventById(supabase, eventId);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  // The public link reads best as event-then-purpose: /fb/send-night-2026-team-feedback
  const slug = await generateUniqueFeedbackSlug(supabase, `${event.title} ${title}`);

  const { data, error } = await createFeedbackForm(supabase, {
    event_id: eventId,
    slug,
    title,
    intro: null,
    schema: body.useTemplate ? debriefTemplate(event.title) : emptyFeedbackSchema(),
    is_anonymous: false, // named by default; the builder flips it per form
    status: "draft",
    created_by: user.id,
  });

  if (writeBlocked(error)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ form: data });
}
