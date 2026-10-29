import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuditLog } from "@/services/audit";

// PUT { enrollmentId, courseId, status: "waiting" | "arrived" | "no_show" }
// Marks one course's arrival for one student (migration 259), from the
// Arrival tab. "waiting" clears the mark. enrollments.status stays the
// school-wide summary everything else reads: arrived for any course → 'arrived',
// otherwise back to 'waiting_for_arrival'. A student who graduated, left or was
// dismissed keeps that status.
const STATUSES = ["waiting", "arrived", "no_show"] as const;
type Mark = (typeof STATUSES)[number];

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const b = await request.json().catch(() => ({}));
  const status = b.status as Mark;
  if (typeof b.enrollmentId !== "string" || typeof b.courseId !== "string" || !STATUSES.includes(status)) {
    return NextResponse.json({ error: "enrollmentId, courseId and a valid status are required" }, { status: 400 });
  }

  // billing_courses and enrollment_course_arrivals are newer than the generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = supabase;
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id, program_id, status")
    .eq("id", b.enrollmentId)
    .single();
  if (!enrollment) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  // The same rule that lets someone change arrival on the enrolment itself
  // (enrollments UPDATE policy, migration 040) — asked of the database as the
  // signed-in user, so whoever marks arrivals today can mark them per course.
  const [access, perm] = await Promise.all([
    db.rpc("has_schools_access", { target_program_id: enrollment.program_id }),
    db.rpc("has_permission_for", {
      required_permission: "schools.manage_enrollments",
      target_program_id: enrollment.program_id,
    }),
  ]);
  if (access.data !== true && perm.data !== true) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { data: course } = await admin
    .from("billing_courses")
    .select("id, program_id")
    .eq("id", b.courseId)
    .single();
  if (!course || course.program_id !== enrollment.program_id) {
    return NextResponse.json({ error: "That course isn't part of this school" }, { status: 400 });
  }

  const write =
    status === "waiting"
      ? admin
          .from("enrollment_course_arrivals")
          .delete()
          .eq("enrollment_id", enrollment.id)
          .eq("billing_course_id", course.id)
      : admin.from("enrollment_course_arrivals").upsert(
          {
            enrollment_id: enrollment.id,
            billing_course_id: course.id,
            status,
            marked_by: user.id,
            marked_at: new Date().toISOString(),
          },
          { onConflict: "enrollment_id,billing_course_id" }
        );
  const { error } = await write;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Keep the school-wide status in step.
  if (enrollment.status === "waiting_for_arrival" || enrollment.status === "arrived") {
    const { count } = await admin
      .from("enrollment_course_arrivals")
      .select("id", { count: "exact", head: true })
      .eq("enrollment_id", enrollment.id)
      .eq("status", "arrived");
    const next = (count ?? 0) > 0 ? "arrived" : "waiting_for_arrival";
    if (next !== enrollment.status) {
      await admin.from("enrollments").update({ status: next }).eq("id", enrollment.id);
    }
  }

  await createAuditLog(supabase, {
    action: "schools.set_course_arrival",
    resource_type: "enrollment",
    resource_id: enrollment.id,
    changes: { courseId: course.id, status },
  });
  return NextResponse.json({ success: true });
}
