// ────────────────────────────────────────────────────────────
// FFSA Hub — setting a student's track from the school's Students tab
// ────────────────────────────────────────────────────────────
// Staff pick each student's track (whole program, or which courses) in one
// place, and everything follows it: the enrolment's track of record (what
// billing reads, migration 221), the application's choice (what the Track tab
// reads), and the student's billing plan.
//
// Billing is rebuilt only while nothing on it has been invoiced. Once a
// charge is in Xero the plan is left alone and finance is told — a real
// invoice is never thrown away by a dropdown.
// ────────────────────────────────────────────────────────────

import { getTrackSegments } from "@/lib/schools/track-segments";
import { commitPlanForEnrollment } from "@/services/billing-generation";
import { holdDueNow } from "@/services/xero-match";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type TrackBillingOutcome = "none" | "rebuilt" | "kept";

export async function setStudentTrack(
  admin: Client,
  input: { enrollmentId: string; wholeProgram: boolean; codes: string[]; createdBy: string | null }
): Promise<{ ok: true; billing: TrackBillingOutcome; warning?: string } | { ok: false; error: string }> {
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id, user_id, program_id, status, enrolled_at, users!enrollments_user_id_fkey(nationality)")
    .eq("id", input.enrollmentId)
    .single();
  if (!enrollment) return { ok: false, error: "Student not found" };

  const segments = await getTrackSegments(admin, enrollment.program_id, ["active", "upcoming", "completed"]);
  if (segments.length === 0) return { ok: false, error: "This school isn't split into courses" };
  const idByCode = new Map(segments.map((s) => [s.code, s.id]));
  const courseIds = input.wholeProgram ? [] : [...new Set(input.codes)].map((c) => idByCode.get(c));
  if (courseIds.some((id) => !id)) return { ok: false, error: "Unknown course" };
  if (!input.wholeProgram && courseIds.length === 0) return { ok: false, error: "Pick at least one course" };
  // Every course is the whole program.
  const whole = input.wholeProgram || courseIds.length === segments.length;
  const trackIds: Array<string | null> = whole ? [null] : (courseIds as string[]);

  // 1. The enrolment's track of record.
  await admin.from("enrollment_segments").delete().eq("enrollment_id", enrollment.id);
  const { error: segErr } = await admin.from("enrollment_segments").insert(
    trackIds.map((id) => ({ enrollment_id: enrollment.id, billing_course_id: id, created_by: input.createdBy }))
  );
  if (segErr) return { ok: false, error: segErr.message };

  // 2. The application(s) behind it, so the Track tab says the same.
  if (enrollment.user_id) {
    const { data: apps } = await admin
      .from("application_responses")
      .select("id")
      .eq("program_id", enrollment.program_id)
      .eq("user_id", enrollment.user_id)
      .is("removed_at", null);
    for (const a of (apps ?? []) as { id: string }[]) {
      await admin.from("application_segment_choices").delete().eq("application_response_id", a.id);
      await admin
        .from("application_segment_choices")
        .insert(trackIds.map((id) => ({ application_response_id: a.id, billing_course_id: id })));
    }
  }

  // 3. Billing.
  const { data: plans } = await admin.from("student_billing_plans").select("id").eq("enrollment_id", enrollment.id);
  const planIds = ((plans ?? []) as { id: string }[]).map((p) => p.id);
  if (planIds.length === 0) return { ok: true, billing: "none" };

  const { count: invoiced } = await admin
    .from("student_billing_schedule")
    .select("id", { count: "exact", head: true })
    .in("plan_id", planIds)
    .or("xero_invoice_id.not.is.null,status.in.(generated,sent,paid)");
  if ((invoiced ?? 0) > 0) {
    return {
      ok: true,
      billing: "kept",
      warning: "Track saved. Their billing already has invoices in Xero, so it wasn't changed — adjust their charges in Finance.",
    };
  }

  await admin.from("student_billing_plans").delete().eq("enrollment_id", enrollment.id);
  const res = await commitPlanForEnrollment(admin, enrollment, input.createdBy);
  if (!res.ok) return { ok: false, error: `Track saved, but billing couldn't be rebuilt: ${res.error}` };
  const { data: mine } = await admin.from("student_billing_plans").select("id").eq("enrollment_id", enrollment.id);
  await holdDueNow(admin, ((mine ?? []) as { id: string }[]).map((p) => p.id));
  return { ok: true, billing: "rebuilt" };
}
