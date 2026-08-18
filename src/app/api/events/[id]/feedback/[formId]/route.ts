import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getFeedbackFormById,
  updateFeedbackForm,
  deleteFeedbackForm,
  type FeedbackFormUpdate,
} from "@/services/event-feedback";
import { isFeedbackSchema } from "@/lib/feedback/schema";
import { getAuthedUser, canManageEvents } from "@/lib/api-auth";

type Body = {
  title?: string;
  intro?: string | null;
  schema?: unknown;
  isAnonymous?: boolean;
  status?: "draft" | "open" | "closed";
  closesAt?: string | null;
  thankYouHeading?: string | null;
  thankYouMessage?: string | null;
};

// PATCH /api/events/[id]/feedback/[formId] — save the builder.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; formId: string }> }
) {
  const { id: eventId, formId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvents(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: form } = await getFeedbackFormById(supabase, formId);
  if (!form || form.event_id !== eventId) {
    return NextResponse.json({ error: "Feedback form not found" }, { status: 404 });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: FeedbackFormUpdate = {};
  if (body.title !== undefined) {
    if (!body.title.trim()) {
      return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    }
    patch.title = body.title.trim();
  }
  if (body.intro !== undefined) patch.intro = body.intro?.trim() || null;
  if (body.schema !== undefined) {
    if (!isFeedbackSchema(body.schema)) {
      return NextResponse.json({ error: "Invalid form schema" }, { status: 400 });
    }
    patch.schema = body.schema;
  }
  if (body.isAnonymous !== undefined) patch.is_anonymous = body.isAnonymous;
  if (body.status !== undefined) {
    if (!["draft", "open", "closed"].includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.closesAt !== undefined) patch.closes_at = body.closesAt || null;
  if (body.thankYouHeading !== undefined)
    patch.thank_you_heading = body.thankYouHeading?.trim() || null;
  if (body.thankYouMessage !== undefined)
    patch.thank_you_message = body.thankYouMessage?.trim() || null;

  const { data, error } = await updateFeedbackForm(supabase, formId, patch);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ form: data });
}

// DELETE /api/events/[id]/feedback/[formId] — remove the form and,
// by cascade, its responses. Guarded in the UI behind a confirm.
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; formId: string }> }
) {
  const { id: eventId, formId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvents(supabase, user.id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: form } = await getFeedbackFormById(supabase, formId);
  if (!form || form.event_id !== eventId) {
    return NextResponse.json({ error: "Feedback form not found" }, { status: 404 });
  }

  const { error } = await deleteFeedbackForm(supabase, formId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
