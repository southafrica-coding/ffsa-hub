// One meeting's recap, as data. Two things are built from it:
//   - the Slack channel recap (lib/slack/l10-followup buildRecapMessage)
//   - the plain-text cross-team headline (lib/l10/auto-headline)
//
// Reads with the client it is given. Both callers pass the service role:
// the Slack recap runs after the meeting, and the cross-team headline reads
// another team's meeting, which the caller's RLS rightly hides.

import { quarterOf } from "@/lib/departments/quarter";
import { L10_OPEN_ISSUE_STATUSES, L10_TABLES } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

export type RecapPersonItem = { title: string; owner: string | null };
export type RecapTodoItem = RecapPersonItem & { due_on: string | null };

export type MeetingRecap = {
  meetingId: string;
  teamId: string;
  teamName: string;
  departmentId: string;
  slackChannelId: string | null;
  startedAt: string;
  endedAt: string;
  /** The meeting's date in South Africa, YYYY-MM-DD. */
  date: string;
  averageRating: number | null;
  ratedCount: number;
  /** The team's rocks for the meeting's quarter. */
  rocks: { onTrack: number; offTrack: number; done: number; total: number };
  /**
   * To-do review: the team's to-dos that were open when the meeting
   * started, and how many of them were done by the time it ended.
   */
  todoReview: { due: number; done: number; percent: number | null };
  /** To-dos raised in this meeting (source_meeting_id). */
  newTodos: RecapTodoItem[];
  /** Issues solved in this meeting (resolved_meeting_id). */
  solved: RecapPersonItem[];
  /** The team's issues still open now. */
  open: RecapPersonItem[];
};

type PersonRow = { id: string; first_name: string | null; last_name: string | null; preferred_name: string | null };

export function personName(p: PersonRow): string | null {
  return [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(" ") || null;
}

function saDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date(iso));
}

type DbFail = { ok: false; reason: "not-found" | "not-ended" | "read-failed"; detail?: string };

/** Everything the recap says about one ended meeting. */
export async function loadMeetingRecap(admin: Client, meetingId: string): Promise<{ ok: true; recap: MeetingRecap } | DbFail> {
  const m = await admin
    .from(L10_TABLES.meetings)
    .select("id, team_id, started_at, ended_at")
    .eq("id", meetingId)
    .maybeSingle();
  if (m.error) return { ok: false, reason: "read-failed", detail: m.error.message };
  if (!m.data) return { ok: false, reason: "not-found" };
  if (!m.data.ended_at) return { ok: false, reason: "not-ended" };
  const { team_id: teamId, started_at: startedAt, ended_at: endedAt } = m.data as { team_id: string; started_at: string; ended_at: string };

  const team = await admin
    .from(L10_TABLES.teams)
    .select("id, name, department_id, slack_channel_id")
    .eq("id", teamId)
    .maybeSingle();
  if (team.error || !team.data) return { ok: false, reason: "read-failed", detail: team.error?.message ?? "team not found" };

  const [att, rocks, todos, newTodos, solved, open] = await Promise.all([
    admin.from(L10_TABLES.attendees).select("profile_id, rating").eq("team_id", teamId).eq("meeting_id", meetingId),
    admin.from(L10_TABLES.rocks).select("status").eq("team_id", teamId).eq("quarter", quarterOf(new Date(endedAt))),
    // Open when the meeting started: made before it, and not done before it.
    admin.from(L10_TABLES.todos).select("done, done_at, created_at").eq("team_id", teamId).lte("created_at", startedAt),
    admin.from(L10_TABLES.todos).select("title, due_on, owner_id").eq("team_id", teamId).eq("source_meeting_id", meetingId),
    admin.from(L10_TABLES.issues).select("title, owner_id").eq("team_id", teamId).eq("status", "solved").eq("resolved_meeting_id", meetingId),
    admin
      .from(L10_TABLES.issues)
      .select("title, owner_id, priority")
      .eq("team_id", teamId)
      .in("status", [...L10_OPEN_ISSUE_STATUSES])
      .order("priority", { ascending: true, nullsFirst: false }),
  ]);
  for (const r of [att, rocks, todos, newTodos, solved, open]) {
    if (r.error) return { ok: false, reason: "read-failed", detail: r.error.message };
  }

  type Owned = { title: string; owner_id: string | null; due_on?: string | null };
  const ownerIds = [
    ...new Set(
      [...(newTodos.data ?? []), ...(solved.data ?? []), ...(open.data ?? [])]
        .map((r: Owned) => r.owner_id)
        .filter((x: string | null): x is string => !!x)
    ),
  ];
  const people = ownerIds.length
    ? await admin.from("users").select("id, first_name, last_name, preferred_name").in("id", ownerIds)
    : { data: [], error: null };
  if (people.error) return { ok: false, reason: "read-failed", detail: people.error.message };
  const nameOf = new Map<string, string | null>(((people.data ?? []) as PersonRow[]).map((p) => [p.id, personName(p)]));
  const owner = (id: string | null) => (id ? nameOf.get(id) ?? null : null);

  const ratings = ((att.data ?? []) as { rating: number | null }[])
    .map((a) => a.rating)
    .filter((r): r is number => typeof r === "number");
  const averageRating = ratings.length ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : null;

  const rockRows = (rocks.data ?? []) as { status: string }[];
  const due = ((todos.data ?? []) as { done: boolean; done_at: string | null }[]).filter(
    (t) => !t.done || !t.done_at || t.done_at >= startedAt
  );
  const doneByEnd = due.filter((t) => t.done && t.done_at && t.done_at <= endedAt).length;

  return {
    ok: true,
    recap: {
      meetingId,
      teamId,
      teamName: team.data.name,
      departmentId: team.data.department_id,
      slackChannelId: team.data.slack_channel_id ?? null,
      startedAt,
      endedAt,
      date: saDate(startedAt),
      averageRating,
      ratedCount: ratings.length,
      rocks: {
        onTrack: rockRows.filter((r) => r.status === "on_track").length,
        offTrack: rockRows.filter((r) => r.status === "off_track").length,
        done: rockRows.filter((r) => r.status === "done").length,
        total: rockRows.length,
      },
      todoReview: { due: due.length, done: doneByEnd, percent: due.length ? Math.round((doneByEnd / due.length) * 100) : null },
      newTodos: ((newTodos.data ?? []) as Owned[]).map((t) => ({ title: t.title, due_on: t.due_on ?? null, owner: owner(t.owner_id) })),
      solved: ((solved.data ?? []) as Owned[]).map((i) => ({ title: i.title, owner: owner(i.owner_id) })),
      open: ((open.data ?? []) as Owned[]).map((i) => ({ title: i.title, owner: owner(i.owner_id) })),
    },
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu 26 Nov 2026". */
export function recapDateLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** The parts both the Slack recap and the headline say, as plain text lines. */
export function recapSummaryLines(r: MeetingRecap): {
  rating: string;
  rocks: string;
  todos: string;
  newTodos: string;
  solved: string;
} {
  const owners = [...new Set(r.newTodos.map((t) => t.owner ?? "no owner"))];
  return {
    rating: r.averageRating === null ? "No ratings given" : `Average rating ${r.averageRating}/10 (${r.ratedCount} rated)`,
    rocks: r.rocks.total
      ? `Rocks: ${r.rocks.onTrack} on track, ${r.rocks.offTrack} off track${r.rocks.done ? `, ${r.rocks.done} done` : ""}`
      : "Rocks: none this quarter",
    todos:
      r.todoReview.percent === null
        ? "To-dos: none were due"
        : `To-dos done: ${r.todoReview.percent}% (${r.todoReview.done} of ${r.todoReview.due})`,
    newTodos: r.newTodos.length ? `New to-dos: ${r.newTodos.length} (${owners.join(", ")})` : "New to-dos: none",
    solved: r.solved.length ? `Issues solved: ${r.solved.map((i) => i.title).join("; ")}` : "Issues solved: none",
  };
}

/** The cross-team headline: plain text, one fact per line. */
export function recapHeadlineBody(r: MeetingRecap): string {
  const l = recapSummaryLines(r);
  return [`${r.teamName} L10 on ${recapDateLabel(r.date)}`, l.rocks, l.todos, l.solved, l.newTodos, l.rating].join("\n");
}
