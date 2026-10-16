import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLeadershipTeam } from "@/lib/auth/check-okr-access";
import { canBeDecided, getLeadershipTrackProgram } from "@/lib/schools/staff-decisions";

// POST /api/schools/staff-decisions — record (or change) whether a Leadership
// Track student is accepted onto staff. Leadership Team only. A "no" needs a
// note; migration 247's CHECK enforces the same rule in the database.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!(await isLeadershipTeam(supabase, user.id))) {
    return NextResponse.json({ error: "Only the Leadership Team can do this." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { enrollment_id, accepted, note } = body as {
    enrollment_id?: string;
    accepted?: boolean;
    note?: string | null;
  };
  const cleanNote = typeof note === "string" ? note.trim() : "";
  if (!enrollment_id || typeof accepted !== "boolean") {
    return NextResponse.json(
      { error: "enrollment_id and accepted (true/false) are required" },
      { status: 400 }
    );
  }
  if (!accepted && !cleanNote) {
    return NextResponse.json(
      { error: "Please add a note explaining why they weren't accepted." },
      { status: 400 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new table isn't in the generated types yet
  const admin: any = createAdminClient();
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id, program_id, user_id, status, removed_at")
    .eq("id", enrollment_id)
    .maybeSingle();
  if (!enrollment) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }
  if (!(await getLeadershipTrackProgram(admin, enrollment.program_id))) {
    return NextResponse.json(
      { error: "Staff decisions are only for Leadership Track." },
      { status: 400 }
    );
  }
  const { data: existing } = await admin
    .from("staff_acceptance_decisions")
    .select("id")
    .eq("enrollment_id", enrollment_id)
    .maybeSingle();
  if (!existing && !canBeDecided(enrollment)) {
    return NextResponse.json(
      { error: "Only students who arrived can be decided on." },
      { status: 400 }
    );
  }

  const { error } = await admin.from("staff_acceptance_decisions").upsert(
    {
      enrollment_id,
      program_id: enrollment.program_id,
      user_id: enrollment.user_id,
      accepted,
      note: cleanNote || null,
      decided_by: user.id,
      decided_at: new Date().toISOString(),
    },
    { onConflict: "enrollment_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await admin.from("audit_logs").insert({
    user_id: user.id,
    action: "update",
    resource_type: "staff_acceptance_decisions",
    resource_id: enrollment_id,
    changes: { accepted },
  });

  return NextResponse.json({ success: true });
}
