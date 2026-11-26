// The People Manager (leave) API, one function per route. Route files only
// unwrap params and call these. Any department: everything is keyed on the
// department from the URL (staff_ministries.id), nothing is named.
//
//   GET    /people-manager                         me, types, my usage this year, who my requests go to
//   POST   /people-manager/preview                 live count for the form (no write)
//   GET    /people-manager/requests                ?scope=mine|department|pending &year= &person= &status=
//   POST   /people-manager/requests                ask for leave; DMs the approvers
//   GET    /people-manager/requests/:id            one request, with usage and who else is away
//   POST   /people-manager/requests/:id/decision   { decision: approved|declined, note? }; first decision wins
//   POST   /people-manager/requests/:id/cancel     the requester, while pending or before an approved first day
//   POST   /people-manager/requests/:id/notify     retry the approval DMs anyone missed (safe to repeat)
//   GET    /people-manager/usage                   ?year= &person=  used / pending per type vs guideline
//   GET    /people-manager/away                    ?from= &to=  who is away (dates and status only), per-weekday headcount, holidays
//   GET    /people-manager/blockouts               ?person= &from= &to=
//   POST   /people-manager/blockouts               { start_date, end_date, reason? }
//   PATCH  /people-manager/blockouts/:id           same fields
//   DELETE /people-manager/blockouts/:id
//
// Reads and writes use the caller's session, so 421's RLS and guard apply.
// The service role is used only for Slack (lib/slack/leave-approval) and
// for display names of people the caller can already see.
//
// Errors: 401 signed out, 403 not allowed, 404 no such department or
// request (or not visible), 400 bad body, 409 already decided / locked.
// 421's named errors come back as { error, code } (lib/people-manager/http).

import "server-only";

import { NextResponse } from "next/server";
import { createAuditLog } from "@/services/audit";
import { isOpened, openDepartment, type OpenedDepartment } from "@/lib/departments/internal/open";
import { readJson } from "@/lib/departments/http";
import { rpcFlag } from "@/lib/departments/rpc";
import { isUuid } from "@/lib/departments/validate";
import { createAdminClient } from "@/lib/supabase/admin";
import { routeApprovers } from "@/lib/people-manager/access";
import { addDays, countLeaveDays, daysBetween, isIsoDate, saHolidayName, weekdayOf, type DeclaredHoliday } from "@/lib/people-manager/days";
import type { LeaveAwayRow, LeaveEffectiveType, LeaveRequest } from "@/lib/people-manager/db.types";
import { decideLeaveRequest } from "@/lib/people-manager/decide";
import { badRequest, coded, dbError, notAuthorized, notFound } from "@/lib/people-manager/http";
import {
  LEAVE_ALREADY_DECIDED,
  LEAVE_BLOCKOUT_COLUMNS,
  LEAVE_REQUEST_COLUMNS,
  LEAVE_TABLES,
  PERSON_COLUMNS,
} from "@/lib/people-manager/types";
import { guidelineLine, projectRequest, usageByType, type TypeUsage } from "@/lib/people-manager/usage";
import { parseBlockout, parseDecision, parseLeaveRequest, parseYear } from "@/lib/people-manager/validate";
import { personName, runLeaveApprovalRequests, runLeaveCancelled, runLeaveDecided, safely, type LeaveNotice, type LeaveSlackDeps } from "@/lib/slack/leave-approval";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;
type Row = Record<string, unknown>;

/** Slack and clock seams for the tests. */
export type PmDeps = { slack?: LeaveSlackDeps; env?: NodeJS.ProcessEnv; today?: string };

type Ctx = OpenedDepartment & { isLeader: boolean; isAdmin: boolean; isMember: boolean };

const todaySA = (deps: PmDeps) => deps.today ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());

async function open(slug: string): Promise<{ response: NextResponse } | Ctx> {
  const opened = await openDepartment(slug, "any");
  if (!isOpened(opened)) return opened;
  const [leader, admin, member] = await Promise.all([
    rpcFlag(opened.supabase, "dept_is_ministry_leader", { p_ministry_id: opened.department.id }),
    rpcFlag(opened.supabase, "leave_caller_is_admin"),
    rpcFlag(opened.supabase, "dept_is_ministry_member", { p_ministry_id: opened.department.id }),
  ]);
  if (!leader.ok || !admin.ok || !member.ok) return { response: notAuthorized() };
  return { ...opened, isLeader: leader.value, isAdmin: admin.value, isMember: member.value };
}
const isCtx = (r: { response: NextResponse } | Ctx): r is Ctx => !("response" in r);
const seesDepartment = (ctx: Ctx) => ctx.isLeader || ctx.isAdmin;

async function audit(ctx: Ctx, action: string, resourceId: string, changes?: Record<string, unknown>) {
  await createAuditLog(ctx.supabase, { action, resource_type: "leave_request", resource_id: resourceId, changes: changes ?? null }).catch(
    (error: unknown) => console.error(error)
  );
}

// ── shared reads ───────────────────────────────────────────

async function effectiveTypes(ctx: Ctx): Promise<{ data: LeaveEffectiveType[]; error: unknown }> {
  const r = await ctx.supabase.rpc("leave_effective_types", { p_department_id: ctx.department.id });
  if (r.error) return { data: [], error: r.error };
  const rows = ((r.data ?? []) as LeaveEffectiveType[]).map((t) => ({
    ...t,
    annual_allowance_days: t.annual_allowance_days === null ? null : Number(t.annual_allowance_days),
  }));
  rows.sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
  return { data: rows, error: null };
}

/** id -> slug for every type id the requests use (base defaults and overrides share a slug). */
async function slugMap(ctx: Ctx, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const r = await ctx.supabase.from(LEAVE_TABLES.types).select("id, slug, label").in("id", unique);
  return new Map(((r.data ?? []) as { id: string; slug: string }[]).map((t) => [t.id, t.slug]));
}

async function names(admin: Client, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  if (!unique.length) return new Map();
  const r = await admin.from("users").select(PERSON_COLUMNS).in("id", unique);
  return new Map(((r.data ?? []) as Row[]).map((p) => [String(p.id), personName(p as never)]));
}

async function declaredHolidays(ctx: Ctx, from: string, to: string): Promise<DeclaredHoliday[]> {
  const r = await ctx.supabase.from(LEAVE_TABLES.declaredHolidays).select("day, name").gte("day", from).lte("day", to);
  return ((r.data ?? []) as DeclaredHoliday[]).map((h) => ({ day: h.day, name: h.name }));
}

async function departmentMembers(ctx: Ctx): Promise<{ user_id: string; member_role: string }[]> {
  const r = await ctx.admin
    .from("staff_ministry_members")
    .select("user_id, member_role")
    .eq("staff_ministry_id", ctx.department.id)
    .eq("status", "active");
  return (r.data ?? []) as { user_id: string; member_role: string }[];
}

/** "Goes to" for the caller's own request: the other leaders, or an admin when they are the sole leader. */
async function goesTo(ctx: Ctx): Promise<{ via: "leader" | "admin"; people: { user_id: string; name: string }[] }> {
  const members = await departmentMembers(ctx);
  const leaders = members.filter((m) => m.member_role === "leader").map((m) => m.user_id);
  const routed = routeApprovers({ requesterId: ctx.userId, leaderIds: leaders, adminIds: [] });
  if (!routed.length) return { via: "admin", people: [] };
  const n = await names(ctx.admin, routed.map((a) => a.user_id));
  return { via: "leader", people: routed.map((a) => ({ user_id: a.user_id, name: n.get(a.user_id) ?? "Someone" })) };
}

function publicNotices(list: unknown, n: Map<string, string>) {
  return (Array.isArray(list) ? (list as LeaveNotice[]) : [])
    .filter((x) => x.kind === "approval" && x.recipient_id)
    .map((x) => ({ user_id: x.recipient_id!, name: n.get(x.recipient_id!) ?? null, ok: x.state === "sent", error: x.state === "failed" ? (x.error ?? "failed") : null }));
}

function shapeRequest(ctx: Ctx, r: LeaveRequest, types: Map<string, { slug: string; label: string }>, n: Map<string, string>, today: string) {
  const { slack_notify, ...rest } = r;
  const mine = r.requester_id === ctx.userId;
  return {
    ...rest,
    days_count: Number(r.days_count),
    type: { id: r.leave_type_id, ...(types.get(r.leave_type_id) ?? { slug: null, label: null }) },
    requester: { id: r.requester_id, name: n.get(r.requester_id) ?? null },
    covering: r.covering_user_id ? { id: r.covering_user_id, name: n.get(r.covering_user_id) ?? null } : null,
    decided_by_person: r.decided_by ? { id: r.decided_by, name: n.get(r.decided_by) ?? null } : null,
    sent_to: publicNotices(slack_notify, n),
    can_cancel: mine && (r.status === "pending" || (r.status === "approved" && r.start_date > today)),
    can_decide: r.status === "pending" && !mine && (ctx.isLeader || ctx.isAdmin),
  };
}

async function shapeRequests(ctx: Ctx, rows: LeaveRequest[], today: string) {
  const typeIds = [...new Set(rows.map((r) => r.leave_type_id))];
  const t = typeIds.length ? await ctx.supabase.from(LEAVE_TABLES.types).select("id, slug, label").in("id", typeIds) : { data: [] };
  const types = new Map(((t.data ?? []) as { id: string; slug: string; label: string }[]).map((x) => [x.id, { slug: x.slug, label: x.label }]));
  const notified = rows.flatMap((r) => publicNotices(r.slack_notify, new Map()).map((x) => x.user_id));
  const n = await names(ctx.admin, [...rows.flatMap((r) => [r.requester_id, r.covering_user_id, r.decided_by]), ...notified]);
  return rows.map((r) => shapeRequest(ctx, r, types, n, today));
}

/** One person's usage this year in this department (RLS decides which requests are visible). */
async function personUsage(ctx: Ctx, types: LeaveEffectiveType[], personId: string, year: number): Promise<TypeUsage[]> {
  const r = await ctx.supabase
    .from(LEAVE_TABLES.requests)
    .select("id, requester_id, leave_type_id, status, days_by_year")
    .eq("department_id", ctx.department.id)
    .eq("requester_id", personId)
    .in("status", ["approved", "pending"])
    .lte("start_date", `${year}-12-31`)
    .gte("end_date", `${year}-01-01`);
  const rows = (r.data ?? []) as LeaveRequest[];
  return usageByType({ types, requests: rows, year, typeSlugById: await slugMap(ctx, rows.map((x) => x.leave_type_id)) });
}

// ── GET /people-manager ────────────────────────────────────

export async function getOverview(request: Request, slug: string, deps: PmDeps = {}) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const today = todaySA(deps);
  const year = parseYear(new URL(request.url).searchParams.get("year"), Number(today.slice(0, 4)));
  if (year === null) return badRequest("year must be a year");
  const types = await effectiveTypes(ctx);
  if (types.error) return dbError(types.error as never);
  const [usage, to] = await Promise.all([personUsage(ctx, types.data, ctx.userId, year), goesTo(ctx)]);
  let pendingToDecide = 0;
  if (seesDepartment(ctx)) {
    const p = await ctx.supabase.from(LEAVE_TABLES.requests).select("id, requester_id").eq("department_id", ctx.department.id).eq("status", "pending");
    pendingToDecide = ((p.data ?? []) as Row[]).filter((x) => x.requester_id !== ctx.userId).length;
  }
  return NextResponse.json({
    department: { id: ctx.department.id, slug: ctx.department.slug, name: ctx.department.name },
    me: { user_id: ctx.userId, is_member: ctx.isMember, is_leader: ctx.isLeader, is_admin: ctx.isAdmin, can_request: ctx.isMember, can_see_department: seesDepartment(ctx) },
    year,
    today,
    types: types.data.filter((t) => t.is_active),
    usage,
    goes_to: to,
    pending_to_decide: pendingToDecide,
  });
}

// ── POST /people-manager/preview ───────────────────────────

export async function previewRequest(request: Request, slug: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const body = await readJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseLeaveRequest(body.value, { requireType: false });
  if (!parsed.ok) return badRequest(parsed.error);
  const v = parsed.value;
  const count = countLeaveDays({
    start: v.start_date,
    end: v.end_date,
    startPart: v.start_part,
    endPart: v.end_part,
    declared: await declaredHolidays(ctx, v.start_date, v.end_date),
  });

  let usage: (ReturnType<typeof projectRequest> & { year: number; line: string })[] = [];
  if (v.leave_type_id) {
    const types = await effectiveTypes(ctx);
    if (types.error) return dbError(types.error as never);
    const type = types.data.find((t) => t.id === v.leave_type_id && t.is_active);
    if (!type) return coded(400, "That leave type is not available in this department", "leave_request_type_not_available");
    usage = await Promise.all(
      Object.entries(count.by_year).map(async ([y, days]) => {
        const year = Number(y);
        const u = (await personUsage(ctx, types.data, ctx.userId, year)).find((x) => x.slug === type.slug);
        const base: TypeUsage = u ?? { leave_type_id: type.id, slug: type.slug, label: type.label, guideline: type.annual_allowance_days, used: 0, pending: 0, remaining: null, over: null };
        const proj = projectRequest(base, days);
        return { year, ...proj, line: guidelineLine(type.label, proj.total, proj.guideline) };
      })
    );
  }

  const away = await awayRows(ctx, v.start_date, v.end_date);
  const others = away.rows.filter((a) => a.user_id !== ctx.userId);
  const coverAway = v.covering_user_id ? away.rows.filter((a) => a.user_id === v.covering_user_id) : [];
  return NextResponse.json({
    ...count,
    no_working_days: count.days === 0,
    usage,
    also_away: others,
    cover_conflicts: coverAway,
    goes_to: await goesTo(ctx),
  });
}

// ── /people-manager/requests ───────────────────────────────

export async function listRequests(request: Request, slug: string, deps: PmDeps = {}) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const q = new URL(request.url).searchParams;
  const scope = q.get("scope") ?? "mine";
  if (!["mine", "department", "pending"].includes(scope)) return badRequest("scope must be mine, department or pending");
  if (scope !== "mine" && !seesDepartment(ctx)) return notAuthorized();
  const today = todaySA(deps);
  const yearRaw = q.get("year");
  const year = yearRaw ? parseYear(yearRaw, 0) : null;
  if (yearRaw && year === null) return badRequest("year must be a year");
  const person = q.get("person");
  if (person && !isUuid(person)) return badRequest("person must be an id");
  if (person && person !== ctx.userId && !seesDepartment(ctx)) return notAuthorized();
  const status = q.get("status");
  if (status && !["pending", "approved", "declined", "cancelled"].includes(status)) return badRequest("status is not a request status");

  let query = ctx.supabase.from(LEAVE_TABLES.requests).select(LEAVE_REQUEST_COLUMNS).eq("department_id", ctx.department.id);
  if (scope === "mine") query = query.eq("requester_id", ctx.userId);
  else if (person) query = query.eq("requester_id", person);
  if (scope === "pending") query = query.eq("status", "pending");
  else if (status) query = query.eq("status", status);
  if (year) query = query.lte("start_date", `${year}-12-31`).gte("end_date", `${year}-01-01`);
  const r = await query.order(scope === "pending" ? "created_at" : "start_date", { ascending: scope === "pending" }).limit(500);
  if (r.error) return dbError(r.error);
  let rows = (r.data ?? []) as LeaveRequest[];
  if (scope === "pending") rows = rows.filter((x) => x.requester_id !== ctx.userId);
  return NextResponse.json({ scope, year, requests: await shapeRequests(ctx, rows, today) });
}

export async function createRequest(request: Request, slug: string, deps: PmDeps = {}) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  if (!ctx.isMember) return coded(403, "Only active members of this department can request leave here", "leave_request_not_member");
  const body = await readJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseLeaveRequest(body.value);
  if (!parsed.ok) return badRequest(parsed.error);
  const v = parsed.value;
  if (v.covering_user_id === ctx.userId) return badRequest("You can't cover your own leave");

  const types = await effectiveTypes(ctx);
  if (types.error) return dbError(types.error as never);
  if (!types.data.some((t) => t.id === v.leave_type_id && t.is_active)) {
    return coded(400, "That leave type is not available in this department", "leave_request_type_not_available");
  }
  const count = countLeaveDays({
    start: v.start_date,
    end: v.end_date,
    startPart: v.start_part,
    endPart: v.end_part,
    declared: await declaredHolidays(ctx, v.start_date, v.end_date),
  });
  if (count.days === 0) {
    return coded(400, "Those dates have no working days (weekends and public holidays don't count)", "leave_request_no_working_days");
  }

  const inserted = await ctx.supabase
    .from(LEAVE_TABLES.requests)
    .insert({
      department_id: ctx.department.id,
      requester_id: ctx.userId,
      leave_type_id: v.leave_type_id,
      start_date: v.start_date,
      end_date: v.end_date,
      start_part: v.start_part,
      end_part: v.end_part,
      notes: v.notes,
      covering_user_id: v.covering_user_id,
      covering_note: v.covering_note,
      // days_count / days_by_year are computed by 421's guard on insert.
    })
    .select(LEAVE_REQUEST_COLUMNS)
    .single();
  if (inserted.error) return dbError(inserted.error);
  const row = inserted.data as LeaveRequest;
  await audit(ctx, "leave_request.create", row.id, { after: v });

  const slack = await safely(`approval ${row.id}`, () => runLeaveApprovalRequests(createAdminClient(), row.id, { deps: deps.slack, env: deps.env }));
  const [shaped] = await shapeRequests(ctx, [await reread(ctx, row)], todaySA(deps));
  return NextResponse.json({ success: true, request: shaped, slack }, { status: 201 });
}

/** The row again after Slack wrote its delivery log (sent_to), or the one we had. */
async function reread(ctx: Ctx, row: LeaveRequest): Promise<LeaveRequest> {
  const r = await ctx.supabase.from(LEAVE_TABLES.requests).select(LEAVE_REQUEST_COLUMNS).eq("id", row.id).maybeSingle();
  return (r.data as LeaveRequest | null) ?? row;
}

async function loadVisible(ctx: Ctx, requestId: string): Promise<{ row: LeaveRequest } | { response: NextResponse }> {
  if (!isUuid(requestId)) return { response: notFound("Request not found") };
  const r = await ctx.supabase.from(LEAVE_TABLES.requests).select(LEAVE_REQUEST_COLUMNS).eq("id", requestId).eq("department_id", ctx.department.id).maybeSingle();
  if (r.error) return { response: dbError(r.error) };
  if (!r.data) return { response: notFound("Request not found") };
  return { row: r.data as LeaveRequest };
}

export async function getRequest(_request: Request, slug: string, requestId: string, deps: PmDeps = {}) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const found = await loadVisible(ctx, requestId);
  if ("response" in found) return found.response;
  const row = found.row;
  const types = await effectiveTypes(ctx);
  if (types.error) return dbError(types.error as never);
  const slugs = await slugMap(ctx, [row.leave_type_id]);
  const typeSlug = slugs.get(row.leave_type_id);
  const usage = await Promise.all(
    Object.keys(row.days_by_year ?? {}).map(async (y) => ({
      year: Number(y),
      type: (await personUsage(ctx, types.data, row.requester_id, Number(y))).find((u) => u.slug === typeSlug) ?? null,
    }))
  );
  const away = seesDepartment(ctx) || row.requester_id === ctx.userId ? await awayRows(ctx, row.start_date, row.end_date) : { rows: [] };
  const [shaped] = await shapeRequests(ctx, [row], todaySA(deps));
  return NextResponse.json({ request: shaped, usage, also_away: away.rows.filter((a) => a.user_id !== row.requester_id) });
}

export async function decideRequest(request: Request, slug: string, requestId: string, deps: PmDeps = {}) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const found = await loadVisible(ctx, requestId);
  if ("response" in found) return found.response;
  if (found.row.requester_id === ctx.userId) return coded(403, "Nobody decides their own leave", "leave_request_self_decision");
  if (!seesDepartment(ctx)) return coded(403, "Only another leader of this department, or an admin, can decide", "leave_request_not_approver");
  const body = await readJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseDecision(body.value);
  if (!parsed.ok) {
    return parsed.error === "Say why when declining" ? coded(400, parsed.error, "leave_request_decline_note_required") : badRequest(parsed.error);
  }
  const out = await decideLeaveRequest(ctx.supabase, { requestId, deciderId: ctx.userId, decision: parsed.value.decision, note: parsed.value.note });
  const today = todaySA(deps);
  if (out.outcome === "not-found") return notFound("Request not found");
  if (out.outcome === "error") return dbError(out.error);
  if (out.outcome === "already-decided") {
    const [shaped] = await shapeRequests(ctx, [out.request], today);
    const by = out.request.status === "cancelled" ? shaped.requester.name : shaped.decided_by_person?.name;
    return coded(409, `Already ${out.request.status === "declined" ? "denied" : out.request.status}${by ? ` by ${by}` : ""}`, LEAVE_ALREADY_DECIDED, { request: shaped });
  }
  await audit(ctx, `leave_request.${parsed.value.decision}`, requestId, { note: parsed.value.note });
  const slack = await safely(`decided ${requestId}`, () => runLeaveDecided(createAdminClient(), requestId, { deps: deps.slack, env: deps.env }));
  const [shaped] = await shapeRequests(ctx, [await reread(ctx, out.request)], today);
  return NextResponse.json({ success: true, request: shaped, slack });
}

export async function cancelRequest(_request: Request, slug: string, requestId: string, deps: PmDeps = {}) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const found = await loadVisible(ctx, requestId);
  if ("response" in found) return found.response;
  const row = found.row;
  const today = todaySA(deps);
  if (row.requester_id !== ctx.userId) return coded(403, "Only the person who asked can cancel", "leave_request_cancel_not_allowed");
  if (row.status === "cancelled") {
    const [shaped] = await shapeRequests(ctx, [row], today);
    return NextResponse.json({ success: true, request: shaped, already_cancelled: true });
  }
  if (row.status === "declined" || (row.status === "approved" && row.start_date <= today)) {
    return coded(409, row.status === "declined" ? "A declined request is final" : "Approved leave can be cancelled only before its first day", "leave_request_locked");
  }
  const stamp = new Date().toISOString();
  const r = await ctx.supabase
    .from(LEAVE_TABLES.requests)
    .update({ status: "cancelled", cancelled_by: ctx.userId, cancelled_at: stamp, updated_at: stamp })
    .eq("id", requestId)
    .eq("status", row.status) // only from the status we saw: a decision in between wins
    .select(LEAVE_REQUEST_COLUMNS);
  if (r.error) return dbError(r.error);
  const updated = ((r.data ?? []) as LeaveRequest[])[0];
  if (!updated) return coded(409, "This request changed in the meantime. Reload it.", "leave_request_changed");
  await audit(ctx, "leave_request.cancel", requestId);
  const slack = await safely(`cancelled ${requestId}`, () => runLeaveCancelled(createAdminClient(), requestId, { deps: deps.slack, env: deps.env }));
  const [shaped] = await shapeRequests(ctx, [updated], today);
  return NextResponse.json({ success: true, request: shaped, slack });
}

export async function notifyRequest(_request: Request, slug: string, requestId: string, deps: PmDeps = {}) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const found = await loadVisible(ctx, requestId);
  if ("response" in found) return found.response;
  if (found.row.requester_id !== ctx.userId && !seesDepartment(ctx)) return notAuthorized();
  const admin = createAdminClient();
  const opts = { deps: deps.slack, env: deps.env };
  const slack =
    found.row.status === "pending"
      ? await safely(`approval ${requestId}`, () => runLeaveApprovalRequests(admin, requestId, opts))
      : found.row.status === "cancelled"
        ? await safely(`cancelled ${requestId}`, () => runLeaveCancelled(admin, requestId, opts))
        : await safely(`decided ${requestId}`, () => runLeaveDecided(admin, requestId, opts));
  return NextResponse.json({ success: true, slack });
}

// ── GET /people-manager/usage ──────────────────────────────

export async function getUsage(request: Request, slug: string, deps: PmDeps = {}) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const q = new URL(request.url).searchParams;
  const year = parseYear(q.get("year"), Number(todaySA(deps).slice(0, 4)));
  if (year === null) return badRequest("year must be a year");
  const person = q.get("person");
  if (person && !isUuid(person)) return badRequest("person must be an id");
  if (person && person !== ctx.userId && !seesDepartment(ctx)) return notAuthorized();
  const types = await effectiveTypes(ctx);
  if (types.error) return dbError(types.error as never);

  const members = await departmentMembers(ctx);
  const roleOf = new Map(members.map((m) => [m.user_id, m.member_role]));
  const ids = person ? [person] : seesDepartment(ctx) ? [...new Set(members.map((m) => m.user_id))] : [ctx.userId];

  const r = await ctx.supabase
    .from(LEAVE_TABLES.requests)
    .select("id, requester_id, leave_type_id, status, days_by_year, start_date, end_date")
    .eq("department_id", ctx.department.id)
    .in("requester_id", ids)
    .in("status", ["approved", "pending"])
    .lte("start_date", `${year}-12-31`)
    .gte("end_date", `${year}-01-01`);
  if (r.error) return dbError(r.error);
  const rows = (r.data ?? []) as (LeaveRequest & { requester_id: string })[];
  const slugs = await slugMap(ctx, rows.map((x) => x.leave_type_id));
  const n = await names(ctx.admin, ids);
  const people = ids.map((id) => ({
    user_id: id,
    name: n.get(id) ?? null,
    role: roleOf.get(id) ?? null,
    usage: usageByType({ types: types.data, requests: rows.filter((x) => x.requester_id === id), year, typeSlugById: slugs }),
  }));
  people.sort((a, b) => (a.role === b.role ? (a.name ?? "").localeCompare(b.name ?? "") : a.role === "leader" ? -1 : 1));
  return NextResponse.json({ year, types: types.data.filter((t) => t.is_active), people });
}

// ── GET /people-manager/away ───────────────────────────────

async function awayRows(ctx: Ctx, from: string, to: string): Promise<{ rows: (LeaveAwayRow & { name: string | null })[]; error?: unknown }> {
  const r = await ctx.supabase.rpc("leave_department_away", { p_department_id: ctx.department.id, p_from: from, p_to: to });
  if (r.error) return { rows: [], error: r.error };
  const rows = (r.data ?? []) as LeaveAwayRow[];
  const n = await names(ctx.admin, rows.map((x) => x.user_id));
  return { rows: rows.map((x) => ({ ...x, name: n.get(x.user_id) ?? null })) };
}

export async function getAway(request: Request, slug: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  if (!ctx.isMember && !ctx.isAdmin) return notAuthorized();
  const q = new URL(request.url).searchParams;
  const from = q.get("from");
  const to = q.get("to");
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return badRequest("from and to must be YYYY-MM-DD dates, from first");
  if (daysBetween(from, to) > 366) return badRequest("At most a year at a time");
  const away = await awayRows(ctx, from, to);
  if (away.error) return dbError(away.error as never);
  const declared = new Map((await declaredHolidays(ctx, from, to)).map((h) => [h.day, h.name]));
  const days: { day: string; away: number; user_ids: string[]; holiday: string | null }[] = [];
  const holidays: DeclaredHoliday[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const holiday = saHolidayName(d) ?? declared.get(d) ?? null;
    if (holiday) holidays.push({ day: d, name: holiday });
    const w = weekdayOf(d);
    if (w === 0 || w === 6) continue;
    const ids = [...new Set(away.rows.filter((x) => x.start_date <= d && x.end_date >= d).map((x) => x.user_id))];
    days.push({ day: d, away: ids.length, user_ids: ids, holiday });
  }
  return NextResponse.json({ from, to, rows: away.rows, days, holidays, warn_at: 3 });
}

// ── /people-manager/blockouts ──────────────────────────────

export async function listBlockouts(request: Request, slug: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const q = new URL(request.url).searchParams;
  const person = q.get("person") ?? ctx.userId;
  if (!isUuid(person)) return badRequest("person must be an id");
  const from = q.get("from");
  const to = q.get("to");
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) return badRequest("from and to must be YYYY-MM-DD dates");
  // RLS (leave_can_view_person): yourself, an admin, or a leader of a department the person is in.
  let query = ctx.supabase.from(LEAVE_TABLES.blockouts).select(LEAVE_BLOCKOUT_COLUMNS).eq("user_id", person);
  if (to) query = query.lte("start_date", to);
  if (from) query = query.gte("end_date", from);
  const r = await query.order("start_date", { ascending: true }).limit(500);
  if (r.error) return dbError(r.error);
  return NextResponse.json({ blockouts: r.data ?? [] });
}

export async function createBlockout(request: Request, slug: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  const body = await readJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseBlockout(body.value);
  if (!parsed.ok) return badRequest(parsed.error);
  const r = await ctx.supabase
    .from(LEAVE_TABLES.blockouts)
    .insert({ user_id: ctx.userId, department_id: ctx.isMember ? ctx.department.id : null, ...parsed.value })
    .select(LEAVE_BLOCKOUT_COLUMNS)
    .single();
  if (r.error) return dbError(r.error);
  return NextResponse.json({ success: true, blockout: r.data }, { status: 201 });
}

export async function updateBlockout(request: Request, slug: string, blockoutId: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  if (!isUuid(blockoutId)) return notFound("Block-out not found");
  const body = await readJson(request);
  if (!body.ok) return badRequest("Invalid JSON body");
  const parsed = parseBlockout(body.value);
  if (!parsed.ok) return badRequest(parsed.error);
  const r = await ctx.supabase
    .from(LEAVE_TABLES.blockouts)
    .update(parsed.value)
    .eq("id", blockoutId)
    .eq("user_id", ctx.userId)
    .select(LEAVE_BLOCKOUT_COLUMNS);
  if (r.error) return dbError(r.error);
  const row = ((r.data ?? []) as Row[])[0];
  if (!row) return notFound("Block-out not found");
  return NextResponse.json({ success: true, blockout: row });
}

export async function deleteBlockout(_request: Request, slug: string, blockoutId: string) {
  const ctx = await open(slug);
  if (!isCtx(ctx)) return ctx.response;
  if (!isUuid(blockoutId)) return notFound("Block-out not found");
  const r = await ctx.supabase.from(LEAVE_TABLES.blockouts).delete().eq("id", blockoutId).eq("user_id", ctx.userId).select("id");
  if (r.error) return dbError(r.error);
  if (!((r.data ?? []) as Row[]).length) return notFound("Block-out not found");
  return NextResponse.json({ success: true });
}
