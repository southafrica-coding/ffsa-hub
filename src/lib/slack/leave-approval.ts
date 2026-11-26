// People Manager leave on Slack (any department; migration 421).
//
//   On submit   each approver gets one DM card from the "hub" bot: who asked,
//               the dates and counted weekdays, the type's year total against
//               its guideline ("Sick: 7 of 5 guideline days used (+2 over)"),
//               notes, cover, who else is away, the day's headcount, and
//               Approve / Approve with a note / Deny / Open in Hub.
//               Approvers come from 421's leave_request_approvers: the
//               department's leaders other than the requester, or the active
//               admins when the requester is the sole leader.
//   On decision every approver's card is rewritten to say who decided and
//               loses its buttons, and the requester gets one DM: confirmed
//               (with the note and a reminder to arrange cover) or not
//               approved (with the note).
//   On cancel   the cards are rewritten to say it was cancelled.
//
// Exactly once per request, recipient and kind. Before a DM goes out the
// sender claims it in leave_requests.slack_notify (421's server-written
// Slack log) with a compare-and-set on the row's updated_at: read the log,
// append { kind, recipient_id, state: "claimed" }, and UPDATE … WHERE id =
// $1 AND updated_at = <what we read>. 421's guard sets updated_at = now()
// on every write, so only one writer per version gets a row back; the
// loser re-reads and sees the claim. Only the caller that holds the claim
// sends. A refused send marks the entry failed (ok false, error), which
// releases it for a later run; a sent one records channel_id and ts so the
// card can be rewritten after the decision. A dedicated claim table would
// be simpler (see the PR: leave_request_notices); the code talks to the
// LeaveNoticeClaims interface so it can move without touching the senders.
//
// Same residual as lib/slack/l10-followup: a process that dies between a
// claim and the send leaves a "claimed" entry nobody retries (a missed DM
// is safer than a double one).
//
// Off everywhere except the Hub's real deployment (VERCEL_ENV=production and
// preview writes not disabled): previews share the real database and must
// never message anyone. Off, nothing is claimed. Anyone without a Slack id
// is skipped and logged.
//
// Uses the service role: it reads other people's Slack ids and leave and
// writes slack_notify, which 421 keeps server-only.

import { previewWritesDisabled } from "@/lib/preview-writes";
import * as slack from "@/lib/slack/client";
import { isBotConfigured } from "@/lib/slack/bots";
import { addDays, weekdayOf } from "@/lib/people-manager/days";
import { guidelineLine, usageByType } from "@/lib/people-manager/usage";
import type { LeaveRequest, LeaveSlackNotice } from "@/lib/people-manager/db.types";
import { LEAVE_REQUEST_COLUMNS, LEAVE_TABLES, LEAVE_TYPE_COLUMNS, PERSON_COLUMNS } from "@/lib/people-manager/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

// ── Actions (routed by /api/slack/interactions) ────────────

export const PM_LEAVE_APPROVE = "pm_leave_approve";
export const PM_LEAVE_APPROVE_NOTE = "pm_leave_approve_note";
export const PM_LEAVE_DENY = "pm_leave_deny";
export const PM_LEAVE_OPEN = "pm_leave_open";
export const PM_LEAVE_NOTE_VIEW = "pm_leave_note_view";
export const isLeaveAction = (actionId: string | undefined) => !!actionId && actionId.startsWith("pm_leave_");
export const isLeaveView = (callbackId: string | undefined) => callbackId === PM_LEAVE_NOTE_VIEW;

/** Vercel's VERCEL_ENV value for the real deployment (a platform constant). */
const VERCEL_REAL_DEPLOYMENT = "production";

export function canSendLeaveSlack(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === VERCEL_REAL_DEPLOYMENT && !previewWritesDisabled(env);
}

export function leaveRequestUrl(departmentSlug: string, requestId: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_SITE_URL || "https://www.ffsahub.com").replace(/\/+$/, "");
  return `${base}/departments/${encodeURIComponent(departmentSlug)}/people-manager?request=${encodeURIComponent(requestId)}`;
}

// ── Claims ─────────────────────────────────────────────────

export type LeaveNoticeKind = "approval" | "decision";

/** One slack_notify entry. leader_id/channel_id/ts/ok/error are 421's documented keys. */
export type LeaveNotice = LeaveSlackNotice & {
  kind?: LeaveNoticeKind;
  recipient_id?: string;
  state?: "claimed" | "sent" | "failed";
  claimed_at?: string;
  sent_at?: string;
};

export interface LeaveNoticeClaims {
  /** "claimed" = this caller sends; "taken" = someone already did (or is). */
  claim(requestId: string, kind: LeaveNoticeKind, recipientId: string): Promise<"claimed" | "taken" | "error">;
  sent(requestId: string, kind: LeaveNoticeKind, recipientId: string, info: { channel_id?: string; ts?: string }): Promise<void>;
  /** Give the claim back after a refused send, so a later run can retry. */
  release(requestId: string, kind: LeaveNoticeKind, recipientId: string, error: string): Promise<void>;
  list(requestId: string): Promise<LeaveNotice[]>;
}

const sameNotice = (n: LeaveNotice, kind: LeaveNoticeKind, recipientId: string) => n.kind === kind && n.recipient_id === recipientId;

/** Claims kept in leave_requests.slack_notify, compare-and-set on updated_at. */
export function slackNotifyClaims(admin: Client, now: () => Date = () => new Date(), attempts = 5): LeaveNoticeClaims {
  async function read(requestId: string): Promise<{ list: LeaveNotice[]; version: string } | null> {
    const r = await admin.from(LEAVE_TABLES.requests).select("id, slack_notify, updated_at").eq("id", requestId).maybeSingle();
    if (r.error || !r.data) return null;
    return { list: Array.isArray(r.data.slack_notify) ? (r.data.slack_notify as LeaveNotice[]) : [], version: r.data.updated_at };
  }

  /** Apply `change` to the log atomically. null from `change` = nothing to write. */
  async function mutate(
    requestId: string,
    change: (list: LeaveNotice[]) => LeaveNotice[] | null
  ): Promise<"written" | "unchanged" | "error"> {
    for (let i = 0; i < attempts; i += 1) {
      const cur = await read(requestId);
      if (!cur) return "error";
      const next = change(cur.list);
      if (!next) return "unchanged";
      const w = await admin
        .from(LEAVE_TABLES.requests)
        // updated_at is reset to now() by 421's guard; sent too so the new
        // version is never the one we compared against.
        .update({ slack_notify: next, updated_at: now().toISOString() })
        .eq("id", requestId)
        .eq("updated_at", cur.version)
        .select("id");
      if (w.error) return "error";
      if ((w.data ?? []).length) return "written";
      // Someone else wrote in between: read again.
    }
    return "error";
  }

  return {
    async claim(requestId, kind, recipientId) {
      const r = await mutate(requestId, (list) => {
        const held = list.find((n) => sameNotice(n, kind, recipientId) && n.state !== "failed");
        if (held) return null;
        const entry: LeaveNotice = { kind, recipient_id: recipientId, state: "claimed", claimed_at: now().toISOString() };
        if (kind === "approval") entry.leader_id = recipientId;
        return [...list.filter((n) => !sameNotice(n, kind, recipientId)), entry];
      });
      return r === "written" ? "claimed" : r === "unchanged" ? "taken" : "error";
    },
    async sent(requestId, kind, recipientId, info) {
      await mutate(requestId, (list) =>
        list.map((n) =>
          sameNotice(n, kind, recipientId)
            ? { ...n, state: "sent" as const, ok: true, error: undefined, channel_id: info.channel_id, ts: info.ts, sent_at: now().toISOString() }
            : n
        )
      );
    },
    async release(requestId, kind, recipientId, error) {
      await mutate(requestId, (list) => {
        const mine = list.find((n) => sameNotice(n, kind, recipientId));
        if (!mine || mine.state !== "claimed") return null;
        return list.map((n) => (sameNotice(n, kind, recipientId) ? { ...n, state: "failed" as const, ok: false, error } : n));
      });
    },
    async list(requestId) {
      return (await read(requestId))?.list ?? [];
    },
  };
}

// ── Context for the messages ───────────────────────────────

type Person = { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null; slack_user_id?: string | null };

export const personName = (p: Person | null | undefined) =>
  p ? `${p.preferred_name || p.first_name || ""} ${p.last_name || ""}`.trim() || "Someone" : "Someone";
const firstName = (p: Person | null | undefined) => (p ? p.preferred_name || p.first_name || personName(p) : "Someone");

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const n1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** "Thu 26 Nov", or with the year when it isn't `thisYear`. */
export function dayLabel(iso: string, thisYear?: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[weekdayOf(iso)]} ${d} ${MONTHS[m - 1]}${thisYear !== undefined && y !== thisYear ? ` ${y}` : ""}`;
}

const PART_WORDS: Record<string, string> = { am: "morning", pm: "afternoon" };

/** "Thu 26 Nov – Tue 1 Dec · 4 weekdays", halves named. */
export function rangeLabel(r: Pick<LeaveRequest, "start_date" | "end_date" | "start_part" | "end_part" | "days_count">, thisYear?: number): string {
  const year = thisYear ?? Number(r.start_date.slice(0, 4));
  const start = dayLabel(r.start_date, year);
  let dates: string;
  if (r.start_date === r.end_date) {
    dates = r.start_part === "full" ? start : `${start} (${PART_WORDS[r.start_part]})`;
  } else {
    const s = r.start_part === "pm" ? `${start} (afternoon)` : start;
    const e = dayLabel(r.end_date, year) + (r.end_part === "am" ? " (morning)" : "");
    dates = `${s} – ${e}`;
  }
  const days = Number(r.days_count);
  return `${dates} · ${n1(days)} weekday${days === 1 ? "" : "s"}`;
}

export type LeaveContext = {
  request: LeaveRequest;
  department: { id: string; name: string; slug: string };
  type: { id: string; slug: string; label: string };
  requester: Person;
  covering: Person | null;
  decider: Person | null;
  /** The request's start year, its type total there including this request, and the guideline. */
  usage: { year: number; total: number; guideline: number | null; line: string };
  alsoAway: { name: string; start_date: string; end_date: string; source: "leave" | "blockout"; status: string | null }[];
  /** The busiest weekday in the range: people away or unavailable, this request included. */
  peak: { day: string; away: number; members: number } | null;
  url: string;
};

/** Everything a card or DM needs. Null when the request is gone. */
export async function loadLeaveContext(admin: Client, requestId: string, env: NodeJS.ProcessEnv = process.env): Promise<LeaveContext | null> {
  const r = await admin.from(LEAVE_TABLES.requests).select(LEAVE_REQUEST_COLUMNS).eq("id", requestId).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  if (!r.data) return null;
  const request = r.data as LeaveRequest;

  const [dept, type, members] = await Promise.all([
    admin.from("staff_ministries").select("id, name, slug").eq("id", request.department_id).maybeSingle(),
    admin.from(LEAVE_TABLES.types).select(LEAVE_TYPE_COLUMNS).eq("id", request.leave_type_id).maybeSingle(),
    admin.from("staff_ministry_members").select("user_id").eq("staff_ministry_id", request.department_id).eq("status", "active"),
  ]);
  if (dept.error || !dept.data) throw new Error(dept.error?.message || "Department not found");
  if (type.error || !type.data) throw new Error(type.error?.message || "Leave type not found");
  if (members.error) throw new Error(members.error.message);
  const memberIds = [...new Set(((members.data ?? []) as { user_id: string }[]).map((m) => m.user_id))];

  // The department's own row for this slug overrides a base default's guideline (421).
  const override =
    type.data.department_id === null
      ? await admin.from(LEAVE_TABLES.types).select(LEAVE_TYPE_COLUMNS).eq("department_id", request.department_id).eq("slug", type.data.slug).maybeSingle()
      : { data: null, error: null };
  const effective = override.data ?? type.data;

  const year = Number(request.start_date.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const others = memberIds.filter((id) => id !== request.requester_id);
  const [mine, sameSlugTypes, otherLeave, otherBlocks] = await Promise.all([
    admin
      .from(LEAVE_TABLES.requests)
      .select("id, leave_type_id, status, days_by_year")
      .eq("requester_id", request.requester_id)
      .in("status", ["approved", "pending"])
      .lte("start_date", yearEnd)
      .gte("end_date", yearStart),
    admin.from(LEAVE_TABLES.types).select("id, slug").eq("slug", type.data.slug),
    others.length
      ? admin
          .from(LEAVE_TABLES.requests)
          .select("requester_id, status, start_date, end_date")
          .in("requester_id", others)
          .in("status", ["approved", "pending"])
          .lte("start_date", request.end_date)
          .gte("end_date", request.start_date)
      : { data: [], error: null },
    others.length
      ? admin
          .from(LEAVE_TABLES.blockouts)
          .select("user_id, start_date, end_date")
          .in("user_id", others)
          .lte("start_date", request.end_date)
          .gte("end_date", request.start_date)
      : { data: [], error: null },
  ]);
  for (const q of [mine, sameSlugTypes, otherLeave, otherBlocks]) if (q.error) throw new Error(q.error.message);

  // Year total for this type: approved days that year, plus this request's
  // days that year when it is still pending (approved ones are already in).
  const slugIds = new Map<string, string>(((sameSlugTypes.data ?? []) as { id: string; slug: string }[]).map((t) => [t.id, t.slug]));
  const [u] = usageByType({
    types: [{ ...effective, id: effective.id, is_active: true }],
    requests: ((mine.data ?? []) as LeaveRequest[]).filter((x) => x.status === "approved" || x.id === request.id),
    year,
    typeSlugById: slugIds,
  });
  const total = u ? u.used + (request.status === "pending" ? u.pending : 0) : 0;
  const guideline = effective.annual_allowance_days === null ? null : Number(effective.annual_allowance_days);

  const leaveRows = (otherLeave.data ?? []) as { requester_id: string; status: string; start_date: string; end_date: string }[];
  const blockRows = (otherBlocks.data ?? []) as { user_id: string; start_date: string; end_date: string }[];
  const peopleIds = [
    ...new Set([
      request.requester_id,
      request.covering_user_id,
      request.decided_by,
      ...leaveRows.map((x) => x.requester_id),
      ...blockRows.map((x) => x.user_id),
    ].filter((v): v is string => !!v)),
  ];
  const people = await admin.from("users").select(`${PERSON_COLUMNS}, slack_user_id`).in("id", peopleIds);
  if (people.error) throw new Error(people.error.message);
  const byId = new Map<string, Person>(((people.data ?? []) as Person[]).map((p) => [p.id, p]));

  const alsoAway: LeaveContext["alsoAway"] = [
    ...leaveRows.map((x) => ({ name: personName(byId.get(x.requester_id)), start_date: x.start_date, end_date: x.end_date, source: "leave" as const, status: x.status })),
    ...blockRows.map((x) => ({ name: personName(byId.get(x.user_id)), start_date: x.start_date, end_date: x.end_date, source: "blockout" as const, status: null })),
  ].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name));

  // Headcount: the weekday in the range with the most people away.
  let peak: LeaveContext["peak"] = null;
  for (let d = request.start_date; d <= request.end_date; d = addDays(d, 1)) {
    const w = weekdayOf(d);
    if (w === 0 || w === 6) continue;
    const away = new Set<string>([request.requester_id]);
    for (const x of leaveRows) if (x.start_date <= d && x.end_date >= d) away.add(x.requester_id);
    for (const x of blockRows) if (x.start_date <= d && x.end_date >= d) away.add(x.user_id);
    if (!peak || away.size > peak.away) peak = { day: d, away: away.size, members: Math.max(memberIds.length, away.size) };
  }

  return {
    request,
    department: dept.data,
    type: { id: type.data.id, slug: type.data.slug, label: effective.label },
    requester: byId.get(request.requester_id) ?? { id: request.requester_id, first_name: null, last_name: null, preferred_name: null },
    covering: request.covering_user_id ? (byId.get(request.covering_user_id) ?? null) : null,
    decider: request.decided_by ? (byId.get(request.decided_by) ?? null) : null,
    usage: { year, total, guideline, line: guidelineLine(effective.label, total, guideline) },
    alsoAway,
    peak,
    url: leaveRequestUrl(dept.data.slug, request.id, env),
  };
}

// ── Messages ───────────────────────────────────────────────

export type SlackMessage = { text: string; blocks: unknown[] };

const typeWords = (label: string) => label.toLowerCase().replace(/ leave$/, "") + " leave";
const section = (text: string) => ({ type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } });
const context = (text: string) => ({ type: "context", elements: [{ type: "mrkdwn", text: text.slice(0, 2900) }] });
const coverName = (c: LeaveContext) => (c.covering ? personName(c.covering) : c.request.covering_note || null);

export function buildApprovalCard(c: LeaveContext, recipient: { user_id: string; via: "leader" | "admin" }, otherApprovers: string[]): SlackMessage {
  const who = personName(c.requester);
  const r = c.request;
  const lines: string[] = [`*Used* ${esc(c.usage.line)}`];
  if (r.notes) lines.push(`*Notes* ${esc(r.notes)}`);
  const cover = coverName(c);
  if (cover) lines.push(`*Covering* ${esc(cover)}`);
  if (c.alsoAway.length) {
    const year = Number(r.start_date.slice(0, 4));
    const items = c.alsoAway.slice(0, 6).map((a) => {
      const span = a.start_date === a.end_date ? dayLabel(a.start_date, year) : `${dayLabel(a.start_date, year)} – ${dayLabel(a.end_date, year)}`;
      return `${esc(a.name)}, ${a.source === "blockout" ? "unavailable" : a.status === "pending" ? "away (pending)" : "away"} ${span}`;
    });
    lines.push(`*Also away* ${items.join(" · ")}${c.alsoAway.length > 6 ? ` · +${c.alsoAway.length - 6} more` : ""}`);
  }
  if (c.peak) {
    lines.push(`*Dept* ${esc(c.department.name)} · with ${esc(firstName(c.requester))}, ${c.peak.away} of ${c.peak.members} away or unavailable on ${dayLabel(c.peak.day)}`);
  }
  const why =
    recipient.via === "admin"
      ? `You get this as a Hub admin: ${esc(who)} is the only leader of ${esc(c.department.name)}.`
      : `You get this because you lead ${esc(c.department.name)}.`;
  const also = otherApprovers.length ? ` ${otherApprovers.map(esc).join(", ")} got it too, and the first decision counts.` : "";
  const blocks = [
    section(`*${esc(who)}* asked for ${esc(typeWords(c.type.label))}\n${esc(rangeLabel(r))}`),
    section(lines.join("\n")),
    {
      type: "actions",
      block_id: `pm_leave:${r.id}`,
      elements: [
        { type: "button", action_id: PM_LEAVE_APPROVE, style: "primary", text: { type: "plain_text", text: "Approve" }, value: r.id },
        { type: "button", action_id: PM_LEAVE_DENY, style: "danger", text: { type: "plain_text", text: "Deny" }, value: r.id },
        { type: "button", action_id: PM_LEAVE_APPROVE_NOTE, text: { type: "plain_text", text: "Approve with a note" }, value: r.id },
        { type: "button", action_id: PM_LEAVE_OPEN, text: { type: "plain_text", text: "Open in Hub" }, url: c.url },
      ],
    },
    context(why + also),
  ];
  return { text: `${who} asked for ${typeWords(c.type.label)}: ${rangeLabel(r)}. ${c.usage.line}.`, blocks };
}

const SAST_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" });

/** The card after it is settled: who decided (or that it was cancelled), no buttons. */
export function buildSettledCard(c: LeaveContext, recipientId: string): SlackMessage {
  const r = c.request;
  const by = (id: string | null, p: Person | null) => (id && id === recipientId ? "you" : personName(p));
  const at = (ts: string | null) => (ts ? ` · ${SAST_TIME.format(new Date(ts))}` : "");
  const head =
    r.status === "approved"
      ? `✓ Approved by ${by(r.decided_by, c.decider)}${at(r.decided_at)}`
      : r.status === "declined"
        ? `✕ Denied by ${by(r.decided_by, c.decider)}${at(r.decided_at)}`
        : r.status === "cancelled"
          ? `Cancelled by ${esc(firstName(c.requester))}${at(r.cancelled_at)}`
          : "Waiting for a decision";
  const sub = `${esc(personName(c.requester))} · ${esc(c.type.label)} · ${esc(rangeLabel(r))}`;
  const blocks: unknown[] = [section(`*${esc(head)}*\n${sub}`)];
  if (r.decision_note && r.status !== "cancelled") blocks.push(context(`Note: ${esc(r.decision_note)}`));
  blocks.push({
    type: "actions",
    elements: [{ type: "button", action_id: PM_LEAVE_OPEN, text: { type: "plain_text", text: "Open in Hub" }, url: c.url }],
  });
  return { text: `${head}: ${personName(c.requester)}, ${c.type.label}, ${rangeLabel(r)}`, blocks };
}

/** The requester's DM after the decision. */
export function buildDecisionDm(c: LeaveContext): SlackMessage {
  const r = c.request;
  const decider = personName(c.decider);
  const deciderFirst = firstName(c.decider);
  const kind = typeWords(c.type.label);
  const blocks: unknown[] = [];
  if (r.status === "approved") {
    blocks.push(section(`*✓ Your ${esc(kind)} is confirmed*\n${esc(rangeLabel(r))} · approved by ${esc(decider)}`));
    if (r.decision_note) blocks.push(section(`*Note from ${esc(deciderFirst)}* ${esc(r.decision_note)}`));
    const cover = coverName(c);
    blocks.push(
      section(
        `*Before you go: get your job completely covered.* ${
          cover ? `${esc(cover)} is down as covering. Hand over anything they need, so nothing waits for you.` : "Nobody is down as covering yet: arrange cover with your leader and hand over anything that can't wait."
        }`
      )
    );
    blocks.push({
      type: "actions",
      elements: [{ type: "button", action_id: PM_LEAVE_OPEN, text: { type: "plain_text", text: "View in Hub" }, url: c.url }],
    });
    blocks.push(context(`${esc(c.type.label)} in ${c.usage.year}: ${esc(c.usage.line.replace(/^[^:]*: /, ""))}.`));
    return { text: `Your ${kind} is confirmed: ${rangeLabel(r)}, approved by ${decider}.`, blocks };
  }
  blocks.push(section(`*✕ Your ${esc(kind)} wasn't approved*\n${esc(rangeLabel(r))} · decided by ${esc(decider)}`));
  if (r.decision_note) blocks.push(section(`*Note from ${esc(deciderFirst)}* ${esc(r.decision_note)}`));
  blocks.push({
    type: "actions",
    elements: [
      { type: "button", action_id: PM_LEAVE_OPEN, text: { type: "plain_text", text: "Request other dates" }, url: c.url },
    ],
  });
  blocks.push(context(`Nothing was taken off your ${esc(c.type.label.toLowerCase())} days.`));
  return { text: `Your ${kind} wasn't approved: ${rangeLabel(r)}, decided by ${decider}.`, blocks };
}

// ── Sending ────────────────────────────────────────────────

export interface LeaveSlackDeps {
  sendSlackDm: (slackUserId: string, message: SlackMessage) => Promise<{ ok: boolean; channel?: string; ts?: string; error?: string }>;
  updateMessage: (channel: string, ts: string, message: SlackMessage) => Promise<{ ok: boolean; error?: string }>;
  slackReady: () => boolean;
  now: () => Date;
  log: (message: string) => void;
  /** Override the claim store (tests, or a later claim table). */
  claims?: (admin: Client) => LeaveNoticeClaims;
}

export const realLeaveDeps: LeaveSlackDeps = {
  async sendSlackDm(slackUserId, message) {
    const conv = await slack.openConversation(slackUserId, "hub");
    const channel = conv.ok ? (conv as { channel?: { id: string } }).channel?.id : undefined;
    if (!channel) return { ok: false, error: (conv as { error?: string }).error || "no DM channel" };
    const sent = await slack.postMessage({ channel, text: message.text, blocks: message.blocks, bot: "hub" });
    if (!sent.ok) return { ok: false, error: (sent as { error?: string }).error || "post failed" };
    return { ok: true, channel: (sent as { channel?: string }).channel || channel, ts: (sent as { ts?: string }).ts };
  },
  async updateMessage(channel, ts, message) {
    const r = await slack.updateMessage({ channel, ts, text: message.text, blocks: message.blocks, bot: "hub" });
    return r.ok ? { ok: true } : { ok: false, error: (r as { error?: string }).error || "update failed" };
  },
  slackReady: () => isBotConfigured("hub"),
  now: () => new Date(),
  log: (message) => console.info(message),
};

export type RecipientOutcome = "sent" | "already-sent" | "no-slack" | "error";
export type LeaveSlackRun = {
  outcome: "off" | "not-found" | "not-pending" | "not-decided" | "done";
  results: { user_id: string; outcome: RecipientOutcome; error?: string }[];
};

type Opts = { deps?: LeaveSlackDeps; env?: NodeJS.ProcessEnv };

async function slackIds(admin: Client, ids: string[]): Promise<Map<string, Person>> {
  if (!ids.length) return new Map();
  const r = await admin.from("users").select(`${PERSON_COLUMNS}, slack_user_id`).in("id", ids);
  if (r.error) throw new Error(r.error.message);
  return new Map(((r.data ?? []) as Person[]).map((p) => [p.id, p]));
}

/** Claim, send, then record or release. */
async function deliver(
  claims: LeaveNoticeClaims,
  deps: LeaveSlackDeps,
  requestId: string,
  kind: LeaveNoticeKind,
  person: Person | undefined,
  userId: string,
  message: () => SlackMessage
): Promise<{ user_id: string; outcome: RecipientOutcome; error?: string }> {
  if (!person?.slack_user_id) {
    deps.log(`[leave-slack] request ${requestId}: ${kind} for user ${userId} skipped, no Slack id`);
    return { user_id: userId, outcome: "no-slack" };
  }
  const claim = await claims.claim(requestId, kind, userId);
  if (claim === "taken") return { user_id: userId, outcome: "already-sent" };
  if (claim === "error") {
    deps.log(`[leave-slack] request ${requestId}: ${kind} claim failed for ${userId}, not sent`);
    return { user_id: userId, outcome: "error", error: "claim failed" };
  }
  const sent = await deps
    .sendSlackDm(person.slack_user_id, message())
    .catch((err: unknown) => ({ ok: false as const, error: String((err as Error)?.message || err), channel: undefined, ts: undefined }));
  if (sent.ok) {
    await claims.sent(requestId, kind, userId, { channel_id: sent.channel, ts: sent.ts });
    return { user_id: userId, outcome: "sent" };
  }
  await claims.release(requestId, kind, userId, sent.error || "send failed");
  deps.log(`[leave-slack] request ${requestId}: ${kind} DM to ${userId} failed: ${sent.error ?? "unknown"}`);
  return { user_id: userId, outcome: "error", error: sent.error };
}

/**
 * DM every approver of a pending request who has not had its card yet.
 * Safe to call any number of times, at the same time too.
 */
export async function runLeaveApprovalRequests(admin: Client, requestId: string, opts: Opts = {}): Promise<LeaveSlackRun> {
  const deps = opts.deps ?? realLeaveDeps;
  const env = opts.env ?? process.env;
  if (!canSendLeaveSlack(env) || !deps.slackReady()) return { outcome: "off", results: [] };
  const c = await loadLeaveContext(admin, requestId, env);
  if (!c) return { outcome: "not-found", results: [] };
  if (c.request.status !== "pending") return { outcome: "not-pending", results: [] };

  const ap = await admin.rpc("leave_request_approvers", { p_request_id: requestId });
  if (ap.error) throw new Error(ap.error.message);
  const approvers = ((ap.data ?? []) as { user_id: string; via: "leader" | "admin" }[]).filter((a) => a.user_id !== c.request.requester_id);
  const people = await slackIds(admin, approvers.map((a) => a.user_id));
  const claims = (deps.claims ?? ((a: Client) => slackNotifyClaims(a, deps.now)))(admin);

  const results: LeaveSlackRun["results"] = [];
  for (const a of approvers) {
    const others = approvers.filter((o) => o.user_id !== a.user_id).map((o) => personName(people.get(o.user_id)));
    results.push(await deliver(claims, deps, requestId, "approval", people.get(a.user_id), a.user_id, () => buildApprovalCard(c, a, others)));
  }
  return { outcome: "done", results };
}

/** Rewrite every sent approval card to show how the request was settled. Overwrites, so repeats are harmless. */
async function refreshCards(admin: Client, c: LeaveContext, deps: LeaveSlackDeps): Promise<number> {
  const claims = (deps.claims ?? ((a: Client) => slackNotifyClaims(a, deps.now)))(admin);
  const notices = (await claims.list(c.request.id)).filter((n) => n.kind === "approval" && n.state === "sent" && n.channel_id && n.ts);
  let updated = 0;
  for (const n of notices) {
    const r = await deps
      .updateMessage(n.channel_id!, n.ts!, buildSettledCard(c, n.recipient_id ?? ""))
      .catch((err: unknown) => ({ ok: false, error: String((err as Error)?.message || err) }));
    if (r.ok) updated += 1;
    else deps.log(`[leave-slack] request ${c.request.id}: card update for ${n.recipient_id} failed: ${r.error ?? "unknown"}`);
  }
  return updated;
}

/** After a decision: settle every card, then DM the requester once. */
export async function runLeaveDecided(admin: Client, requestId: string, opts: Opts = {}): Promise<LeaveSlackRun & { cards_updated: number }> {
  const deps = opts.deps ?? realLeaveDeps;
  const env = opts.env ?? process.env;
  if (!canSendLeaveSlack(env) || !deps.slackReady()) return { outcome: "off", results: [], cards_updated: 0 };
  const c = await loadLeaveContext(admin, requestId, env);
  if (!c) return { outcome: "not-found", results: [], cards_updated: 0 };
  if (c.request.status !== "approved" && c.request.status !== "declined") {
    return { outcome: "not-decided", results: [], cards_updated: 0 };
  }
  const cards = await refreshCards(admin, c, deps);
  const claims = (deps.claims ?? ((a: Client) => slackNotifyClaims(a, deps.now)))(admin);
  const people = await slackIds(admin, [c.request.requester_id]);
  const result = await deliver(claims, deps, requestId, "decision", people.get(c.request.requester_id), c.request.requester_id, () => buildDecisionDm(c));
  return { outcome: "done", results: [result], cards_updated: cards };
}

/** After a cancel: settle the cards. No DM. */
export async function runLeaveCancelled(admin: Client, requestId: string, opts: Opts = {}): Promise<{ outcome: "off" | "not-found" | "done"; cards_updated: number }> {
  const deps = opts.deps ?? realLeaveDeps;
  const env = opts.env ?? process.env;
  if (!canSendLeaveSlack(env) || !deps.slackReady()) return { outcome: "off", cards_updated: 0 };
  const c = await loadLeaveContext(admin, requestId, env);
  if (!c) return { outcome: "not-found", cards_updated: 0 };
  return { outcome: "done", cards_updated: await refreshCards(admin, c, deps) };
}

/** Never throws: Slack trouble must not fail the Hub action that caused it. */
export async function safely<T>(label: string, fn: () => Promise<T>, log: (m: string) => void = console.error): Promise<T | { outcome: "error" }> {
  try {
    return await fn();
  } catch (error) {
    log(`[leave-slack] ${label}: ${String((error as Error)?.message || error)}`);
    return { outcome: "error" as const };
  }
}
