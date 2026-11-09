import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateEvent } from "@/services/events";
import { getAuthedUser } from "@/lib/api-auth";
import { writeBlocked, canManageEvent, EVENT_UPDATE_GATE } from "@/lib/auth/event-access";
import { sanitizeCheckoutQuestions } from "@/lib/ticketing/checkout-questions";

// PATCH /api/events/[id]/checkout-questions — save the event's custom
// checkout questions (events.checkout_questions, migration 094). The
// incoming array is sanitized server-side into clean FormField objects
// so the stored schema is always safe to render + validate against.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvent(supabase, user.id, EVENT_UPDATE_GATE.keys, id, EVENT_UPDATE_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  let body: { checkout_questions?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!("checkout_questions" in body)) {
    return NextResponse.json(
      { error: "Missing checkout_questions" },
      { status: 400 }
    );
  }

  const questions = sanitizeCheckoutQuestions(body.checkout_questions);

  const { data, error } = await updateEvent(supabase, id, {
    checkout_questions: questions,
  });
  if (writeBlocked(error)) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data, checkout_questions: questions });
}
