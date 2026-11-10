import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isClassroomEnrollment, publishedOnly } from "@/lib/schools/lms-content";
import { getProgramClassroom } from "@/services/lms-content";

// GET /api/my-schools/[enrollmentId]/lms
// The signed-in student's own enrolment → that school's PUBLISHED classroom
// (course → module → lesson, all three published). User client only; RLS on
// lms_* (migration 305) applies the same enrolment rule.

type Ctx = { params: Promise<{ enrollmentId: string }> };

export async function GET(_request: Request, context: Ctx) {
  const { enrollmentId } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: enrollment, error } = await supabase
    .from("enrollments")
    .select("id, program_id, user_id, status, removed_at")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!enrollment) return NextResponse.json({ error: "Enrolment not found" }, { status: 404 });

  const row = enrollment as {
    program_id: string;
    user_id: string;
    status: string;
    removed_at: string | null;
  };
  if (row.user_id !== user.id || !isClassroomEnrollment(row)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data, error: treeError } = await getProgramClassroom(supabase, row.program_id, {
    includeUnpublished: false,
  });
  if (treeError) return NextResponse.json({ error: treeError.message }, { status: 500 });
  return NextResponse.json({ courses: publishedOnly(data ?? []) });
}
