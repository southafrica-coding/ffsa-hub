import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  APPLICATIONS_EXPIRED_MESSAGE,
  userCanReadApplication,
} from "@/lib/auth/application-expiry";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import {
  resolveProgramViewer,
  userIsProgramStaff,
} from "@/lib/schools/program-staff-access";
import { isInterviewOutcome } from "@/lib/schools/interview-outcomes";

// GET  /api/schools/applications/reviews?response_id=
//      /api/schools/applications/reviews?program_id=
// PUT  /api/schools/applications/reviews
//      { response_id, notes, interview_outcome }
//
// Staff read and write a review only on an application assigned to them.
// Leaders and other managers can read the program's reviews. The write
// goes through the user client so the review trigger and RLS apply.
// Status changes stay on the responses route, which staff cannot call.

const NOTES_MAX = 8000;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const responseId = url.searchParams.get("response_id");
  const programId = url.searchParams.get("program_id");
  if (!responseId && !programId) {
    return NextResponse.json(
      { error: "response_id or program_id is required" },
      { status: 400 }
    );
  }

  if (responseId) {
    if (!(await userCanReadApplication(supabase, responseId))) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  } else if (programId) {
    const viewer = await resolveProgramViewer(supabase, user.id, programId);
    if (!viewer.canManage && !viewer.isStaff && !viewer.hasSchoolsGrant) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("application_staff_reviews")
    .select("id, application_response_id, program_id, author_id, notes, interview_outcome, updated_at")
    .order("updated_at", { ascending: false });
  if (responseId) query = query.eq("application_response_id", responseId);
  if (programId) query = query.eq("program_id", programId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reviews: data ?? [] });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    response_id?: string;
    notes?: string | null;
    interview_outcome?: string;
  };
  if (!body.response_id) {
    return NextResponse.json({ error: "response_id is required" }, { status: 400 });
  }
  if (!isInterviewOutcome(body.interview_outcome)) {
    return NextResponse.json(
      { error: "interview_outcome must be pending, recommend, hold, or decline" },
      { status: 400 }
    );
  }
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > NOTES_MAX) {
    return NextResponse.json({ error: "Notes are too long" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: application, error: fetchError } = await admin
    .from("application_responses")
    .select("id, program_id, assigned_staff_id")
    .eq("id", body.response_id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!application) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  if (!(await userCanReadApplication(supabase, body.response_id))) {
    return NextResponse.json({ error: APPLICATIONS_EXPIRED_MESSAGE }, { status: 403 });
  }

  const programId = application.program_id as string;
  const assigned = (application.assigned_staff_id as string | null) === user.id;
  const isStaff = await userIsProgramStaff(supabase, user.id, programId);
  if (!isStaff || !assigned) {
    // Managers keep the status route. This one is the assigned staff review.
    if (await userCanManageProgram(supabase, user.id, programId)) {
      return NextResponse.json(
        { error: "Only the assigned staff member writes this review" },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("application_staff_reviews")
    .upsert(
      {
        application_response_id: body.response_id,
        program_id: programId,
        author_id: user.id,
        notes: notes || null,
        interview_outcome: body.interview_outcome,
      },
      { onConflict: "application_response_id,author_id" }
    )
    .select("id, application_response_id, program_id, author_id, notes, interview_outcome, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ review: data });
}
