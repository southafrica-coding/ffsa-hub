/**
 * The People tab (frame 10a) and a person's profile (frame 11a).
 *
 * Two clients, deliberately:
 *   · names, membership and seat history are read with the ADMIN client, the
 *     same way the directory already reads them — `users` is own-row-or-admin
 *     under RLS, so a roster of other people is impossible on the user client.
 *   · evaluations are read with the CALLER'S client and never the admin one.
 *     Frame 12b's whole point is that three readers see three different things,
 *     and the policies from migration 169 are what decide that. Reading them as
 *     admin would hand every lead the evaluators' notes.
 *
 * Every read degrades to empty rather than throwing: this has to render on a
 * database partway through migrations 168–171.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const NAME_FIELDS = "id, first_name, last_name, preferred_name";
const NIL = "00000000-0000-0000-0000-000000000000";

export type QualState = "not_evaluated" | "in_training" | "signed_off";

export type SeatType = {
  id: string;
  label: string;
  category: string;
  is_lead: boolean;
  sort_order: number;
};

type NamedUser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
};

export type RosterRow = {
  user_id: string;
  user: NamedUser | null;
  member_status: string;
  is_coordinator: boolean;
  /** Seat ids, so the tab's category chips can filter without a second read. */
  signed_off: string[];
  in_training: string[];
  /** Filled seats held, all time — the "how much are they carrying" column. */
  sets: number;
  next: { set_id: string; set_date: string; start_time: string; title: string | null; seat: string | null } | null;
};

async function safe<T>(run: () => PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
  try {
    const { data, error } = await run();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

export async function listSeatTypesFull(client: Client): Promise<SeatType[]> {
  const data = await safe<SeatType[]>(() =>
    client
      .from("prayer_room_seat_types")
      .select("id, label, category, is_lead, sort_order")
      .eq("is_active", true)
      .order("sort_order")
  );
  return data ?? [];
}

/** Minutes between two "HH:MM[:SS]" strings on the same day. */
function minutesBetween(start: string, end: string): number {
  const m = (t: string) => {
    const p = (t || "").match(/^(\d{1,2}):(\d{2})/);
    return p ? parseInt(p[1], 10) * 60 + parseInt(p[2], 10) : 0;
  };
  return Math.max(0, m(end) - m(start));
}

type SlotWithSet = {
  filled_user_id: string;
  seat_type_id: string | null;
  role: string | null;
  set: { id: string; set_date: string; start_time: string; end_time: string; title: string | null; status: string } | null;
};

/** Every filled seat these people hold, with its set — one read, not one per row. */
async function filledSeatsFor(admin: Client, userIds: string[]): Promise<SlotWithSet[]> {
  const rows = await safe<SlotWithSet[]>(() =>
    admin
      .from("prayer_room_set_slots")
      .select("filled_user_id, seat_type_id, role, set:set_id(id, set_date, start_time, end_time, title, status)")
      .eq("status", "filled")
      .in("filled_user_id", userIds.length ? userIds : [NIL])
  );
  // A cancelled set is not something anyone served on.
  return (rows ?? []).filter((r) => r.set && r.set.status !== "cancelled");
}

/**
 * The roster behind frame 10a — and the list every seat-filling picker draws
 * from, which is why it carries qualification state rather than just names.
 */
export async function listRoster(
  admin: Client,
  opts?: { status?: string }
): Promise<RosterRow[]> {
  const status = opts?.status ?? "active";

  let query = admin
    .from("prayer_room_members")
    .select(`user_id, status, is_coordinator, user:user_id(${NAME_FIELDS})`);
  if (status !== "all") query = query.eq("status", status);

  const members = await safe<
    { user_id: string; status: string; is_coordinator: boolean; user: NamedUser | null }[]
  >(() => query);
  if (!members?.length) return [];

  const ids = members.map((m) => m.user_id);
  const today = new Date().toISOString().slice(0, 10);

  const [quals, slots] = await Promise.all([
    safe<{ user_id: string; seat_type_id: string; state: QualState }[]>(() =>
      admin
        .from("prayer_room_qualifications")
        .select("user_id, seat_type_id, state")
        .in("user_id", ids)
    ),
    filledSeatsFor(admin, ids),
  ]);

  const signedOff = new Map<string, string[]>();
  const inTraining = new Map<string, string[]>();
  for (const q of quals ?? []) {
    const bucket = q.state === "signed_off" ? signedOff : q.state === "in_training" ? inTraining : null;
    if (!bucket) continue;
    bucket.set(q.user_id, [...(bucket.get(q.user_id) ?? []), q.seat_type_id]);
  }

  const count = new Map<string, number>();
  const next = new Map<string, RosterRow["next"]>();
  for (const row of slots) {
    const s = row.set!;
    count.set(row.filled_user_id, (count.get(row.filled_user_id) ?? 0) + 1);

    if (s.set_date < today) continue;
    const held = next.get(row.filled_user_id);
    const sooner =
      !held || s.set_date < held.set_date || (s.set_date === held.set_date && s.start_time < held.start_time);
    if (sooner) {
      next.set(row.filled_user_id, {
        set_id: s.id,
        set_date: s.set_date,
        start_time: s.start_time,
        title: s.title,
        seat: row.seat_type_id ?? row.role,
      });
    }
  }

  return members
    .map<RosterRow>((m) => ({
      user_id: m.user_id,
      user: m.user,
      member_status: m.status,
      is_coordinator: m.is_coordinator,
      signed_off: signedOff.get(m.user_id) ?? [],
      in_training: inTraining.get(m.user_id) ?? [],
      sets: count.get(m.user_id) ?? 0,
      next: next.get(m.user_id) ?? null,
    }))
    .sort((a, b) => b.sets - a.sets);
}

export type SeatRecord = {
  seat_type_id: string;
  label: string;
  category: string;
  is_lead: boolean;
  state: QualState;
  /** The evaluation behind the state — only present for readers RLS allows. */
  record: { by: string | null; on: string; feedback: string | null } | null;
};

export type PersonProfile = {
  user: NamedUser | null;
  member: { status: string; created_at: string | null; evaluator_scope: string | null } | null;
  seats: SeatRecord[];
  kpis: {
    sets: number;
    minutes_this_month: number;
    signed_off: number;
    seat_count: number;
    last: { set_date: string; title: string | null; seat: string | null } | null;
  };
  upcoming: { set_id: string; set_date: string; start_time: string; end_time: string; title: string | null; seat: string | null }[];
};

/**
 * One person, for frame 11a.
 *
 * `user` is the caller's client; `admin` is used only for the parts the
 * directory already exposes (names, membership, seat history). Anything
 * evaluative goes through `user` so the policies decide what comes back.
 */
export async function getPersonProfile(
  admin: Client,
  user: Client,
  userId: string
): Promise<PersonProfile | null> {
  const [person, member, seatTypes] = await Promise.all([
    safe<NamedUser>(() => admin.from("users").select(NAME_FIELDS).eq("id", userId).single()),
    safe<{ status: string; created_at: string | null; evaluator_scope: string | null }>(() =>
      admin
        .from("prayer_room_members")
        .select("status, created_at, evaluator_scope")
        .eq("user_id", userId)
        .maybeSingle()
    ),
    listSeatTypesFull(admin),
  ]);
  if (!person) return null;

  const [quals, slots, evals] = await Promise.all([
    safe<{ seat_type_id: string; state: QualState }[]>(() =>
      admin.from("prayer_room_qualifications").select("seat_type_id, state").eq("user_id", userId)
    ),
    filledSeatsFor(admin, [userId]),
    // Caller's client: a set lead gets nothing back here and sees state only,
    // which is exactly frame 12b's third card.
    safe<
      { seat_type_id: string | null; feedback: string | null; created_at: string; evaluator_id: string | null }[]
    >(() =>
      user
        .from("prayer_room_evaluations")
        .select("seat_type_id, feedback, created_at, evaluator_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
    ),
  ]);

  // Evaluator names come from the admin client, but only for evaluations the
  // caller was already allowed to read.
  const evaluatorIds = [...new Set((evals ?? []).map((e) => e.evaluator_id).filter((v): v is string => !!v))];
  const evaluators = evaluatorIds.length
    ? await safe<NamedUser[]>(() => admin.from("users").select(NAME_FIELDS).in("id", evaluatorIds))
    : [];
  const evaluatorName = new Map(
    (evaluators ?? []).map((e) => [e.id, [e.preferred_name || e.first_name, e.last_name].filter(Boolean).join(" ")])
  );

  type EvalRow = { seat_type_id: string | null; feedback: string | null; created_at: string; evaluator_id: string | null };
  const stateBy = new Map((quals ?? []).map((q) => [q.seat_type_id, q.state]));
  const latestEval = new Map<string, EvalRow>();
  for (const e of evals ?? []) {
    if (!e.seat_type_id || latestEval.has(e.seat_type_id)) continue; // already ordered newest first
    latestEval.set(e.seat_type_id, e);
  }

  const seats: SeatRecord[] = seatTypes.map((s) => {
    const e = latestEval.get(s.id);
    return {
      seat_type_id: s.id,
      label: s.label,
      category: s.category,
      is_lead: s.is_lead,
      state: stateBy.get(s.id) ?? "not_evaluated",
      record: e
        ? { by: evaluatorName.get(e.evaluator_id ?? "") ?? null, on: e.created_at, feedback: e.feedback }
        : null,
    };
  });

  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  let minutes = 0;
  let last: PersonProfile["kpis"]["last"] = null;
  const upcoming: PersonProfile["upcoming"] = [];

  for (const row of slots) {
    const s = row.set!;
    const seat = row.seat_type_id ?? row.role;
    if (s.set_date.startsWith(month)) minutes += minutesBetween(s.start_time, s.end_time);
    if (s.set_date < today) {
      if (!last || s.set_date > last.set_date) last = { set_date: s.set_date, title: s.title, seat };
    } else {
      upcoming.push({
        set_id: s.id,
        set_date: s.set_date,
        start_time: s.start_time,
        end_time: s.end_time,
        title: s.title,
        seat,
      });
    }
  }

  upcoming.sort((a, b) => a.set_date.localeCompare(b.set_date) || a.start_time.localeCompare(b.start_time));

  return {
    user: person,
    member,
    seats,
    kpis: {
      sets: slots.length,
      minutes_this_month: minutes,
      signed_off: seats.filter((s) => s.state === "signed_off").length,
      seat_count: seats.length,
      last,
    },
    upcoming: upcoming.slice(0, 8),
  };
}
