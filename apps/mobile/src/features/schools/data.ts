// Plain reads, straight from Supabase as the signed-in person: the same
// queries the website's /my-schools, /my-schools/[enrollmentId] and
// /my-attendance pages run with the user's own client (getEnrollmentsByUser,
// getResponsesByUser, getEnrollmentById, getGradesByEnrollment,
// getAttendanceForContact), so row-level security decides exactly as it does
// on the web. Nothing here writes.
//
// Two deliberate differences from the web, both narrower:
//  - every read is also filtered to the caller's own user / contact, so staff
//    whose RLS lets them see everyone's rows still only see their own here;
//  - columns are listed instead of "*", so staff-only fields on the same rows
//    (application admin notes, enrolment notes, grade notes) never reach the phone.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import { supabase } from "@/lib/supabase";

import { strings } from "./strings";
import {
  applicationSchema,
  attendanceSchema,
  enrolmentDetailSchema,
  enrolmentSchema,
  gradeSchema,
  programmeSchema,
  type Application,
  type AttendanceRecord,
  type Enrolment,
  type EnrolmentDetail,
  type Grade,
  type Programme,
} from "./types";

export class DataError extends Error {
  name = "DataError";
}

type Db = Pick<SupabaseClient, "from">;
const db = () => supabase as unknown as Db;
type Res = { data: unknown; error: { message: string; code?: string } | null };

const STAFF = "first_name, last_name, preferred_name, email";
const ENROLMENT_SELECT = `id, status, enrolled_at, completed_at, programs(id, name, code, credit_hours), assigned_staff:users!enrollments_assigned_staff_id_fkey(${STAFF})`;
const APPLICATION_SELECT = `id, program_id, status, submitted_at, programs(id, name, code), assigned_staff:users!application_responses_assigned_staff_id_fkey(${STAFF})`;
const DETAIL_SELECT = `id, status, enrolled_at, completed_at, programs(id, name, code, credit_hours, courses:billing_courses(id, code, name, credit_hours, sequence, start_date, end_date, arrival_date)), assigned_staff:users!enrollments_assigned_staff_id_fkey(${STAFF})`;

/** supabase-js reports a dropped connection as an error whose message says so. */
function failure(err: { message: string; code?: string }): DataError {
  // 42501: Postgres refused the read outright (not just "no rows").
  if (err.code === "42501") return new DataError(strings.common.forbidden);
  return new DataError(/network|fetch|timed? ?out|offline/i.test(err.message) ? strings.common.network : strings.common.generic);
}

export function loadErrorMessage(err: unknown): string {
  return err instanceof DataError ? err.message : strings.common.generic;
}

function rows<T>(schema: z.ZodType<T>, res: Res): T[] {
  if (res.error) throw failure(res.error);
  const out: T[] = [];
  // One odd row shouldn't hide the rest.
  for (const r of Array.isArray(res.data) ? res.data : []) {
    const p = schema.safeParse(r);
    if (p.success) out.push(p.data);
  }
  return out;
}

// ── My Schools list ─────────────────────────────────────────────────────────

export type SchoolsList = { enrolments: Enrolment[]; applications: Application[]; openProgrammes: Programme[] };

export async function loadSchools(userId: string, client: Db = db()): Promise<SchoolsList> {
  const [e, a, p] = await Promise.all([
    client.from("enrollments").select(ENROLMENT_SELECT).eq("user_id", userId).is("removed_at", null).order("enrolled_at", { ascending: false }),
    client.from("application_responses").select(APPLICATION_SELECT).eq("user_id", userId).order("submitted_at", { ascending: false }),
    client.from("programs").select("id, name, code, credit_hours").eq("application_open", true).eq("status", "active").order("name", { ascending: true }),
  ]);
  return { enrolments: rows(enrolmentSchema, e), applications: rows(applicationSchema, a), openProgrammes: rows(programmeSchema, p) };
}

/** Does the person have at least one current enrolment? (Home shortcut only.) */
export async function hasEnrolment(userId: string, client: Db = db()): Promise<boolean> {
  const res = (await client
    .from("enrollments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("removed_at", null)) as Res & { count: number | null };
  if (res.error) throw failure(res.error);
  return (res.count ?? 0) > 0;
}

// ── One enrolment ───────────────────────────────────────────────────────────

export type EnrolmentData = { enrolment: EnrolmentDetail; grades: Grade[] };

/** null when it isn't there or isn't the caller's (RLS or the user filter hid it). */
export async function loadEnrolment(userId: string, id: string, client: Db = db()): Promise<EnrolmentData | null> {
  const [e, g] = await Promise.all([
    client.from("enrollments").select(DETAIL_SELECT).eq("id", id).eq("user_id", userId).is("removed_at", null).maybeSingle(),
    client.from("grades").select("course_id, letter_grade").eq("enrollment_id", id),
  ]);
  if ((e as Res).error) throw failure((e as Res).error!);
  if (!(e as Res).data) return null;
  const parsed = enrolmentDetailSchema.safeParse((e as Res).data);
  if (!parsed.success) return null;
  return { enrolment: parsed.data, grades: rows(gradeSchema, g as Res) };
}

// ── My Attendance ───────────────────────────────────────────────────────────

/** Attendance is recorded against the person's contact, as on the web. */
export async function loadAttendance(userId: string, client: Db = db()): Promise<AttendanceRecord[]> {
  const me = (await client.from("users").select("contact_id").eq("id", userId).maybeSingle()) as Res;
  if (me.error) throw failure(me.error);
  const contactId = (me.data as { contact_id?: string | null } | null)?.contact_id ?? null;
  if (!contactId) return [];
  const res = (await client
    .from("attendance_records")
    .select("id, status, checked_in_at, events(id, title, start_date, location)")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })) as Res;
  return rows(attendanceSchema, res);
}
