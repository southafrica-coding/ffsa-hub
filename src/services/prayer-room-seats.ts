/**
 * Seat qualifications, candidates and requests — the read side of the
 * prayer-room rebuild (migrations 167–170).
 *
 * Every function degrades to an empty result rather than throwing when a
 * migration has not been applied yet: the redesigned UI has to render on a
 * database that is only partway through the sequence.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const NAME_FIELDS = "id, first_name, last_name, preferred_name";

/** How far back "load" looks when balancing who gets asked next. */
const LOAD_WINDOW_DAYS = 30;

export type QualState = "not_evaluated" | "in_training" | "signed_off";

export type Candidate = {
  user_id: string;
  user: { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null };
  state: QualState;
  /** Sets held in the trailing 30 days — the picker offers the least-loaded first. */
  load: number;
  /** Set they already hold that overlaps this one, if any. */
  clash: { set_id: string; title: string | null; start_time: string; set_date: string } | null;
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

export async function listSeatTypes(supabase: Client) {
  const data = await safe<{ id: string; label: string; category: string; is_lead: boolean }[]>(() =>
    supabase
      .from("prayer_room_seat_types")
      .select("id, label, category, is_lead")
      .eq("is_active", true)
      .order("sort_order")
  );
  return data ?? [];
}

/**
 * Everyone who could take this seat, with the three things a lead needs to
 * decide: are they signed off, how much are they already carrying, and would
 * this clash with something they already hold.
 *
 * Ordering encodes design rule 3 — signed-off first, then by ascending load,
 * so the person asked least often surfaces at the top rather than whoever
 * happens to sort first alphabetically.
 */
export async function listSeatCandidates(
  supabase: Client,
  opts: { seatTypeId: string; setId?: string | null }
): Promise<Candidate[]> {
  const members = await safe<{ user_id: string; user: Candidate["user"] }[]>(() =>
    supabase
      .from("prayer_room_members")
      .select(`user_id, user:user_id(${NAME_FIELDS})`)
      .eq("status", "active")
  );
  if (!members?.length) return [];

  const ids = members.map((m) => m.user_id);

  // The set being filled, so we can spot a clash against its real window.
  const target = opts.setId
    ? await safe<{ id: string; set_date: string; start_time: string; end_time: string }>(() =>
        supabase
          .from("prayer_room_sets")
          .select("id, set_date, start_time, end_time")
          .eq("id", opts.setId)
          .single()
      )
    : null;

  const since = new Date();
  since.setDate(since.getDate() - LOAD_WINDOW_DAYS);
  const sinceISO = since.toISOString().slice(0, 10);

  const [quals, held] = await Promise.all([
    safe<{ user_id: string; state: QualState }[]>(() =>
      supabase
        .from("prayer_room_qualifications")
        .select("user_id, state")
        .eq("seat_type_id", opts.seatTypeId)
        .in("user_id", ids)
    ),
    // Filled seats in the load window AND on the target day, in one read —
    // the day's rows are what clash detection needs and they are a tiny subset.
    safe<
      {
        filled_user_id: string;
        set: { id: string; set_date: string; start_time: string; end_time: string; title: string | null } | null;
      }[]
    >(() =>
      supabase
        .from("prayer_room_set_slots")
        .select(
          "filled_user_id, set:set_id(id, set_date, start_time, end_time, title)"
        )
        .eq("status", "filled")
        .in("filled_user_id", ids)
        .gte("set.set_date", sinceISO)
    ),
  ]);

  const stateBy = new Map((quals ?? []).map((q) => [q.user_id, q.state]));

  const loadBy = new Map<string, number>();
  const clashBy = new Map<string, Candidate["clash"]>();

  for (const row of held ?? []) {
    const s = row.set;
    if (!s) continue;
    loadBy.set(row.filled_user_id, (loadBy.get(row.filled_user_id) ?? 0) + 1);

    if (target && s.set_date === target.set_date && s.id !== target.id) {
      // Times are "HH:MM[:SS]" strings on the same day, so string compare is
      // enough and avoids inventing a timezone.
      const overlaps = s.start_time < target.end_time && s.end_time > target.start_time;
      if (overlaps && !clashBy.has(row.filled_user_id)) {
        clashBy.set(row.filled_user_id, {
          set_id: s.id,
          title: s.title,
          start_time: s.start_time,
          set_date: s.set_date,
        });
      }
    }
  }

  const rank: Record<QualState, number> = { signed_off: 0, in_training: 1, not_evaluated: 2 };

  return members
    .map<Candidate>((m) => ({
      user_id: m.user_id,
      user: m.user,
      state: stateBy.get(m.user_id) ?? "not_evaluated",
      load: loadBy.get(m.user_id) ?? 0,
      clash: clashBy.get(m.user_id) ?? null,
    }))
    .sort((a, b) => rank[a.state] - rank[b.state] || a.load - b.load);
}

/** Every qualification a person holds, for their profile / seat list. */
export async function listQualificationsFor(supabase: Client, userId: string) {
  const data = await safe<{ seat_type_id: string; state: QualState; updated_at: string }[]>(() =>
    supabase
      .from("prayer_room_qualifications")
      .select("seat_type_id, state, updated_at")
      .eq("user_id", userId)
  );
  return data ?? [];
}

/**
 * Record an evaluation and move the qualification with it.
 *
 * The two writes are deliberately ordered: the evaluation (the evidence) lands
 * first, so a failure on the qualification never leaves a sign-off with
 * nothing behind it. RLS decides whether either is allowed.
 */
export async function recordSeatEvaluation(
  supabase: Client,
  input: {
    user_id: string;
    seat_type_id: string;
    evaluator_id: string;
    outcome: QualState | "not_yet";
    feedback?: string | null;
    private_note?: string | null;
    observed_set_id?: string | null;
  }
) {
  const { error: evalErr } = await supabase.from("prayer_room_evaluations").insert({
    user_id: input.user_id,
    seat_type_id: input.seat_type_id,
    evaluator_id: input.evaluator_id,
    outcome: input.outcome,
    feedback: input.feedback ?? null,
    private_note: input.private_note ?? null,
    observed_set_id: input.observed_set_id ?? null,
  });
  if (evalErr) return { error: evalErr };

  // 'not_yet' is an outcome, not a qualification state — it means "looked,
  // not signed off", which the qualification records as not_evaluated.
  const state: QualState = input.outcome === "not_yet" ? "not_evaluated" : input.outcome;

  const { error: qualErr } = await supabase
    .from("prayer_room_qualifications")
    .upsert(
      {
        user_id: input.user_id,
        seat_type_id: input.seat_type_id,
        state,
        updated_by: input.evaluator_id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,seat_type_id" }
    );

  return { error: qualErr ?? null };
}
