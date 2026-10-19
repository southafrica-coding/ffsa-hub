// Prayer Room — schedule / sets / roster data access.
//
// Convention (see plan): READ functions that must show other people's names
// are called by routes with the ADMIN client (after authenticating the caller),
// selecting name-only fields — never contact info. WRITE functions are called
// with the USER client so RLS enforces ownership / staff rules.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const NAME_FIELDS = "id, first_name, last_name, preferred_name";

const SET_SELECT = `
  *,
  owner:owner_id(${NAME_FIELDS}),
  slots:prayer_room_set_slots(
    id, role, seat_type_id, status, position, required_label_id, filled_user_id, invitee_id,
    invited_at, responded_at,
    filled:filled_user_id(${NAME_FIELDS}),
    invitee:invitee_id(${NAME_FIELDS}),
    required_label:required_label_id(id, name, category)
  )
`;

/** Sunday (week start) for a given YYYY-MM-DD date, matching the DB convention. */
export function weekStartOf(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - d.getDay()); // getDay(): 0 = Sunday
  return d.toISOString().split("T")[0];
}

// ────────────────────────────────────────────────────────────
// SETS
// ────────────────────────────────────────────────────────────

export async function getSets(
  supabase: Client,
  options?: { dateFrom?: string; dateTo?: string; status?: string }
) {
  let query = supabase
    .from("prayer_room_sets")
    .select(SET_SELECT)
    .order("set_date")
    .order("start_time");

  if (options?.dateFrom) query = query.gte("set_date", options.dateFrom);
  if (options?.dateTo) query = query.lte("set_date", options.dateTo);
  if (options?.status) {
    query = query.eq("status", options.status);
  } else {
    query = query.in("status", ["scheduled", "completed"]);
  }

  return query;
}

export async function getSetById(supabase: Client, id: string) {
  return supabase.from("prayer_room_sets").select(SET_SELECT).eq("id", id).single();
}

export async function createSet(
  supabase: Client,
  data: {
    owner_id: string;
    created_by: string;
    set_date: string;
    start_time: string;
    end_time: string;
    title?: string | null;
    theme?: string | null;
    scripture?: string | null;
    prayer_focus?: string | null;
    setlist?: string | null;
    series_id?: string | null;
  }
) {
  return supabase
    .from("prayer_room_sets")
    .insert({ ...data, week_start: weekStartOf(data.set_date) })
    .select()
    .single();
}

/** Create a weekly recurrence series (the occurrences are normal sets tagged with series_id). */
export async function createSeries(
  supabase: Client,
  data: {
    owner_id: string;
    created_by: string;
    weekday: number;
    start_time: string;
    end_time: string;
    title?: string | null;
    theme?: string | null;
    series_start: string;
    series_end: string;
    keep_team: boolean;
  }
) {
  return supabase.from("prayer_room_set_series").insert(data).select().single();
}

/** Best-effort cleanup if occurrence creation fails partway. */
export async function deleteSeries(supabase: Client, id: string) {
  return supabase.from("prayer_room_set_series").delete().eq("id", id);
}

/** The occurrences of one series, soonest first (optionally only from a date on). */
export async function getSeriesSets(supabase: Client, seriesId: string, fromDate?: string) {
  let query = supabase
    .from("prayer_room_sets")
    .select(SET_SELECT)
    .eq("series_id", seriesId)
    .neq("status", "cancelled");
  if (fromDate) query = query.gte("set_date", fromDate);
  return query.order("set_date", { ascending: true });
}

/**
 * Delete a whole series in one go — the thing you could only do one set at a
 * time before.
 *
 * The sets must go first and explicitly: series_id is ON DELETE SET NULL, so
 * dropping the series row alone would ORPHAN every occurrence rather than
 * remove it. The series row itself is only cleared once nothing points at it,
 * which keeps a "delete the rest of the series" (fromDate) call from stranding
 * the occurrences that already happened.
 *
 * RLS decides what actually goes: a non-owner's delete removes nothing.
 */
export async function deleteSeriesSets(supabase: Client, seriesId: string, fromDate?: string) {
  let del = supabase.from("prayer_room_sets").delete().eq("series_id", seriesId);
  if (fromDate) del = del.gte("set_date", fromDate);
  const { data: deleted, error } = await del.select("id");
  if (error) return { data: null, error };

  const { data: remaining } = await supabase
    .from("prayer_room_sets")
    .select("id")
    .eq("series_id", seriesId)
    .limit(1);
  if (!remaining || remaining.length === 0) await deleteSeries(supabase, seriesId);

  return { data: { count: deleted?.length ?? 0 }, error: null };
}

/** Apply the same field changes to every (or every remaining) set in a series. */
export async function updateSeriesSets(
  supabase: Client,
  seriesId: string,
  fields: Record<string, unknown>,
  fromDate?: string
) {
  let query = supabase.from("prayer_room_sets").update(fields).eq("series_id", seriesId);
  if (fromDate) query = query.gte("set_date", fromDate);
  const { data, error } = await query.select("id");
  if (error) return { data: null, error };
  return { data: { count: data?.length ?? 0 }, error: null };
}

export async function updateSet(supabase: Client, id: string, data: Record<string, unknown>) {
  return supabase.from("prayer_room_sets").update(data).eq("id", id).select().single();
}

export async function completeSet(supabase: Client, id: string) {
  return supabase
    .from("prayer_room_sets")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

export async function cancelSet(supabase: Client, id: string) {
  return supabase
    .from("prayer_room_sets")
    .update({ status: "cancelled" })
    .eq("id", id)
    .select()
    .single();
}

export async function deleteSet(supabase: Client, id: string) {
  return supabase.from("prayer_room_sets").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// "MY" VIEWS
// ────────────────────────────────────────────────────────────

/**
 * Sets the user owns, soonest first.
 *
 * Chronological ascending is the right default: "My sets" is a roster of what
 * you are about to lead, not a history log. (It used to be descending, which
 * showed December above September.) The caller splits upcoming from past.
 */
export async function getOwnedSets(supabase: Client, userId: string, options?: { upcoming?: boolean }) {
  let query = supabase
    .from("prayer_room_sets")
    .select(SET_SELECT)
    .eq("owner_id", userId)
    .neq("status", "cancelled");
  if (options?.upcoming) {
    query = query.eq("status", "scheduled").gte("set_date", today());
  }
  return query.order("set_date", { ascending: true }).order("start_time", { ascending: true });
}

/**
 * Slots the user is rostered into (filled), with the parent set — soonest first.
 *
 * The date lives on the embedded set, so the sort happens here rather than in
 * PostgREST; ordering by the slot's own created_at (as this once did) put the
 * list in invitation order, which reads as no order at all.
 */
export async function getMyRoster(supabase: Client, userId: string) {
  const result = await supabase
    .from("prayer_room_set_slots")
    .select(
      `id, role, status, set:set_id(id, set_date, start_time, end_time, title, theme, status,
        owner:owner_id(${NAME_FIELDS}))`
    )
    .eq("filled_user_id", userId);

  if (result.data) {
    result.data.sort((a: RosterSortRow, b: RosterSortRow) => {
      if (!a.set) return 1;
      if (!b.set) return -1;
      return (
        a.set.set_date.localeCompare(b.set.set_date) ||
        a.set.start_time.localeCompare(b.set.start_time)
      );
    });
  }
  return result;
}

type RosterSortRow = { set: { set_date: string; start_time: string } | null };

/** Open invitations awaiting the user's response. */
export async function getMyInvites(supabase: Client, userId: string) {
  return supabase
    .from("prayer_room_set_slots")
    .select(
      `id, role, status, required_label:required_label_id(id, name),
        set:set_id(id, set_date, start_time, end_time, title, theme,
          owner:owner_id(${NAME_FIELDS}))`
    )
    .eq("invitee_id", userId)
    .eq("status", "invited")
    .order("invited_at", { ascending: true });
}

// ────────────────────────────────────────────────────────────
// ROSTER SLOTS + THE INVITE / CLAIM LOOP
// ────────────────────────────────────────────────────────────

export async function getSetSlots(supabase: Client, setId: string) {
  return supabase
    .from("prayer_room_set_slots")
    .select(
      `id, role, status, position, required_label_id, filled_user_id, invitee_id,
        filled:filled_user_id(${NAME_FIELDS}),
        invitee:invitee_id(${NAME_FIELDS}),
        required_label:required_label_id(id, name, category)`
    )
    .eq("set_id", setId)
    .order("role")
    .order("position");
}

export async function addSlot(
  supabase: Client,
  data: { set_id: string; role: string; required_label_id?: string | null; position?: number }
) {
  return supabase.from("prayer_room_set_slots").insert(data).select().single();
}

export async function addSlots(
  supabase: Client,
  rows: Array<{ set_id: string; role: string; required_label_id?: string | null; position?: number }>
) {
  return supabase.from("prayer_room_set_slots").insert(rows);
}

/** Insert roster slot rows verbatim (open or invited) — used when duplicating a roster. */
export async function insertSlotRows(supabase: Client, rows: Record<string, unknown>[]) {
  return supabase.from("prayer_room_set_slots").insert(rows);
}

export async function removeSlot(supabase: Client, slotId: string) {
  return supabase.from("prayer_room_set_slots").delete().eq("id", slotId);
}

/** Role + parent set + owner (with email) — for post-accept owner notification. */
export async function getSlotForNotify(supabase: Client, slotId: string) {
  return supabase
    .from("prayer_room_set_slots")
    .select(
      `role, set:set_id(set_date, start_time, end_time, title,
        owner:owner_id(id, first_name, last_name, preferred_name, email))`
    )
    .eq("id", slotId)
    .single();
}

export async function inviteToSlot(
  supabase: Client,
  slotId: string,
  data: { invitee_id: string; invited_by: string }
) {
  return supabase
    .from("prayer_room_set_slots")
    .update({
      status: "invited",
      invitee_id: data.invitee_id,
      invited_by: data.invited_by,
      invited_at: new Date().toISOString(),
      filled_user_id: null,
      responded_at: null,
    })
    .eq("id", slotId)
    .select(`*, set:set_id(id, set_date, start_time, end_time, title, theme)`)
    .single();
}

/** Invitee accepts. Fills the slot; the DB EXCLUDE constraint blocks overlaps. */
export async function acceptInvite(supabase: Client, slotId: string, userId: string) {
  const res = await supabase
    .from("prayer_room_set_slots")
    .update({
      status: "filled",
      filled_user_id: userId,
      responded_at: new Date().toISOString(),
    })
    .eq("id", slotId)
    .eq("invitee_id", userId)
    .select()
    .single();

  if (res.error?.code === "23P01") {
    return {
      data: null,
      error: { message: "You're already serving in another set that overlaps this time." },
    };
  }
  return res;
}

/** Invitee declines — reopens the slot cleanly. */
export async function declineInvite(supabase: Client, slotId: string, userId: string) {
  return supabase
    .from("prayer_room_set_slots")
    .update({
      status: "open",
      invitee_id: null,
      filled_user_id: null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", slotId)
    .eq("invitee_id", userId)
    .select()
    .single();
}

/** Owner/staff removes a filled person — reopens the slot. */
export async function vacateSlot(supabase: Client, slotId: string) {
  return supabase
    .from("prayer_room_set_slots")
    .update({ status: "open", filled_user_id: null, invitee_id: null, invited_by: null })
    .eq("id", slotId)
    .select()
    .single();
}

// ────────────────────────────────────────────────────────────
// WEEK INSTANTIATION + COVERAGE
// ────────────────────────────────────────────────────────────

/** Idempotently create this week's sets from the active template (staff only). */
export async function ensureWeek(supabase: Client, weekStart: string) {
  return supabase.rpc("ensure_prayer_room_week", { p_week_start: weekStart });
}

/** Open (unfilled) slots across a week — coverage feed (UI lands in v2). */
export async function getOpenSlots(supabase: Client, weekStart: string) {
  return supabase
    .from("prayer_room_open_slots")
    .select("*")
    .eq("week_start", weekStart)
    .order("set_date")
    .order("start_time");
}

// ────────────────────────────────────────────────────────────
// TEMPLATE + SETTINGS (Manage tab)
// ────────────────────────────────────────────────────────────

export async function getSettings(supabase: Client) {
  return supabase.from("prayer_room_settings").select("*").eq("id", true).single();
}

export async function updateSettings(supabase: Client, data: Record<string, unknown>) {
  return supabase.from("prayer_room_settings").update(data).eq("id", true).select().single();
}

export async function getTemplateBlocks(supabase: Client) {
  return supabase
    .from("prayer_room_template_blocks")
    .select("*")
    .order("day_of_week")
    .order("start_time");
}

export async function createTemplateBlock(
  supabase: Client,
  data: {
    day_of_week: number;
    start_time: string;
    end_time: string;
    title?: string | null;
    role_needs?: Record<string, number>;
    /** Curated-band attributes (migration 171). A band is one block per weekday. */
    band_name?: string | null;
    weekly_focus?: string | null;
    is_curated?: boolean;
  }
) {
  return supabase.from("prayer_room_template_blocks").insert(data).select().single();
}

export async function updateTemplateBlock(supabase: Client, id: string, data: Record<string, unknown>) {
  return supabase.from("prayer_room_template_blocks").update(data).eq("id", id).select().single();
}

export async function deleteTemplateBlock(supabase: Client, id: string) {
  return supabase.from("prayer_room_template_blocks").delete().eq("id", id);
}

// ────────────────────────────────────────────────────────────
// BLOCK-OUTS (Manage tab) — windows when the room is needed elsewhere
// ────────────────────────────────────────────────────────────

export async function getBlockouts(supabase: Client, options?: { from?: string; to?: string }) {
  let q = supabase
    .from("prayer_room_blockouts")
    .select("*")
    .order("block_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: true });
  // A block-out spans block_date → end_date, so a range query wants everything
  // that OVERLAPS [from, to]: it ends on/after `from` and starts on/before `to`.
  if (options?.from) q = q.gte("end_date", options.from);
  if (options?.to) q = q.lte("block_date", options.to);
  return q;
}

export async function createBlockout(
  supabase: Client,
  data: {
    block_date: string;
    end_date: string;
    start_time: string | null;
    end_time: string | null;
    reason?: string | null;
    relocation_note?: string | null;
    created_by: string;
    /** Set when applied from a Space Booking (migration 231). */
    source_booking_id?: string | null;
    source_signature?: string | null;
  }
) {
  return supabase.from("prayer_room_blockouts").insert(data).select().single();
}

export async function deleteBlockout(supabase: Client, id: string) {
  return supabase.from("prayer_room_blockouts").delete().eq("id", id);
}

/**
 * Scheduled sets a block-out displaces (read via admin for owner names).
 * Covers the whole span block_date → end_date; a timed block-out (times given)
 * only catches sets that overlap that window, an all-day one (times null) catches
 * every scheduled set on the covered date(s).
 */
export async function getSetsInWindow(
  supabase: Client,
  blockDate: string,
  endDate: string,
  startTime: string | null,
  endTime: string | null
) {
  let q = supabase
    .from("prayer_room_sets")
    .select(`id, title, theme, set_date, start_time, end_time, owner:owner_id(${NAME_FIELDS})`)
    .gte("set_date", blockDate)
    .lte("set_date", endDate)
    .eq("status", "scheduled");
  if (startTime && endTime) {
    q = q.lt("start_time", endTime).gt("end_time", startTime);
  }
  return q;
}

/**
 * A block-out was removed: take its relocation note back off the sets it
 * moved, so they show in the prayer room again. Only sets still carrying THIS
 * block-out's note are touched — a set booked into its own alternate space, or
 * re-stamped by another block-out that still covers it, keeps its note.
 * `remaining` = the block-outs left after the delete.
 */
export async function clearBlockoutRelocation(
  supabase: Client,
  admin: Client,
  removed: {
    block_date: string;
    end_date: string | null;
    start_time: string | null;
    end_time: string | null;
    relocation_note: string | null;
  },
  remaining: Array<{ block_date: string; end_date: string | null; start_time: string | null; end_time: string | null }>
) {
  if (!removed.relocation_note) return { cleared: 0 };
  const end = removed.end_date || removed.block_date;
  let q = admin
    .from("prayer_room_sets")
    .select("id, set_date, start_time, end_time")
    .gte("set_date", removed.block_date)
    .lte("set_date", end)
    .eq("relocation_note", removed.relocation_note)
    .is("alt_venue_id", null);
  if (removed.start_time && removed.end_time) {
    q = q.lt("start_time", removed.end_time).gt("end_time", removed.start_time);
  }
  const { data } = await q;
  const inWindow = (
    s: { set_date: string; start_time: string; end_time: string },
    b: { block_date: string; end_date: string | null; start_time: string | null; end_time: string | null }
  ) =>
    s.set_date >= b.block_date &&
    s.set_date <= (b.end_date || b.block_date) &&
    (!b.start_time || !b.end_time || (s.start_time < b.end_time && s.end_time > b.start_time));
  const ids = ((data ?? []) as Array<{ id: string; set_date: string; start_time: string; end_time: string }>)
    .filter((s) => !remaining.some((b) => inWindow(s, b)))
    .map((s) => s.id);
  if (ids.length === 0) return { cleared: 0 };
  const { error } = await stampRelocation(supabase, ids, null);
  return { cleared: error ? 0 : ids.length };
}

/** Stamp the relocation note on the displaced sets (staff client). */
export async function stampRelocation(supabase: Client, ids: string[], note: string | null) {
  return supabase.from("prayer_room_sets").update({ relocation_note: note }).in("id", ids);
}

// ────────────────────────────────────────────────────────────
// STATS
// ────────────────────────────────────────────────────────────

export async function getPendingApplicationCount(supabase: Client) {
  const { count } = await supabase
    .from("prayer_room_applications")
    .select("id", { count: "exact", head: true })
    .in("status", ["applied", "assigned", "evaluated"]);
  return count ?? 0;
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}
