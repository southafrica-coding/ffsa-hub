import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  getHubFeedbackAccess,
  getHubFeedbackById,
  insertHubFeedbackComment,
  reopenAnsweredHubFeedback,
  type HubFeedbackRow,
} from "@/services/hub-feedback";

// POST /api/hub-feedback/[id]/comments
// Body: { body, visibility: "team" | "submitter" }
// The team can write either; the submitter only the 'submitter' thread on
// their own item. When the submitter answers a "needs info" question the
// item goes back to New, so it lands in the inbox again.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 5000) : "";
  if (!text) return NextResponse.json({ error: "Write something first" }, { status: 400 });

  const { data: row } = await getHubFeedbackById(supabase, id);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const item = row as HubFeedbackRow;

  const { canView } = await getHubFeedbackAccess(supabase);
  const visibility = canView && body.visibility === "team" ? "team" : "submitter";
  if (!canView && item.submitted_by !== user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data, error } = await insertHubFeedbackComment(supabase, {
    feedback_id: id,
    author_id: user.id,
    visibility,
    body: text,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (item.submitted_by === user.id && item.status === "needs_info") {
    // Submitters can't update items under RLS; this one transition is theirs.
    await reopenAnsweredHubFeedback(createAdminClient(), id);
  }

  return NextResponse.json({ success: true, comment: data });
}
