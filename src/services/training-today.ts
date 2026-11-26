// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

import { DECIDE_STATUSES } from "@/lib/mobile/training-today";

// ────────────────────────────────────────────────────────────
// Reads for the phone Training tab's Today (T4). Always the caller's own
// client: RLS decides what comes back, and the route then keeps leader
// items to schools the caller manages (has_schools_access). Shaping lives
// in src/lib/mobile/training-today.ts.
// ────────────────────────────────────────────────────────────

/** Schools (of those given) the caller manages: admin, schools.manage, or leader. */
export async function managedPrograms(supabase: Client, programIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(programIds.filter(Boolean))];
  const answers = await Promise.all(
    ids.map(async (id) => {
      const { data, error } = await supabase.rpc("has_schools_access", { target_program_id: id });
      return !error && data === true ? id : null;
    })
  );
  return new Set(answers.filter((x): x is string => !!x));
}

/** Programs the caller leads, so a leader with no students yet still gets their school's items. */
export async function myLedPrograms(supabase: Client, userId: string) {
  return supabase.from("program_leaders").select("program_id").eq("user_id", userId);
}

export async function listOpenCare(supabase: Client, enrollmentIds: string[]) {
  if (enrollmentIds.length === 0) return { data: [], error: null };
  return supabase
    .from("student_checkins")
    .select("id, enrollment_id, by_user_id, created_at")
    .in("enrollment_id", enrollmentIds)
    .eq("needs_care", true)
    .is("care_taken_at", null);
}

export async function listUndecidedApplications(supabase: Client) {
  return supabase
    .from("application_responses")
    .select("program_id, status, submitted_at, programs(name)")
    .in("status", [...DECIDE_STATUSES])
    .is("removed_at", null)
    .limit(1000);
}

export async function listPendingReferences(supabase: Client) {
  return supabase
    .from("reference_requests")
    .select("created_at, email_sent_at, application:application_responses(program_id, status, removed_at, programs(name))")
    .eq("status", "pending")
    .limit(1000);
}

/** Students who arrived on a graded course, with the course and any grade. */
export async function listGradedArrivals(supabase: Client, enrollmentIds: string[]) {
  if (enrollmentIds.length === 0) return { data: [], error: null };
  return supabase
    .from("enrollment_course_arrivals")
    .select("enrollment_id, billing_course_id, course:billing_courses(id, code, name, end_date, graded, program_id)")
    .in("enrollment_id", enrollmentIds)
    .eq("status", "arrived");
}

export async function listGrades(supabase: Client, enrollmentIds: string[]) {
  if (enrollmentIds.length === 0) return { data: [], error: null };
  return supabase.from("grades").select("enrollment_id, course_id, letter_grade").in("enrollment_id", enrollmentIds);
}

/** Invoiced and sent charges past their due date (RLS keeps program staff out, 304). */
export async function listOverdueCharges(supabase: Client, today: string) {
  return supabase
    .from("student_billing_schedule")
    .select("amount_zar, amount_paid_zar, due_date, status, sent_at, plan:student_billing_plans(program_id, enrollment_id, programs(name))")
    .in("status", ["generated", "sent"])
    .lt("due_date", today)
    .limit(2000);
}

export async function listDismissals(supabase: Client, userId: string, isoWeek: string) {
  return supabase.from("today_dismissals").select("item_key").eq("user_id", userId).eq("iso_week", isoWeek);
}

export async function setDismissed(supabase: Client, userId: string, key: string, isoWeek: string, done: boolean) {
  if (done) {
    return supabase
      .from("today_dismissals")
      .upsert({ user_id: userId, item_key: key, iso_week: isoWeek }, { onConflict: "user_id,item_key,iso_week", ignoreDuplicates: true });
  }
  return supabase.from("today_dismissals").delete().eq("user_id", userId).eq("item_key", key).eq("iso_week", isoWeek);
}
