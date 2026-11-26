import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  buildJourney,
  isUuid,
  NO_STORE,
  personName,
  saToday,
  shapeStudents,
  type CheckinRow,
  type EnrolmentRow,
  type NameRow,
  type WalkerRow,
} from "@/lib/mobile/training";
import {
  getNames,
  getVisibleEnrolment,
  listActiveWalkers,
  listArrivals,
  listCheckins,
  listGrades,
  listPrivateNotes,
} from "@/services/training";

// GET /api/mobile/training/students/[enrollmentId] — one student's record on
// the phone (48c Journey + 48d Check-ins). The enrolment, check-ins and
// staff-only notes are read with the caller's own client, so RLS decides:
// a staff-only note the caller may not read simply isn't there. A student
// opening her own enrolment here gets 404 — her side is My Schools.

export const dynamic = "force-dynamic";

const notFound = () =>
  NextResponse.json({ error: "not_found", message: "That student isn't one you can see." }, { status: 404, headers: NO_STORE });
const fail = (message: string) =>
  NextResponse.json({ error: "server_error", message }, { status: 500, headers: NO_STORE });

type Course = { code: string | null; name: string | null } | Array<{ code: string | null; name: string | null }> | null;
const courseLabel = (c: Course) => {
  const one = Array.isArray(c) ? c[0] : c;
  return one?.code || one?.name || null;
};

export async function GET(_req: Request, ctx: { params: Promise<{ enrollmentId: string }> }) {
  const { enrollmentId } = await ctx.params;
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to use this endpoint." },
      { status: 401, headers: NO_STORE }
    );
  }
  if (!isUuid(enrollmentId)) return notFound();

  const enrolment = await getVisibleEnrolment(supabase, enrollmentId);
  if (enrolment.error) return fail(enrolment.error.message);
  const row = enrolment.data as EnrolmentRow | null;
  if (!row || row.user_id === user.id) return notFound();

  const today = saToday(new Date());
  const [walkers, checkins] = await Promise.all([
    listActiveWalkers(supabase, [row.id], today),
    listCheckins(supabase, [row.id], null),
  ]);
  if (walkers.error) return fail(walkers.error.message);
  if (checkins.error) return fail(checkins.error.message);
  const walkerRows = (walkers.data ?? []) as WalkerRow[];
  const checkinRows = (checkins.data ?? []) as CheckinRow[];

  const admin = createAdminClient();
  const [notes, grades, arrivals, names] = await Promise.all([
    listPrivateNotes(supabase, checkinRows.map((c) => c.id)),
    listGrades(admin, row.id),
    listArrivals(admin, row.id),
    getNames(admin, [
      row.user_id,
      ...walkerRows.map((w) => w.user_id),
      ...checkinRows.map((c) => c.by_user_id),
      ...checkinRows.map((c) => c.care_taken_by ?? ""),
    ]),
  ]);
  for (const r of [notes, grades, arrivals, names]) if (r.error) return fail(r.error.message);

  const nameMap = new Map(((names.data ?? []) as NameRow[]).map((n) => [n.id, n]));
  const privateById = new Map(
    ((notes.data ?? []) as Array<{ checkin_id: string; note_staff_only: string }>).map((n) => [n.checkin_id, n.note_staff_only])
  );
  const [summary] = shapeStudents({ me: user.id, today, enrolments: [row], walkers: walkerRows, checkins: checkinRows, names: nameMap });

  return NextResponse.json(
    {
      today,
      student: summary,
      checkins: checkinRows.map((c) => ({
        id: c.id,
        weekOf: c.week_of,
        contact: c.contact,
        mood: c.mood,
        noteForStudent: c.note_for_student,
        noteStaffOnly: privateById.get(c.id) ?? null,
        needsCare: c.needs_care,
        careTaken: c.care_taken_at ? { by: personName(nameMap.get(c.care_taken_by ?? "")), at: c.care_taken_at } : null,
        author: { id: c.by_user_id, name: personName(nameMap.get(c.by_user_id)) },
        mine: c.by_user_id === user.id,
      })),
      journey: buildJourney({
        enrolledAt: row.enrolled_at,
        arrivals: ((arrivals.data ?? []) as Array<{ status: string; marked_at: string; course: Course }>).map((a) => ({
          status: a.status,
          marked_at: a.marked_at,
          course: courseLabel(a.course),
        })),
        grades: ((grades.data ?? []) as Array<{ letter_grade: string | null; graded_at: string | null; courses: Course }>).map(
          (g) => ({ letter_grade: g.letter_grade, graded_at: g.graded_at, course: courseLabel(g.courses) })
        ),
        checkins: checkinRows,
        names: nameMap,
      }),
    },
    { headers: NO_STORE }
  );
}
