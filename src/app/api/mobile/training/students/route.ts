import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthedUser } from "@/lib/api-auth";
import {
  addDays,
  LIST_WINDOW_DAYS,
  NO_STORE,
  saToday,
  shapeStudents,
  type CheckinRow,
  type EnrolmentRow,
  type NameRow,
  type WalkerRow,
} from "@/lib/mobile/training";
import { getNames, listActiveWalkers, listCheckins, listVisibleEnrolments } from "@/services/training";

// GET /api/mobile/training/students — the phone Training tab's Students /
// My students list (redesign 48c). Which students come back is decided by
// RLS on the caller's own client: school leaders and admins see their
// schools, program staff their school, walkers the students they walk
// with. Names are read with the service role only for those students.
// Contract: src/lib/mobile/training.ts.

export const dynamic = "force-dynamic";

function fail(message: string) {
  return NextResponse.json({ error: "server_error", message }, { status: 500, headers: NO_STORE });
}

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
  const enrolments = await listVisibleEnrolments(supabase, user.id);
  if (enrolments.error) return fail(enrolments.error.message);
  const rows = (enrolments.data ?? []) as EnrolmentRow[];
  const ids = rows.map((r) => r.id);

  const [walkers, checkins] = await Promise.all([
    listActiveWalkers(supabase, ids, today),
    listCheckins(supabase, ids, addDays(today, -LIST_WINDOW_DAYS)),
  ]);
  if (walkers.error) return fail(walkers.error.message);
  if (checkins.error) return fail(checkins.error.message);
  const walkerRows = (walkers.data ?? []) as WalkerRow[];

  const names = await getNames(createAdminClient(), [
    ...rows.map((r) => r.user_id),
    ...walkerRows.map((w) => w.user_id),
  ]);
  if (names.error) return fail(names.error.message);

  const students = shapeStudents({
    me: user.id,
    today,
    enrolments: rows,
    walkers: walkerRows,
    checkins: (checkins.data ?? []) as CheckinRow[],
    names: new Map(((names.data ?? []) as NameRow[]).map((n) => [n.id, n])),
  });
  return NextResponse.json({ today, students }, { headers: NO_STORE });
}
