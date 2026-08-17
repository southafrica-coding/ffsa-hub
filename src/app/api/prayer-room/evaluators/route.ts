import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { listEvaluators } from "@/services/prayer-room-members";
import { listSeatTypesFull } from "@/services/prayer-room-people";
import { isPrayerRoomStaff, isPrayerRoomEvaluator } from "@/lib/auth/prayer-room-access";

/**
 * The evaluators' portal (frames 12a / 12b) in one read: the queue, the
 * sessions booked, and who may evaluate what.
 *
 * The QUEUE is read with the caller's client, so migration 170's policies keep
 * deciding which seats a scoped evaluator sees. Only the NAMES are resolved
 * with the admin client afterwards — `users` is own-row-or-admin, so an
 * embedded join would hand back a list of nulls.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const [staff, evaluator] = await Promise.all([
    isPrayerRoomStaff(supabase, user.id),
    isPrayerRoomEvaluator(supabase, user.id),
  ]);
  if (!staff && !evaluator) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  // The prayer-room tables are not in the generated Database types, so both
  // clients are used loosely here — the same convention as services/prayer-room.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  type NameRow = { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null };
  type Req = {
    id: string;
    user_id: string;
    seat_type_id: string;
    state: string;
    note: string | null;
    scheduled_at: string | null;
    evaluator_id: string | null;
    created_at: string;
  };

  let requests: Req[] = [];
  try {
    const { data } = await db
      .from("prayer_room_evaluation_requests")
      .select("id, user_id, seat_type_id, state, note, scheduled_at, evaluator_id, created_at")
      .in("state", ["waiting", "booked"])
      .order("created_at", { ascending: true });
    requests = (data ?? []) as Req[];
  } catch {
    // Migration 170 not applied — an empty queue, not an error.
    requests = [];
  }

  const [seatTypes, evaluatorsRes] = await Promise.all([
    listSeatTypesFull(admin),
    listEvaluators(admin),
  ]);

  const subjectIds = [...new Set(requests.map((r) => r.user_id))];
  const evaluatorIds = [...new Set(requests.map((r) => r.evaluator_id).filter((v): v is string => !!v))];
  const evaluatorRows = (evaluatorsRes.data ?? []) as { user_id: string; user: NameRow }[];
  const nameIds = [...new Set([...subjectIds, ...evaluatorIds])];

  const [names, quals, slots, scopes] = await Promise.all([
    nameIds.length
      ? admin.from("users").select("id, first_name, last_name, preferred_name").in("id", nameIds)
      : Promise.resolve({ data: [] as NameRow[] }),
    subjectIds.length
      ? admin
          .from("prayer_room_qualifications")
          .select("user_id, seat_type_id, state")
          .in("user_id", subjectIds)
      : Promise.resolve({ data: [] as { user_id: string; seat_type_id: string; state: string }[] }),
    subjectIds.length
      ? admin
          .from("prayer_room_set_slots")
          .select("filled_user_id")
          .eq("status", "filled")
          .in("filled_user_id", subjectIds)
      : Promise.resolve({ data: [] as { filled_user_id: string }[] }),
    evaluatorRows.length
      ? admin
          .from("prayer_room_members")
          .select("user_id, evaluator_scope")
          .in(
            "user_id",
            evaluatorRows.map((e) => e.user_id)
          )
      : Promise.resolve({ data: [] as { user_id: string; evaluator_scope: string | null }[] }),
  ]);

  const nameBy = new Map(((names.data ?? []) as NameRow[]).map((u) => [u.id, u]));

  const load = new Map<string, number>();
  for (const s of (slots.data ?? []) as { filled_user_id: string }[]) {
    load.set(s.filled_user_id, (load.get(s.filled_user_id) ?? 0) + 1);
  }

  const heldSeats = new Map<string, string[]>();
  for (const q of (quals.data ?? []) as { user_id: string; seat_type_id: string; state: string }[]) {
    if (q.state === "not_evaluated") continue;
    heldSeats.set(q.user_id, [...(heldSeats.get(q.user_id) ?? []), q.seat_type_id]);
  }

  const scopeBy = new Map(
    ((scopes.data ?? []) as { user_id: string; evaluator_scope: string | null }[]).map((s) => [
      s.user_id,
      s.evaluator_scope,
    ])
  );

  const enriched = requests.map((r) => ({
    ...r,
    user: nameBy.get(r.user_id) ?? null,
    evaluator: r.evaluator_id ? nameBy.get(r.evaluator_id) ?? null : null,
    load: load.get(r.user_id) ?? 0,
    holds: heldSeats.get(r.user_id) ?? [],
  }));

  return NextResponse.json({
    queue: enriched.filter((r) => r.state === "waiting"),
    booked: enriched.filter((r) => r.state === "booked"),
    evaluators: evaluatorRows.map((e) => ({
      user_id: e.user_id,
      user: e.user,
      scope: scopeBy.get(e.user_id) ?? "all",
    })),
    seatTypes,
    me: { staff, evaluator, scope: scopeBy.get(user.id) ?? "all" },
  });
}
