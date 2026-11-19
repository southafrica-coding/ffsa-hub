import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  addDays,
  LIST_WINDOW_DAYS,
  NO_STORE,
  saToday,
  weekOf,
  type EnrolmentRow,
  type NameRow,
} from "@/lib/mobile/training";
import {
  buildToday,
  isoWeek,
  mapApplications,
  mapOverdue,
  mapReferences,
  mapUngraded,
  programName,
  type LateReference,
  type OpenApplication,
  type OverdueCharge,
  type UngradedCourse,
} from "@/lib/mobile/training-today";
import { getNames, listActiveWalkers, listCheckins, listVisibleEnrolments } from "@/services/training";
import {
  listDismissals,
  listGradedArrivals,
  listGrades,
  listOpenCare,
  listOverdueCharges,
  listPendingReferences,
  listUndecidedApplications,
  managedPrograms,
  myLedPrograms,
} from "@/services/training-today";

// GET /api/mobile/training/today — the phone Training tab's Today (48a).
// Every read uses the caller's own client, so RLS decides what exists for
// them; leader items (check-in counts, decisions, grades, references, fees)
// are then kept to schools the caller manages. The service role is used
// only for names. Contract: src/lib/mobile/training-today.ts.

export const dynamic = "force-dynamic";

const fail = (message: string) =>
  NextResponse.json({ error: "server_error", message }, { status: 500, headers: NO_STORE });

export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in to use this endpoint." },
      { status: 401, headers: NO_STORE }
    );
  }

  const now = new Date();
  const today = saToday(now);
  const week = weekOf(now);

  const [enrolments, led, dismissals] = await Promise.all([
    listVisibleEnrolments(supabase, user.id),
    myLedPrograms(supabase, user.id),
    listDismissals(supabase, user.id, isoWeek(week)),
  ]);
  if (enrolments.error) return fail(enrolments.error.message);
  const rows = (enrolments.data ?? []) as EnrolmentRow[];
  const ids = rows.map((r) => r.id);

  const [walkers, checkins, care] = await Promise.all([
    listActiveWalkers(supabase, ids, today),
    listCheckins(supabase, ids, addDays(today, -LIST_WINDOW_DAYS)),
    listOpenCare(supabase, ids),
  ]);
  for (const r of [walkers, checkins, care]) if (r.error) return fail(r.error.message);

  const mine = new Set(
    ((walkers.data ?? []) as Array<{ enrollment_id: string; user_id: string }>)
      .filter((w) => w.user_id === user.id)
      .map((w) => w.enrollment_id)
  );
  const lastWeek = new Map<string, string>();
  for (const c of (checkins.data ?? []) as Array<{ enrollment_id: string; week_of: string }>) {
    const prev = lastWeek.get(c.enrollment_id);
    if (!prev || c.week_of > prev) lastWeek.set(c.enrollment_id, c.week_of);
  }

  const manages = await managedPrograms(supabase, [
    ...rows.map((r) => r.program_id),
    ...((led.data ?? []) as Array<{ program_id: string }>).map((l) => l.program_id),
  ]);

  let applications: OpenApplication[] = [];
  let references: LateReference[] = [];
  let ungraded: UngradedCourse[] = [];
  let overdue: OverdueCharge[] = [];

  if (manages.size > 0) {
    const managedIds = rows.filter((r) => manages.has(r.program_id)).map((r) => r.id);
    const [apps, refs, arrivals, grades, charges] = await Promise.all([
      listUndecidedApplications(supabase),
      listPendingReferences(supabase),
      listGradedArrivals(supabase, managedIds),
      listGrades(supabase, managedIds),
      listOverdueCharges(supabase, today),
    ]);
    // These are extras: a read the caller may not make (or a table that
    // isn't there) drops that line, it never fails Today.
    if (!apps.error) applications = mapApplications(apps.data ?? []);
    if (!refs.error) references = mapReferences(refs.data ?? []);
    if (!arrivals.error && !grades.error) ungraded = mapUngraded(arrivals.data ?? [], grades.data ?? [], today);
    if (!charges.error) overdue = mapOverdue(charges.data ?? []);
  }

  const careRows = (care.data ?? []) as Array<{ id: string; enrollment_id: string; by_user_id: string; created_at: string }>;
  const names = await getNames(createAdminClient(), [...rows.map((r) => r.user_id), ...careRows.map((c) => c.by_user_id)]);
  if (names.error) return fail(names.error.message);

  const payload = buildToday({
    me: user.id,
    today,
    weekOf: week,
    manages,
    students: rows.map((r) => ({
      enrollmentId: r.id,
      userId: r.user_id,
      programId: r.program_id,
      programName: programName(r.programs),
      status: r.status,
      walkingWithMe: mine.has(r.id),
      lastWeekOf: lastWeek.get(r.id) ?? null,
    })),
    care: careRows.map((c) => ({ checkinId: c.id, enrollmentId: c.enrollment_id, authorId: c.by_user_id, createdAt: c.created_at })),
    applications,
    references,
    ungraded,
    overdue,
    names: new Map(((names.data ?? []) as NameRow[]).map((n) => [n.id, n])),
    dismissed: new Set(dismissals.error ? [] : ((dismissals.data ?? []) as Array<{ item_key: string }>).map((d) => d.item_key)),
  });
  return NextResponse.json(payload, { headers: NO_STORE });
}
