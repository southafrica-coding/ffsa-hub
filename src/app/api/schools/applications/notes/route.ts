import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { saveApplicationAdminNote } from "@/services/schools";

// PUT /api/schools/applications/notes
// { id, admin_notes }
//
// Saves the leader's internal note and nothing else. Status, reviewed_at,
// enrolment, and email stay as they are. Decision buttons still go through
// the responses route, which writes the note alongside a status change.

const NOTES_MAX = 50000;

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    admin_notes?: unknown;
  };
  if (!body.id || typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (body.admin_notes != null && typeof body.admin_notes !== "string") {
    return NextResponse.json({ error: "admin_notes must be text" }, { status: 400 });
  }
  const notes = typeof body.admin_notes === "string" ? body.admin_notes.trim() : "";
  if (notes.length > NOTES_MAX) {
    return NextResponse.json({ error: "Notes are too long" }, { status: 400 });
  }

  const { data: application, error: fetchError } = await supabase
    .from("application_responses")
    .select("id, program_id, status")
    .eq("id", body.id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!application) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  if (!(await userCanManageProgram(supabase, user.id, application.program_id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { error } = await saveApplicationAdminNote(supabase, {
    applicationResponseId: application.id,
    programId: application.program_id,
    notes: notes || null,
    updatedBy: user.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    status: application.status,
    admin_notes: notes || null,
  });
}
