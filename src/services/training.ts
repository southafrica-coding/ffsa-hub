// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

import { ACTIVE_STATUSES, type CheckinInput } from "@/lib/mobile/training";

// ────────────────────────────────────────────────────────────
// Phone Training tab reads and writes (T3). `supabase` is always the
// caller's own client: RLS (migration 334) decides which students,
// check-ins and staff-only notes come back. `admin` is used only for
// names, grades and arrivals of enrolments the caller could already read.
// Shaping lives in src/lib/mobile/training.ts.
// ────────────────────────────────────────────────────────────

const ENROLMENT = "id, user_id, program_id, status, enrolled_at, programs(name, code)";
const CHECKIN =
  "id, enrollment_id, week_of, by_user_id, contact, mood, note_for_student, needs_care, care_taken_by, care_taken_at, created_at";

/** Active enrolments the caller may read as staff (never their own). */
export async function listVisibleEnrolments(supabase: Client, userId: string) {
  return supabase
    .from("enrollments")
    .select(ENROLMENT)
    .in("status", [...ACTIVE_STATUSES])
    .is("removed_at", null)
    .neq("user_id", userId)
    .order("enrolled_at", { ascending: false })
    .limit(500);
}

export async function getVisibleEnrolment(supabase: Client, enrollmentId: string) {
  return supabase.from("enrollments").select(ENROLMENT).eq("id", enrollmentId).is("removed_at", null).maybeSingle();
}

export async function listActiveWalkers(supabase: Client, enrollmentIds: string[], today: string) {
  if (enrollmentIds.length === 0) return { data: [], error: null };
  return supabase
    .from("enrollment_staff")
    .select("enrollment_id, user_id")
    .in("enrollment_id", enrollmentIds)
    .or(`ends_on.is.null,ends_on.gt.${today}`);
}

export async function listCheckins(supabase: Client, enrollmentIds: string[], sinceWeek: string | null) {
  if (enrollmentIds.length === 0) return { data: [], error: null };
  let q = supabase.from("student_checkins").select(CHECKIN).in("enrollment_id", enrollmentIds);
  if (sinceWeek) q = q.gte("week_of", sinceWeek);
  return q.order("week_of", { ascending: false }).order("created_at", { ascending: false });
}

/** Staff-only notes the caller may read (RLS returns only those). */
export async function listPrivateNotes(supabase: Client, checkinIds: string[]) {
  if (checkinIds.length === 0) return { data: [], error: null };
  return supabase.from("student_checkin_private").select("checkin_id, note_staff_only").in("checkin_id", checkinIds);
}

export async function getNames(admin: Client, userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return { data: [], error: null };
  return admin.from("users").select("id, first_name, last_name, preferred_name").in("id", ids);
}

export async function listGrades(admin: Client, enrollmentId: string) {
  return admin
    .from("grades")
    .select("letter_grade, graded_at, courses:billing_courses(code, name)")
    .eq("enrollment_id", enrollmentId);
}

export async function listArrivals(admin: Client, enrollmentId: string) {
  return admin
    .from("enrollment_course_arrivals")
    .select("status, marked_at, course:billing_courses(code, name)")
    .eq("enrollment_id", enrollmentId);
}

/** Migration 336: check-in + staff-only note in one transaction, as the caller. */
export async function saveCheckin(supabase: Client, input: CheckinInput, weekOf: string) {
  return supabase.rpc("save_student_checkin", {
    p_enrollment_id: input.enrollmentId,
    p_week_of: weekOf,
    p_contact: input.contact,
    p_mood: input.mood,
    p_note_for_student: input.noteForStudent,
    p_note_staff_only: input.noteStaffOnly,
    p_needs_care: input.needsCare,
  });
}

/** Take an open care flag. RLS + the 334 guard allow walkers and leaders. */
export async function takeCare(supabase: Client, checkinId: string, userId: string, now: Date) {
  return supabase
    .from("student_checkins")
    .update({ care_taken_by: userId, care_taken_at: now.toISOString() })
    .eq("id", checkinId)
    .eq("needs_care", true)
    .is("care_taken_at", null)
    .select("id, enrollment_id");
}
