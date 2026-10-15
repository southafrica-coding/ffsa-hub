import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanManageProgram } from "@/lib/auth/check-schools-access";
import { createAuditLog } from "@/services/audit";
import { setStudentTrack } from "@/services/student-track";

// PUT { enrollmentId, wholeProgram: boolean, codes: string[] }
// A student's track, set from the school's Students tab — the one choice the
// roster, Track tab and billing all follow (src/services/student-track.ts).
export const maxDuration = 60;

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const b = await request.json().catch(() => ({}));
  if (typeof b.enrollmentId !== "string") {
    return NextResponse.json({ error: "enrollmentId is required" }, { status: 400 });
  }
  const codes: string[] = Array.isArray(b.codes) ? b.codes.filter((c: unknown) => typeof c === "string") : [];

  const admin = createAdminClient();
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("program_id")
    .eq("id", b.enrollmentId)
    .single();
  if (!enrollment) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (!(await userCanManageProgram(supabase, user.id, enrollment.program_id))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const res = await setStudentTrack(admin, {
    enrollmentId: b.enrollmentId,
    wholeProgram: b.wholeProgram === true,
    codes,
    createdBy: user.id,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });

  await createAuditLog(supabase, {
    action: "schools.set_track",
    resource_type: "enrollment",
    resource_id: b.enrollmentId,
    changes: { wholeProgram: b.wholeProgram === true, codes, billing: res.billing },
  });
  return NextResponse.json(res);
}
