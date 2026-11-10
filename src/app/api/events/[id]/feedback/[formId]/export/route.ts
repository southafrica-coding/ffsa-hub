import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import {
  getFeedbackFormById,
  listFeedbackResponses,
} from "@/services/event-feedback";
import { parseFeedbackSchema } from "@/lib/feedback/schema";
import { responsesToCsv, type ResponseRow } from "@/lib/feedback/summary";
import { getAuthedUser } from "@/lib/api-auth";
import { canManageEvent, EVENT_VIEW_OR_CREATE_GATE } from "@/lib/auth/event-access";

// GET /api/events/[id]/feedback/[formId]/export — every response as CSV.
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; formId: string }> }
) {
  const { id: eventId, formId } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await canManageEvent(supabase, user.id, EVENT_VIEW_OR_CREATE_GATE.keys, eventId, EVENT_VIEW_OR_CREATE_GATE))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: form } = await getFeedbackFormById(supabase, formId);
  if (!form || form.event_id !== eventId) {
    return NextResponse.json({ error: "Feedback form not found" }, { status: 404 });
  }

  const { data: responses } = await listFeedbackResponses(supabase, formId);
  const schema = parseFeedbackSchema(form.schema);
  const csv = responsesToCsv(
    schema,
    (responses ?? []) as ResponseRow[],
    form.is_anonymous
  );

  const filename = `${form.slug}-feedback.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
