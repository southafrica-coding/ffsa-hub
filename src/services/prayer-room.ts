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
    id, role, status, position, required_label_id, filled_user_id, invitee_id,
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

/** Sets the user owns (most recent first). */
export async function getOwnedSets(supabase: Client, userId: string, options?: { upcoming?: boolean }) {
  let query = supabase
    .from("prayer_room_sets")
    .select(SET_SELECT)
    .eq("owner_id", userId)
    .neq("status", "cancelled")
    .order("set_date", { ascending: false });
  if (options?.upcoming) {
    query = supabase
      .from("prayer_room_sets")
      .select(SET_SELECT)
      .eq("owner_id", userId)
      .eq("status", "scheduled")
      .gte("set_date", today())
      .order("set_date", { ascending: true });
  }
  return query;
}

/** Slots the user is rostered into (filled), with the parent set. */
export async function getMyRoster(supabase: Client, userId: string) {
  return supabase
    .from("prayer_room_set_slots")
    .select(
      `id, role, status, set:set_id(id, set_date, start_time, end_time, title, theme, status,
        owner:owner_id(${NAME_FIELDS}))`
    )
    .eq("filled_user_id", userId)
    .order("created_at", { ascending: false });
}

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
    .order("start_time", { ascending: true });
  if (options?.from) q = q.gte("block_date", options.from);
  if (options?.to) q = q.lte("block_date", options.to);
  return q;
}

export async function createBlockout(
  supabase: Client,
  data: {
    block_date: string;
    start_time: string;
    end_time: string;
    reason?: string | null;
    relocation_note?: string | null;
    created_by: string;
  }
) {
  return supabase.from("prayer_room_blockouts").insert(data).select().single();
}

export async function deleteBlockout(supabase: Client, id: string) {
  return supabase.from("prayer_room_blockouts").delete().eq("id", id);
}

/** Scheduled sets overlapping a block-out window (read via admin for owner names). */
export async function getSetsInWindow(
  supabase: Client,
  blockDate: string,
  startTime: string,
  endTime: string
) {
  return supabase
    .from("prayer_room_sets")
    .select(`id, title, theme, start_time, end_time, owner:owner_id(${NAME_FIELDS})`)
    .eq("set_date", blockDate)
    .eq("status", "scheduled")
    .lt("start_time", endTime)
    .gt("end_time", startTime);
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
