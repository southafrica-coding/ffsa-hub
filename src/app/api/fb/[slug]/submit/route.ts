import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getFeedbackFormBySlug,
  insertFeedbackResponse,
} from "@/services/event-feedback";
import { parseFeedbackSchema, validateFeedback } from "@/lib/feedback/schema";

// POST /api/fb/[slug]/submit — public feedback submission.
//
// No auth: the whole point is that a volunteer with the WhatsApp link can
// answer without a Hub account, so this runs through the service-role
// admin client. Nothing it writes touches contacts, labels or workflows —
// a feedback response is inert analytics.
export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const supabase = createAdminClient();

  const { data: form } = await getFeedbackFormBySlug(supabase, slug);
  if (!form) {
    return NextResponse.json({ error: "Feedback form not found" }, { status: 404 });
  }
  if (form.status !== "open") {
    return NextResponse.json(
      { error: "This feedback form is closed." },
      { status: 403 }
    );
  }
  if (form.closes_at && new Date(form.closes_at) < new Date()) {
    return NextResponse.json(
      { error: "This feedback form has closed." },
      { status: 403 }
    );
  }

  let body: {
    answers?: Record<string, unknown>;
    respondentName?: string;
    respondentEmail?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const schema = parseFeedbackSchema(form.schema);
  const answers = body.answers ?? {};
  const validation = validateFeedback(schema, answers);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Some questions still need an answer", fieldErrors: validation.errors },
      { status: 400 }
    );
  }

  // A named form asks who you are; an anonymous one must never store it,
  // even if a client sends it anyway.
  const name = form.is_anonymous ? null : body.respondentName?.trim() || null;
  const email = form.is_anonymous ? null : body.respondentEmail?.trim() || null;
  if (!form.is_anonymous && !name) {
    return NextResponse.json(
      { error: "Please tell us your name", fieldErrors: { __name: "Your name is required." } },
      { status: 400 }
    );
  }

  const { error } = await insertFeedbackResponse(supabase, {
    form_id: form.id,
    respondent_name: name,
    respondent_email: email,
    answers,
    user_agent: request.headers.get("user-agent"),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
