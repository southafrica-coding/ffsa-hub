// Rocks, measurables and their weekly values, to-dos, issues and headlines
// for one L10 team. Reads and writes use the caller's session client, so
// 416's RLS applies (read and write need l10_can_access_team).

import { currentQuarter } from "@/lib/departments/quarter";
import { L10_COLUMNS, L10_OPEN_ISSUE_STATUSES, L10_TABLES, type L10ItemKind } from "./types";
import type { Row } from "./validate";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;
type DbResult<T> = { data: T; error: null } | { data: null; error: { code?: string; message?: string } };

/** Rocks and measurables are the team's plan: deleting one needs l10_can_manage_team. */
export const DELETE_NEEDS_MANAGE: Record<L10ItemKind, boolean> = {
  rocks: true,
  measurables: true,
  measurable_values: false,
  todos: false,
  issues: false,
  headlines: false,
};

/** The column that names a person on each kind. They must be on the team. */
export const PERSON_COLUMN: Record<L10ItemKind, string | null> = {
  rocks: "owner_user_id",
  measurables: "owner_id",
  measurable_values: null,
  todos: "owner_id",
  issues: "owner_id",
  headlines: "author_id",
};

/** Meeting references a write may carry. Composite FKs keep them on the team too. */
export const MEETING_COLUMNS = ["source_meeting_id", "resolved_meeting_id"] as const;

export function tableOf(kind: L10ItemKind) {
  return L10_TABLES[kind];
}

/**
 * The default list for each kind:
 *   rocks              ?quarter=YYYY-Qn, default this quarter
 *   measurables        active only; ?all=1 for every one
 *   measurable_values  ?from=YYYY-MM-DD (week_start ≥), default the last 13 weeks; ?measurable_id=
 *   todos              ?status=open|done|all, default open; ?owner=<uuid>
 *   issues             ?status=open|solved|all, default open (identified + discussed); ?owner=<uuid>
 *   headlines          ?meeting_id=<uuid>, else the latest 50
 * Open issues are the carry-over: an unsolved issue is on every meeting's
 * list until it is solved. Nothing is copied.
 */
export async function listItems(
  supabase: Client,
  teamId: string,
  kind: L10ItemKind,
  params: URLSearchParams,
  today: Date = new Date()
): Promise<DbResult<Row[]>> {
  let q = supabase.from(tableOf(kind)).select(L10_COLUMNS[kind]).eq("team_id", teamId);
  const owner = params.get("owner");
  if (kind === "rocks") {
    q = q.eq("quarter", params.get("quarter") || currentQuarter());
    if (owner) q = q.eq("owner_user_id", owner);
  } else if (kind === "measurables") {
    if (params.get("all") !== "1") q = q.eq("is_active", true);
    q = q.order("sort_order", { ascending: true });
  } else if (kind === "measurable_values") {
    const from = params.get("from") || new Date(today.getTime() - 91 * 86400000).toISOString().slice(0, 10);
    q = q.gte("week_start", from);
    const m = params.get("measurable_id");
    if (m) q = q.eq("measurable_id", m);
    q = q.order("week_start", { ascending: true });
  } else if (kind === "todos") {
    const status = params.get("status") || "open";
    if (status === "open") q = q.eq("done", false);
    else if (status === "done") q = q.eq("done", true);
    if (owner) q = q.eq("owner_id", owner);
    q = q.order("due_on", { ascending: true, nullsFirst: false });
  } else if (kind === "issues") {
    const status = params.get("status") || "open";
    if (status === "open") q = q.in("status", [...L10_OPEN_ISSUE_STATUSES]);
    else if (status === "solved") q = q.eq("status", "solved");
    if (owner) q = q.eq("owner_id", owner);
    q = q.order("priority", { ascending: true, nullsFirst: false });
  } else if (kind === "headlines") {
    const meeting = params.get("meeting_id");
    if (meeting) q = q.eq("source_meeting_id", meeting);
    q = q.order("created_at", { ascending: false }).limit(50);
  }
  const res = await q;
  if (res.error) return { data: null, error: res.error };
  return { data: (res.data ?? []) as Row[], error: null };
}

/**
 * Stamps that 416's CHECKs tie to a state: to-dos have done_at exactly when
 * done; issues have solved_at exactly when solved, and resolved_meeting_id
 * only when solved (default: the team's running meeting, if there is one).
 */
export function withStamps(kind: L10ItemKind, values: Row, now: Date, runningMeetingId: string | null): Row {
  const out = { ...values };
  if (kind === "todos" && "done" in values) out.done_at = values.done ? now.toISOString() : null;
  if (kind === "issues" && "status" in values) {
    if (values.status === "solved") {
      out.solved_at = now.toISOString();
      if (!("resolved_meeting_id" in values)) out.resolved_meeting_id = runningMeetingId;
    } else {
      out.solved_at = null;
      out.resolved_meeting_id = null;
    }
  }
  return out;
}

/** Who made it, on each kind's own column. */
function authorship(kind: L10ItemKind, userId: string, values: Row): Row {
  if (kind === "measurable_values") return { entered_by: userId };
  if (kind === "headlines") return { author_id: values.author_id ?? userId };
  return { created_by: userId };
}

export async function createItem(
  supabase: Client,
  team: { id: string; department_id: string },
  kind: L10ItemKind,
  values: Row,
  userId: string,
  opts: { now?: Date; runningMeetingId?: string | null } = {}
): Promise<DbResult<Row>> {
  const now = opts.now ?? new Date();
  const row: Row = {
    ...withStamps(kind, values, now, opts.runningMeetingId ?? null),
    ...authorship(kind, userId, values),
    team_id: team.id,
  };
  // A team rock is a row in 320's rocks with the team's department (composite FK).
  if (kind === "rocks") row.staff_ministry_id = team.department_id;
  const res = await supabase.from(tableOf(kind)).insert(row).select(L10_COLUMNS[kind]).single();
  if (res.error) return { data: null, error: res.error };
  return { data: res.data as Row, error: null };
}

export async function updateItem(
  supabase: Client,
  teamId: string,
  kind: L10ItemKind,
  itemId: string,
  values: Row,
  opts: { now?: Date; runningMeetingId?: string | null } = {}
): Promise<DbResult<Row | null>> {
  let q = supabase
    .from(tableOf(kind))
    .update(withStamps(kind, values, opts.now ?? new Date(), opts.runningMeetingId ?? null))
    .eq("id", itemId)
    .eq("team_id", teamId);
  // Auto headlines are the Hub's (lib/l10/auto-headline).
  if (kind === "headlines") q = q.eq("is_auto", false);
  const res = await q.select(L10_COLUMNS[kind]);
  if (res.error) return { data: null, error: res.error };
  return { data: ((res.data ?? []) as Row[])[0] ?? null, error: null };
}

export async function deleteItem(
  supabase: Client,
  teamId: string,
  kind: L10ItemKind,
  itemId: string
): Promise<DbResult<boolean>> {
  let q = supabase.from(tableOf(kind)).delete().eq("id", itemId).eq("team_id", teamId);
  if (kind === "headlines") q = q.eq("is_auto", false);
  const res = await q.select("id");
  if (res.error) return { data: null, error: res.error };
  return { data: ((res.data ?? []) as Row[]).length > 0, error: null };
}

/** Owners, authors and attendees must be on the team. */
export async function teamMemberIds(supabase: Client, teamId: string): Promise<DbResult<Set<string>>> {
  const res = await supabase.from(L10_TABLES.members).select("profile_id").eq("team_id", teamId);
  if (res.error) return { data: null, error: res.error };
  return { data: new Set(((res.data ?? []) as { profile_id: string }[]).map((m) => m.profile_id)), error: null };
}

export async function isTeamMeeting(supabase: Client, teamId: string, meetingId: string): Promise<DbResult<boolean>> {
  const res = await supabase.from(L10_TABLES.meetings).select("id").eq("id", meetingId).eq("team_id", teamId).maybeSingle();
  if (res.error) return { data: null, error: res.error };
  return { data: !!res.data, error: null };
}

/** The team's running meeting (ended_at is null), if any. */
export async function runningMeetingId(supabase: Client, teamId: string): Promise<DbResult<string | null>> {
  const res = await supabase
    .from(L10_TABLES.meetings)
    .select("id")
    .eq("team_id", teamId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1);
  if (res.error) return { data: null, error: res.error };
  return { data: ((res.data ?? []) as { id: string }[])[0]?.id ?? null, error: null };
}
