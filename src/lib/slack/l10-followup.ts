// After a P&W L10 meeting ends, each attendee gets one Slack DM from the
// FFSA Hub Activity bot with their open to-dos: the ones from this meeting,
// then the others still open on that team, each with its due date, and a
// button back to the team's L10 page in the Hub.
//
// Same delivery as Fleet's reminder (lib/fleet/reminder-send): open a DM
// with conversations.open, then chat.postMessage, on the "hub" bot.
//
// Exactly once per attendee. Before a DM goes out, the sender claims it by
// setting l10_meeting_attendees.followup_sent_at with a compare-and-set
// (UPDATE … WHERE followup_sent_at IS NULL RETURNING) on l10_meeting_attendees. Only the caller that
// gets the row back sends, so a retried end, a double click or two servers
// ending at once DM each person once. If Slack refuses the DM, the claim is
// released (only if it is still ours), so a later end call can try again.
//
// Off everywhere except the live site (VERCEL_ENV=production and preview
// writes not disabled), like Fleet: previews share the production database
// and must never message anyone. Off, nothing is claimed.
//
// No "Mark done" button: the Slack interactivity route
// (app/api/slack/interactions) has no generic action dispatcher to plug an
// L10 handler into, so a button would need a change to that route.
//
// Also one recap per meeting in the team's Slack channel
// (l10_teams.slack_channel_id): the average rating, this meeting's to-dos
// (source_meeting_id) with their owners, the issues solved in it
// (resolved_meeting_id) and the issues kept open. Claimed the same way on
// l10_meetings.recap_posted_at. No channel (null) is skipped and logged.
//
// Issues carry over by themselves (416): they belong to the team and stay
// identified/discussed until solved, so an open issue is on the next
// meeting's IDS list with nothing copied.
//
// Uses the service role: it reads other people's to-dos and Slack ids and
// stamps their attendee rows, which the caller's RLS rightly does not allow.

import { previewWritesDisabled } from "@/lib/preview-writes";
import * as slack from "@/lib/slack/client";
import { isBotConfigured } from "@/lib/slack/bots";
import { L10_OPEN_ISSUE_STATUSES, L10_TABLES, type L10Todo } from "@/lib/l10/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export function canSendL10Followup(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "production" && !previewWritesDisabled(env);
}

export function l10TeamUrl(departmentSlug: string, teamId: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.NEXT_PUBLIC_APP_URL || env.NEXT_PUBLIC_SITE_URL || "https://www.ffsahub.com").replace(/\/+$/, "");
  return `${base}/departments/${encodeURIComponent(departmentSlug)}/l10/${encodeURIComponent(teamId)}`;
}

// ── The message ────────────────────────────────────────────

export type FollowupTodo = Pick<L10Todo, "id" | "title" | "due_on" | "source_meeting_id">;

export type FollowupMessage = { text: string; blocks: unknown[] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Today in South Africa, YYYY-MM-DD. */
export function todayInSA(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(now);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "due Tue 1 Dec" / "overdue, was due Mon 30 Nov" / "no due date". */
export function dueLabel(dueOn: string | null, today: string): string {
  if (!dueOn) return "no due date";
  const [y, m, d] = dueOn.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = `${WEEKDAYS[date.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
  return dueOn < today ? `⚠️ overdue, was due ${day}` : `due ${day}`;
}

function byDue(a: FollowupTodo, b: FollowupTodo): number {
  if (a.due_on === b.due_on) return a.title.localeCompare(b.title);
  if (!a.due_on) return 1;
  if (!b.due_on) return -1;
  return a.due_on < b.due_on ? -1 : 1;
}

export function buildFollowupMessage(input: {
  teamName: string;
  firstName: string | null;
  meetingId: string;
  todos: readonly FollowupTodo[];
  url: string;
  today: string;
}): FollowupMessage {
  const fromMeeting = input.todos.filter((t) => t.source_meeting_id === input.meetingId).sort(byDue);
  const stillOpen = input.todos.filter((t) => t.source_meeting_id !== input.meetingId).sort(byDue);
  const line = (t: FollowupTodo) => `• ${esc(t.title)} — _${dueLabel(t.due_on, input.today)}_`;
  const hello = input.firstName ? `Hi ${esc(input.firstName)}, ` : "";
  const heading = `${hello}here are your to-dos from today’s *${esc(input.teamName)}* L10.`;

  const sections: string[] = [];
  if (fromMeeting.length) sections.push(`*From this meeting*\n${fromMeeting.map(line).join("\n")}`);
  if (stillOpen.length) sections.push(`*Still open*\n${stillOpen.map(line).join("\n")}`);
  if (!sections.length) sections.push("You have no open to-dos on this team. 🎉");

  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: heading } },
    ...sections.map((text) => ({ type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } })),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: "l10_open_team",
          text: { type: "plain_text", text: `Open ${input.teamName} L10`.slice(0, 75) },
          url: input.url,
        },
      ],
    },
  ];
  const count = fromMeeting.length + stillOpen.length;
  const text = `${input.teamName} L10: you have ${count} open to-do${count === 1 ? "" : "s"}. ${input.url}`;
  return { text, blocks };
}

// ── Sending ────────────────────────────────────────────────

export interface L10FollowupDeps {
  sendSlackDm: (slackUserId: string, message: FollowupMessage) => Promise<{ ok: boolean; error?: string }>;
  postToChannel: (channelId: string, message: FollowupMessage) => Promise<{ ok: boolean; error?: string }>;
  slackReady: () => boolean;
  now: () => Date;
  log: (message: string) => void;
}

export const realDeps: L10FollowupDeps = {
  async sendSlackDm(slackUserId, message) {
    const conv = await slack.openConversation(slackUserId, "hub");
    const channel = conv.ok ? (conv as { channel?: { id: string } }).channel?.id : undefined;
    if (!channel) return { ok: false, error: (conv as { error?: string }).error || "no DM channel" };
    const sent = await slack.postMessage({ channel, text: message.text, blocks: message.blocks, bot: "hub" });
    return sent.ok ? { ok: true } : { ok: false, error: (sent as { error?: string }).error || "post failed" };
  },
  async postToChannel(channelId, message) {
    const sent = await slack.postMessage({ channel: channelId, text: message.text, blocks: message.blocks, bot: "hub" });
    return sent.ok ? { ok: true } : { ok: false, error: (sent as { error?: string }).error || "post failed" };
  },
  slackReady: () => isBotConfigured("hub"),
  now: () => new Date(),
  log: (message) => console.info(message),
};

export type AttendeeOutcome = "sent" | "already-sent" | "no-slack" | "error";

export type L10FollowupRun = {
  outcome: "off" | "not-ended" | "not-found" | "done";
  results: { user_id: string; outcome: AttendeeOutcome; error?: string }[];
};

type Person = { id: string; first_name: string | null; preferred_name: string | null; slack_user_id: string | null };

/**
 * DM every attendee of an ended meeting who has not had their follow-up.
 * Safe to call any number of times, at the same time too.
 * `admin` is the service-role client.
 */
export async function runL10Followup(
  admin: Client,
  meetingId: string,
  opts: { deps?: L10FollowupDeps; env?: NodeJS.ProcessEnv } = {}
): Promise<L10FollowupRun> {
  const deps = opts.deps ?? realDeps;
  const env = opts.env ?? process.env;

  const m = await admin.from(L10_TABLES.meetings).select("id, team_id, ended_at").eq("id", meetingId).maybeSingle();
  if (m.error) throw new Error(m.error.message);
  if (!m.data) return { outcome: "not-found", results: [] };
  if (!m.data.ended_at) return { outcome: "not-ended", results: [] };
  if (!canSendL10Followup(env) || !deps.slackReady()) return { outcome: "off", results: [] };

  const team = await admin.from(L10_TABLES.teams).select("id, name, department_id").eq("id", m.data.team_id).maybeSingle();
  if (team.error || !team.data) throw new Error(team.error?.message || "L10 team not found");
  const dept = await admin.from("staff_ministries").select("slug").eq("id", team.data.department_id).maybeSingle();
  if (dept.error || !dept.data) throw new Error(dept.error?.message || "Department not found");
  const url = l10TeamUrl(dept.data.slug, team.data.id, env);

  const att = await admin
    .from(L10_TABLES.attendees)
    .select("profile_id, followup_sent_at")
    .eq("team_id", team.data.id)
    .eq("meeting_id", meetingId);
  if (att.error) throw new Error(att.error.message);
  const attendees = (att.data ?? []) as { profile_id: string; followup_sent_at: string | null }[];
  const ids = attendees.map((a) => a.profile_id);
  if (!ids.length) return { outcome: "done", results: [] };

  const [people, todos] = await Promise.all([
    admin.from("users").select("id, first_name, preferred_name, slack_user_id").in("id", ids),
    admin
      .from(L10_TABLES.todos)
      .select("id, title, due_on, source_meeting_id, owner_id")
      .eq("team_id", team.data.id)
      .eq("done", false)
      .in("owner_id", ids),
  ]);
  if (people.error) throw new Error(people.error.message);
  if (todos.error) throw new Error(todos.error.message);
  const byId = new Map<string, Person>(((people.data ?? []) as Person[]).map((p) => [p.id, p]));
  const openTodos = (todos.data ?? []) as (FollowupTodo & { owner_id: string })[];
  const today = todayInSA(deps.now());

  const results: L10FollowupRun["results"] = [];
  for (const a of attendees) {
    if (a.followup_sent_at) {
      results.push({ user_id: a.profile_id, outcome: "already-sent" });
      continue;
    }
    const person = byId.get(a.profile_id);
    if (!person?.slack_user_id) {
      deps.log(`[l10-followup] meeting ${meetingId}: user ${a.profile_id} has no Slack id, skipped`);
      results.push({ user_id: a.profile_id, outcome: "no-slack" });
      continue;
    }

    // The claim. Whoever gets the row back is the only one who sends.
    const stamp = deps.now().toISOString();
    const claim = await admin
      .from(L10_TABLES.attendees)
      .update({ followup_sent_at: stamp })
      .eq("meeting_id", meetingId)
      .eq("profile_id", a.profile_id)
      .is("followup_sent_at", null)
      .select("profile_id");
    if (claim.error) {
      results.push({ user_id: a.profile_id, outcome: "error", error: "claim failed" });
      deps.log(`[l10-followup] meeting ${meetingId}: claim failed for ${a.profile_id}: ${claim.error.message}`);
      continue;
    }
    if (!(claim.data ?? []).length) {
      results.push({ user_id: a.profile_id, outcome: "already-sent" });
      continue;
    }

    const message = buildFollowupMessage({
      teamName: team.data.name,
      firstName: person.preferred_name || person.first_name,
      meetingId,
      todos: openTodos.filter((t) => t.owner_id === a.profile_id),
      url,
      today,
    });
    const sent = await deps
      .sendSlackDm(person.slack_user_id, message)
      .catch((err: unknown) => ({ ok: false, error: String((err as Error)?.message || err) }));
    if (sent.ok) {
      results.push({ user_id: a.profile_id, outcome: "sent" });
      continue;
    }
    // Give the claim back, only if it is still ours, so a later end call retries.
    await admin
      .from(L10_TABLES.attendees)
      .update({ followup_sent_at: null })
      .eq("meeting_id", meetingId)
      .eq("profile_id", a.profile_id)
      .eq("followup_sent_at", stamp);
    deps.log(`[l10-followup] meeting ${meetingId}: DM to ${a.profile_id} failed: ${sent.error ?? "unknown"}`);
    results.push({ user_id: a.profile_id, outcome: "error", error: sent.error });
  }
  // Meeting-level marker (416's l10_meetings.followup_sent_at): set once,
  // when nobody is left waiting for a DM. Informational; the per-person
  // claims above are what stop a double send.
  if (results.every((r) => r.outcome === "sent" || r.outcome === "already-sent" || r.outcome === "no-slack")) {
    await admin
      .from(L10_TABLES.meetings)
      .update({ followup_sent_at: deps.now().toISOString() })
      .eq("id", meetingId)
      .is("followup_sent_at", null);
  }
  return { outcome: "done", results };
}

// ── The team channel recap ─────────────────────────────────

export type RecapTodo = { title: string; due_on: string | null; owner: string | null };
export type RecapIssue = { title: string; owner: string | null };

export function buildRecapMessage(input: {
  teamName: string;
  averageRating: number | null;
  ratedCount: number;
  todos: readonly RecapTodo[];
  solved: readonly RecapIssue[];
  open: readonly RecapIssue[];
  url: string;
  today: string;
}): FollowupMessage {
  const who = (name: string | null) => (name ? esc(name) : "_no owner_");
  const rating =
    input.averageRating === null
      ? "No ratings given"
      : `Average rating *${input.averageRating}* / 10 (${input.ratedCount} rated)`;
  const todoLines = input.todos.length
    ? input.todos.map((t) => `• ${esc(t.title)} — ${who(t.owner)}, _${dueLabel(t.due_on, input.today)}_`).join("\n")
    : "_None_";
  const issueLines = (list: readonly RecapIssue[]) =>
    list.length ? list.map((i) => `• ${esc(i.title)}${i.owner ? ` — ${esc(i.owner)}` : ""}`).join("\n") : "_None_";
  const sections = [
    `*${esc(input.teamName)} L10 recap*\n${rating}`,
    `*To-dos from this meeting*\n${todoLines}`,
    `*Issues solved*\n${issueLines(input.solved)}`,
    `*Issues kept open* (back on the list next week)\n${issueLines(input.open)}`,
  ];
  const blocks: unknown[] = [
    ...sections.map((text) => ({ type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } })),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: "l10_open_team",
          text: { type: "plain_text", text: `Open ${input.teamName} L10`.slice(0, 75) },
          url: input.url,
        },
      ],
    },
  ];
  const avg = input.averageRating === null ? "no rating" : `rated ${input.averageRating}/10`;
  const text = `${input.teamName} L10 recap: ${avg}, ${input.todos.length} to-do${input.todos.length === 1 ? "" : "s"}, ${input.solved.length} solved, ${input.open.length} open. ${input.url}`;
  return { text, blocks };
}

export type L10RecapRun = {
  outcome: "off" | "not-ended" | "not-found" | "no-channel" | "already-posted" | "posted" | "error";
  error?: string;
};

const personName = (p: Person & { last_name?: string | null }) =>
  [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(" ") || null;

/**
 * Post the meeting recap to the team's channel once. Safe to repeat and to
 * run at the same time. `admin` is the service-role client.
 */
export async function runL10Recap(
  admin: Client,
  meetingId: string,
  opts: { deps?: L10FollowupDeps; env?: NodeJS.ProcessEnv } = {}
): Promise<L10RecapRun> {
  const deps = opts.deps ?? realDeps;
  const env = opts.env ?? process.env;

  const m = await admin
    .from(L10_TABLES.meetings)
    .select("id, team_id, started_at, ended_at, recap_posted_at")
    .eq("id", meetingId)
    .maybeSingle();
  if (m.error) {
    deps.log(`[l10-recap] meeting ${meetingId}: cannot read the meeting (${m.error.code ?? ""} ${m.error.message}), skipped`);
    return { outcome: "error", error: "meeting read failed" };
  }
  if (!m.data) return { outcome: "not-found" };
  if (!m.data.ended_at) return { outcome: "not-ended" };
  if (m.data.recap_posted_at) return { outcome: "already-posted" };
  if (!canSendL10Followup(env) || !deps.slackReady()) return { outcome: "off" };

  const team = await admin
    .from(L10_TABLES.teams)
    .select("id, name, department_id, slack_channel_id")
    .eq("id", m.data.team_id)
    .maybeSingle();
  if (team.error || !team.data) {
    deps.log(`[l10-recap] meeting ${meetingId}: no team channel to read (${team.error?.message ?? "team not found"}), skipped`);
    return { outcome: "no-channel" };
  }
  const channel = team.data.slack_channel_id as string | null | undefined;
  if (!channel) {
    deps.log(`[l10-recap] meeting ${meetingId}: team ${team.data.id} has no slack_channel_id, skipped`);
    return { outcome: "no-channel" };
  }
  const dept = await admin.from("staff_ministries").select("slug").eq("id", team.data.department_id).maybeSingle();
  if (dept.error || !dept.data) return { outcome: "error", error: "department not found" };

  const teamId = team.data.id;
  const [att, todos, solved, open] = await Promise.all([
    admin.from(L10_TABLES.attendees).select("profile_id, rating").eq("team_id", teamId).eq("meeting_id", meetingId),
    admin.from(L10_TABLES.todos).select("title, due_on, owner_id").eq("team_id", teamId).eq("source_meeting_id", meetingId),
    admin
      .from(L10_TABLES.issues)
      .select("title, owner_id")
      .eq("team_id", teamId)
      .eq("status", "solved")
      .eq("resolved_meeting_id", meetingId),
    admin
      .from(L10_TABLES.issues)
      .select("title, owner_id, priority")
      .eq("team_id", teamId)
      .in("status", [...L10_OPEN_ISSUE_STATUSES])
      .order("priority", { ascending: true, nullsFirst: false }),
  ]);
  for (const r of [att, todos, solved, open]) {
    if (r.error) return { outcome: "error", error: "recap read failed" };
  }
  type Owned = { title: string; owner_id: string | null; due_on?: string | null };
  const ownerIds = [
    ...new Set(
      [...(todos.data ?? []), ...(solved.data ?? []), ...(open.data ?? [])]
        .map((r: Owned) => r.owner_id)
        .filter((x: string | null): x is string => !!x)
    ),
  ];
  const people = ownerIds.length
    ? await admin.from("users").select("id, first_name, last_name, preferred_name").in("id", ownerIds)
    : { data: [], error: null };
  if (people.error) return { outcome: "error", error: "recap read failed" };
  const nameOf = new Map<string, string | null>(
    ((people.data ?? []) as (Person & { last_name?: string | null })[]).map((p) => [p.id, personName(p)])
  );
  const owner = (id: string | null) => (id ? nameOf.get(id) ?? null : null);

  const ratings = ((att.data ?? []) as { rating: number | null }[])
    .map((a) => a.rating)
    .filter((r): r is number => typeof r === "number");
  const average = ratings.length ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : null;

  const message = buildRecapMessage({
    teamName: team.data.name,
    averageRating: average,
    ratedCount: ratings.length,
    todos: ((todos.data ?? []) as Owned[]).map((t) => ({ title: t.title, due_on: t.due_on ?? null, owner: owner(t.owner_id) })),
    solved: ((solved.data ?? []) as Owned[]).map((i) => ({ title: i.title, owner: owner(i.owner_id) })),
    open: ((open.data ?? []) as Owned[]).map((i) => ({ title: i.title, owner: owner(i.owner_id) })),
    url: l10TeamUrl(dept.data.slug, team.data.id, env),
    today: todayInSA(deps.now()),
  });

  // The claim. Whoever gets the row back is the only one who posts.
  const stamp = deps.now().toISOString();
  const claim = await admin
    .from(L10_TABLES.meetings)
    .update({ recap_posted_at: stamp })
    .eq("id", meetingId)
    .is("recap_posted_at", null)
    .select("id");
  if (claim.error) {
    deps.log(`[l10-recap] meeting ${meetingId}: claim failed (${claim.error.code ?? ""} ${claim.error.message}), not posted`);
    return { outcome: "error", error: "claim failed" };
  }
  if (!(claim.data ?? []).length) return { outcome: "already-posted" };

  const sent = await deps
    .postToChannel(channel, message)
    .catch((err: unknown) => ({ ok: false, error: String((err as Error)?.message || err) }));
  if (sent.ok) return { outcome: "posted" };
  await admin
    .from(L10_TABLES.meetings)
    .update({ recap_posted_at: null })
    .eq("id", meetingId)
    .eq("recap_posted_at", stamp);
  deps.log(`[l10-recap] meeting ${meetingId}: post failed: ${sent.error ?? "unknown"}`);
  return { outcome: "error", error: sent.error };
}

/** Everything that happens on Slack when a meeting ends: the DMs, then the channel recap. */
export async function runL10MeetingEnded(
  admin: Client,
  meetingId: string,
  opts: { deps?: L10FollowupDeps; env?: NodeJS.ProcessEnv } = {}
): Promise<{ followup: L10FollowupRun | { outcome: "error" }; recap: L10RecapRun }> {
  const log = (opts.deps ?? realDeps).log;
  const followup = await runL10Followup(admin, meetingId, opts).catch((error: unknown) => {
    log(`[l10-followup] meeting ${meetingId}: ${String((error as Error)?.message || error)}`);
    return { outcome: "error" as const };
  });
  const recap = await runL10Recap(admin, meetingId, opts).catch((error: unknown) => {
    log(`[l10-recap] meeting ${meetingId}: ${String((error as Error)?.message || error)}`);
    return { outcome: "error" as const };
  });
  return { followup, recap };
}
