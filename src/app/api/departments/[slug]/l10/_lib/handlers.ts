// The L10 API, one function per route. The route files next to this
// folder only unwrap params and call these.
//
//   GET    /l10                                    teams in this department, with my role
//   GET    /l10/teams/:teamId                      team detail (members, items, running meeting)
//   GET    /l10/teams/:teamId/:kind                list (kind = rocks|measurables|todos|issues|headlines)
//   POST   /l10/teams/:teamId/:kind                create
//   PATCH  /l10/teams/:teamId/:kind/:itemId        edit
//   DELETE /l10/teams/:teamId/:kind/:itemId        delete
//   GET    /l10/teams/:teamId/meetings             recent meetings
//   POST   /l10/teams/:teamId/meetings             start
//   GET    /l10/teams/:teamId/meetings/:id         one meeting with attendees
//   POST   /l10/teams/:teamId/meetings/:id/advance next segment ({ from? })
//   POST   /l10/teams/:teamId/meetings/:id/end     end ({ ratings: [{ user_id, rating }] }), then DMs
//   POST   /l10/teams/:teamId/headlines/:id/dismiss hide a headline (sets dismissed_at)
//   DELETE /l10/teams/:teamId/headlines/:id/dismiss show it again (clears dismissed_at)
//
// Start, advance and loading a running meeting also make sure it has its
// cross-team headline (lib/l10/auto-headline). Auto headlines cannot be
// edited or deleted through PATCH/DELETE (409 l10_auto_headline_locked), and
// no request may set is_auto, recap_of_meeting_id or dismissed_at (400
// l10_auto_headline_field); dismiss is the way to hide one.
//
// Error codes follow the department routes: 401 signed out, 403 inactive or
// not allowed to write, 404 no such department / team / item (or not
// visible), 400 bad body, 409 the meeting moved on or is already running (code l10_meeting_already_open).
// 416's named database errors come back with their code (lib/l10/http dbError).
// kind also takes measurable_values (the weekly scorecard numbers).

import "server-only";

import { NextResponse } from "next/server";
import { createAuditLog } from "@/services/audit";
import { readJson } from "@/lib/departments/http";
import { currentQuarter } from "@/lib/departments/quarter";
import { isUuid } from "@/lib/departments/validate";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureAutoHeadline, type AutoHeadlineOutcome } from "@/lib/l10/auto-headline";
import { runL10MeetingEnded } from "@/lib/slack/l10-followup";
import { isOpened, isTeamContext, openL10Department, openL10Team, type L10TeamContext } from "./open";
import { badRequest, conflict, dbError, notAuthorized, notFound } from "@/lib/l10/http";
import {
  createItem,
  deleteItem,
  DELETE_NEEDS_MANAGE,
  isTeamMeeting,
  listItems,
  runningMeetingId,
  MEETING_COLUMNS,
  PERSON_COLUMN,
  teamMemberIds,
  updateItem,
} from "@/lib/l10/items";
import {
  advanceSegment,
  averageRating,
  endMeeting,
  loadMeeting,
  startMeeting,
  withCurrentSegment,
  type MeetingResult,
  type MeetingRow,
} from "@/lib/l10/meetings";
import { L10_AUTO_HEADLINE_LOCKED, L10_COLUMNS, L10_TABLES, isItemKind, type L10ItemKind } from "@/lib/l10/types";
import { parseItemCreate, parseItemPatch, parseMeetingEnd, parseMeetingStart, parseSegmentAdvance, type Row } from "@/lib/l10/validate";

type Opened = { response: NextResponse } | L10TeamContext;

const SINGULAR: Record<L10ItemKind, string> = {
  rocks: "rock",
  measurables: "measurable",
  measurable_values: "measurable_value",
  todos: "todo",
  issues: "issue",
  headlines: "headline",
};

function meetingError(result: Extract<MeetingResult<unknown>, { ok: false }>) {
  if (result.kind === "db") return dbError(result.error);
  if (result.kind === "not_found") return notFound(result.message);
  if (result.kind === "conflict") return conflict(result.message, result.extra);
  if (result.kind === "forbidden") return NextResponse.json({ error: result.message }, { status: 403 });
  return badRequest(result.message);
}

async function audit(ctx: L10TeamContext, action: string, resourceType: string, resourceId: string, changes?: Record<string, unknown>) {
  await createAuditLog(ctx.supabase, { action, resource_type: resourceType, resource_id: resourceId, changes: changes ?? null }).catch(
    (error: unknown) => console.error(error)
  );
}

/** A parse failure, with its error code when it has one. */
function parseError(parsed: { error: string; code?: string }) {
  return parsed.code ? NextResponse.json({ error: parsed.error, code: parsed.code }, { status: 400 }) : badRequest(parsed.error);
}

/**
 * Make sure a running meeting has its cross-team headline (service role).
 * Never fails the request: a problem is logged and reported as "error".
 */
async function ensureAuto(meetingId: string): Promise<AutoHeadlineOutcome> {
  try {
    return (await ensureAutoHeadline(createAdminClient(), meetingId)).outcome;
  } catch (error) {
    console.error("[l10-auto-headline]", error);
    return "error";
  }
}

function autoLocked() {
  return dbError({ code: "42501", message: L10_AUTO_HEADLINE_LOCKED });
}

/** Auto headlines are not the user's to change. */
async function refuseAutoHeadline(ctx: L10TeamContext, kind: L10ItemKind, itemId: string) {
  if (kind !== "headlines") return null;
  const row = await ctx.supabase.from(L10_TABLES.headlines).select("id, is_auto").eq("id", itemId).eq("team_id", ctx.team.id).maybeSingle();
  if (row.error) return dbError(row.error);
  if (row.data?.is_auto) return autoLocked();
  return null;
}

// ── Teams ──────────────────────────────────────────────────

export async function listTeams(slug: string) {
  const opened = await openL10Department(slug);
  if (!isOpened(opened)) return opened.response;
  const teams = await opened.supabase
    .from(L10_TABLES.teams)
    .select(L10_COLUMNS.teams)
    .eq("department_id", opened.department.id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (teams.error) return dbError(teams.error);
  const rows = (teams.data ?? []) as { id: string }[];
  const mine = rows.length
    ? await opened.supabase
        .from(L10_TABLES.members)
        .select("team_id, role")
        .eq("profile_id", opened.userId)
        .in(
          "team_id",
          rows.map((t) => t.id)
        )
    : { data: [], error: null };
  if (mine.error) return dbError(mine.error);
  const roleOf = new Map(((mine.data ?? []) as { team_id: string; role: string }[]).map((m) => [m.team_id, m.role]));
  return NextResponse.json({
    department: { id: opened.department.id, slug: opened.department.slug },
    teams: rows.map((t) => ({ ...t, my_role: roleOf.get(t.id) ?? null })),
  });
}

export async function getTeam(slug: string, teamId: string) {
  const ctx: Opened = await openL10Team(slug, teamId);
  if (!isTeamContext(ctx)) return ctx.response;
  const s = ctx.supabase;
  const empty = new URLSearchParams();
  const [members, rocks, measurables, values, todos, issues, running, recent] = await Promise.all([
    s.from(L10_TABLES.members).select(L10_COLUMNS.members).eq("team_id", teamId),
    listItems(s, teamId, "rocks", empty),
    listItems(s, teamId, "measurables", empty),
    listItems(s, teamId, "measurable_values", empty),
    listItems(s, teamId, "todos", empty),
    listItems(s, teamId, "issues", empty),
    s.from(L10_TABLES.meetings).select(L10_COLUMNS.meetings).eq("team_id", teamId).is("ended_at", null).order("started_at", { ascending: false }).limit(1),
    s
      .from(L10_TABLES.meetings)
      .select(L10_COLUMNS.meetings)
      .eq("team_id", teamId)
      .not("ended_at", "is", null)
      .order("ended_at", { ascending: false })
      .limit(5),
  ]);
  for (const r of [members, rocks, measurables, values, todos, issues, running, recent]) if (r.error) return dbError(r.error);

  const memberRows = (members.data ?? []) as { profile_id: string }[];
  const names = memberRows.length
    ? await s.from("users").select("id, first_name, last_name, preferred_name").in(
        "id",
        memberRows.map((m) => m.profile_id)
      )
    : { data: [], error: null };
  // users RLS may hide some names from a member; the ids are still there.
  const nameOf = new Map(((names.error ? [] : names.data) ?? []).map((u: Row) => [u.id as string, u]));

  const runningMeeting = ((running.data ?? []) as MeetingRow[])[0] ?? null;
  let runningDetail: unknown = null;
  if (runningMeeting) {
    await ensureAuto(runningMeeting.id);
    const loaded = await loadMeeting(s, teamId, runningMeeting.id);
    if (!loaded.ok) return meetingError(loaded);
    const headlines = await listItems(s, teamId, "headlines", new URLSearchParams({ meeting_id: runningMeeting.id }));
    if (headlines.error) return dbError(headlines.error);
    runningDetail = { meeting: withCurrentSegment(loaded.value.meeting), attendees: loaded.value.attendees, headlines: headlines.data };
  }

  return NextResponse.json({
    team: ctx.team,
    my_role: ctx.role,
    access: ctx.access,
    quarter: currentQuarter(),
    members: memberRows.map((m) => ({ ...m, user: nameOf.get(m.profile_id) ?? null })),
    rocks: rocks.data,
    measurables: measurables.data,
    measurable_values: values.data,
    todos: todos.data,
    issues: issues.data,
    running_meeting: runningDetail,
    recent_meetings: ((recent.data ?? []) as MeetingRow[]).map(withCurrentSegment),
  });
}

// ── Items ──────────────────────────────────────────────────

function kindOr404(kind: string): L10ItemKind | null {
  return isItemKind(kind) ? kind : null;
}

export async function listTeamItems(request: Request, slug: string, teamId: string, kindParam: string) {
  const kind = kindOr404(kindParam);
  if (!kind) return notFound("Not found");
  const ctx = await openL10Team(slug, teamId);
  if (!isTeamContext(ctx)) return ctx.response;
  const params = new URL(request.url).searchParams;
  if (params.get("owner") && !isUuid(params.get("owner"))) return badRequest("owner must be a uuid");
  if (params.get("meeting_id") && !isUuid(params.get("meeting_id"))) return badRequest("meeting_id must be a uuid");
  const status = params.get("status");
  if (status && !["all", "open", "done", "solved"].includes(status)) return badRequest("Unknown status");
  for (const key of ["from"]) {
    const v = params.get(key);
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return badRequest(`${key} must be a YYYY-MM-DD date`);
  }
  if (params.get("measurable_id") && !isUuid(params.get("measurable_id"))) return badRequest("measurable_id must be a uuid");
  const quarter = params.get("quarter");
  if (quarter && !/^\d{4}-Q[1-4]$/.test(quarter)) return badRequest("quarter must look like 2026-Q4");
  const rows = await listItems(ctx.supabase, teamId, kind, params);
  if (rows.error) return dbError(rows.error);
  return NextResponse.json({ [kind]: rows.data, access: ctx.access });
}

async function checkLinks(ctx: L10TeamContext, kind: L10ItemKind, values: Row) {
  const person = PERSON_COLUMN[kind];
  if (person && values[person]) {
    const members = await teamMemberIds(ctx.supabase, ctx.team.id);
    if (members.error) return dbError(members.error);
    if (!members.data.has(values[person] as string)) return badRequest(`${person} must be a member of this team`);
  }
  for (const col of MEETING_COLUMNS) {
    if (!values[col]) continue;
    const ok = await isTeamMeeting(ctx.supabase, ctx.team.id, values[col] as string);
    if (ok.error) return dbError(ok.error);
    if (!ok.data) return badRequest(`${col} must be a meeting of this team`);
  }
  if (kind === "issues" && values.resolved_meeting_id && values.status !== "solved") {
    return badRequest("resolved_meeting_id is only for a solved issue");
  }
  return null;
}

/** Solving an issue during a meeting records that meeting. */
async function runningIfSolving(ctx: L10TeamContext, kind: L10ItemKind, values: Row) {
  if (kind !== "issues" || values.status !== "solved" || "resolved_meeting_id" in values) return { data: null, error: null };
  return runningMeetingId(ctx.supabase, ctx.team.id);
}

export async function createTeamItem(request: Request, slug: string, teamId: string, kindParam: string) {
  const kind = kindOr404(kindParam);
  if (!kind) return notFound("Not found");
  const ctx = await openL10Team(slug, teamId);
  if (!isTeamContext(ctx)) return ctx.response;
  if (!ctx.access.canEdit) return notAuthorized();
  const body = await readJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseItemCreate(kind, body.value, { quarter: currentQuarter() });
  if (!parsed.ok) return parseError(parsed);
  const refused = await checkLinks(ctx, kind, parsed.value);
  if (refused) return refused;
  const running = await runningIfSolving(ctx, kind, parsed.value);
  if (running.error) return dbError(running.error);
  const created = await createItem(ctx.supabase, ctx.team, kind, parsed.value, ctx.userId, { runningMeetingId: running.data });
  if (created.error) return dbError(created.error);
  await audit(ctx, `l10_${SINGULAR[kind]}.create`, `l10_${SINGULAR[kind]}`, String(created.data.id), { after: parsed.value });
  return NextResponse.json({ success: true, [SINGULAR[kind]]: created.data });
}

export async function updateTeamItem(request: Request, slug: string, teamId: string, kindParam: string, itemId: string) {
  const kind = kindOr404(kindParam);
  if (!kind || !isUuid(itemId)) return notFound("Not found");
  const ctx = await openL10Team(slug, teamId);
  if (!isTeamContext(ctx)) return ctx.response;
  if (!ctx.access.canEdit) return notAuthorized();
  const body = await readJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseItemPatch(kind, body.value);
  if (!parsed.ok) return parseError(parsed);
  const locked = await refuseAutoHeadline(ctx, kind, itemId);
  if (locked) return locked;
  const refused = await checkLinks(ctx, kind, parsed.value);
  if (refused) return refused;
  const running = await runningIfSolving(ctx, kind, parsed.value);
  if (running.error) return dbError(running.error);
  const updated = await updateItem(ctx.supabase, teamId, kind, itemId, parsed.value, { runningMeetingId: running.data });
  if (updated.error) return dbError(updated.error);
  if (!updated.data) return notFound(`${SINGULAR[kind]} not found`);
  await audit(ctx, `l10_${SINGULAR[kind]}.update`, `l10_${SINGULAR[kind]}`, itemId, { after: parsed.value });
  return NextResponse.json({ success: true, [SINGULAR[kind]]: updated.data });
}

export async function deleteTeamItem(slug: string, teamId: string, kindParam: string, itemId: string) {
  const kind = kindOr404(kindParam);
  if (!kind || !isUuid(itemId)) return notFound("Not found");
  const ctx = await openL10Team(slug, teamId);
  if (!isTeamContext(ctx)) return ctx.response;
  if (!(DELETE_NEEDS_MANAGE[kind] ? ctx.access.canManage : ctx.access.canEdit)) return notAuthorized();
  const locked = await refuseAutoHeadline(ctx, kind, itemId);
  if (locked) return locked;
  const deleted = await deleteItem(ctx.supabase, teamId, kind, itemId);
  if (deleted.error) return dbError(deleted.error);
  if (!deleted.data) return notFound(`${SINGULAR[kind]} not found`);
  await audit(ctx, `l10_${SINGULAR[kind]}.delete`, `l10_${SINGULAR[kind]}`, itemId);
  return NextResponse.json({ success: true });
}

// ── Meetings ───────────────────────────────────────────────

export async function listMeetings(slug: string, teamId: string) {
  const ctx = await openL10Team(slug, teamId);
  if (!isTeamContext(ctx)) return ctx.response;
  const rows = await ctx.supabase
    .from(L10_TABLES.meetings)
    .select(L10_COLUMNS.meetings)
    .eq("team_id", teamId)
    .order("started_at", { ascending: false })
    .limit(20);
  if (rows.error) return dbError(rows.error);
  return NextResponse.json({ meetings: ((rows.data ?? []) as MeetingRow[]).map(withCurrentSegment) });
}

export async function getMeeting(slug: string, teamId: string, meetingId: string) {
  if (!isUuid(meetingId)) return notFound("Meeting not found");
  const ctx = await openL10Team(slug, teamId);
  if (!isTeamContext(ctx)) return ctx.response;
  const first = await loadMeeting(ctx.supabase, teamId, meetingId);
  if (!first.ok) return meetingError(first);
  const auto = first.value.meeting.ended_at ? null : await ensureAuto(meetingId);
  const headlines = await listItems(ctx.supabase, teamId, "headlines", new URLSearchParams({ meeting_id: meetingId }));
  if (headlines.error) return dbError(headlines.error);
  const loaded = first;
  return NextResponse.json({
    auto_headline: auto,
    headlines: headlines.data,
    meeting: withCurrentSegment(loaded.value.meeting),
    attendees: loaded.value.attendees,
    average_rating: averageRating(loaded.value.attendees),
  });
}

export async function startTeamMeeting(request: Request, slug: string, teamId: string) {
  const ctx = await openL10Team(slug, teamId);
  if (!isTeamContext(ctx)) return ctx.response;
  if (!ctx.access.canEdit) return notAuthorized();
  const body = await optionalJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseMeetingStart(body.value);
  if (!parsed.ok) return badRequest(parsed.error);
  const started = await startMeeting(ctx.supabase, ctx.team, ctx.userId, parsed.value);
  if (!started.ok) return meetingError(started);
  await audit(ctx, "l10_meeting.start", "l10_meeting", started.value.meeting.id);
  const auto = await ensureAuto(started.value.meeting.id);
  return NextResponse.json({
    success: true,
    meeting: withCurrentSegment(started.value.meeting),
    attendees: started.value.attendees,
    auto_headline: auto,
  });
}

async function optionalJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await request.text();
  if (!text.trim()) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export async function advanceTeamMeeting(request: Request, slug: string, teamId: string, meetingId: string) {
  if (!isUuid(meetingId)) return notFound("Meeting not found");
  const ctx = await openL10Team(slug, teamId);
  if (!isTeamContext(ctx)) return ctx.response;
  if (!ctx.access.canEdit) return notAuthorized();
  const body = await optionalJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseSegmentAdvance(body.value);
  if (!parsed.ok) return badRequest(parsed.error);
  const moved = await advanceSegment(ctx.supabase, teamId, meetingId, parsed.value);
  if (!moved.ok) return meetingError(moved);
  const auto = await ensureAuto(meetingId);
  return NextResponse.json({ success: true, meeting: withCurrentSegment(moved.value.meeting), auto_headline: auto });
}

export type EndDeps = { slack?: Parameters<typeof runL10MeetingEnded>[2] };

export async function endTeamMeeting(request: Request, slug: string, teamId: string, meetingId: string, deps: EndDeps = {}) {
  if (!isUuid(meetingId)) return notFound("Meeting not found");
  const ctx = await openL10Team(slug, teamId);
  if (!isTeamContext(ctx)) return ctx.response;
  if (!ctx.access.canEdit) return notAuthorized();
  const body = await optionalJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseMeetingEnd(body.value);
  if (!parsed.ok) return badRequest(parsed.error);
  const ended = await endMeeting(ctx.supabase, teamId, meetingId, ctx.userId, parsed.value, { canManage: ctx.access.canManage });
  if (!ended.ok) return meetingError(ended);
  if (!ended.value.already_ended) {
    await audit(ctx, "l10_meeting.end", "l10_meeting", meetingId, { ratings: parsed.value.ratings });
  }

  // Run on every end call, also a repeat: the claims make that safe, and it
  // lets a retry reach anyone a failed DM or recap missed.
  const slack = await runL10MeetingEnded(createAdminClient(), meetingId, deps.slack);
  return NextResponse.json({
    success: true,
    ...ended.value,
    meeting: withCurrentSegment(ended.value.meeting),
    followup: slack.followup,
    recap: slack.recap,
  });
}


/**
 * POST /l10/teams/:teamId/headlines/:itemId/dismiss — hide a headline from
 * the meeting (auto or not). Anyone with access to the team. Sets
 * dismissed_at once; a repeat returns the same row.
 */
/** Hide (dismiss) or show again (restore) a headline. 416 lets any team member change dismissed_at, also on auto rows. */
export async function dismissTeamHeadline(slug: string, teamId: string, kindParam: string, itemId: string, restore = false) {
  if (kindParam !== "headlines" || !isUuid(itemId)) return notFound("Not found");
  const ctx = await openL10Team(slug, teamId);
  if (!isTeamContext(ctx)) return ctx.response;
  if (!ctx.access.canEdit) return notAuthorized();
  const base = ctx.supabase
    .from(L10_TABLES.headlines)
    .update({ dismissed_at: restore ? null : new Date().toISOString() })
    .eq("id", itemId)
    .eq("team_id", teamId);
  const set = await (restore ? base.not("dismissed_at", "is", null) : base.is("dismissed_at", null)).select(L10_COLUMNS.headlines);
  if (set.error) return dbError(set.error);
  let row = ((set.data ?? []) as Row[])[0] ?? null;
  if (!row) {
    const found = await ctx.supabase.from(L10_TABLES.headlines).select(L10_COLUMNS.headlines).eq("id", itemId).eq("team_id", teamId).maybeSingle();
    if (found.error) return dbError(found.error);
    if (!found.data) return notFound("headline not found");
    row = found.data as Row;
  } else {
    await audit(ctx, restore ? "l10_headline.restore" : "l10_headline.dismiss", "l10_headline", itemId);
  }
  return NextResponse.json({ success: true, headline: row });
}
