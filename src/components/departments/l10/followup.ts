// Ending a meeting: the End body, the confirm-step summary and the sent view.
// All pure, so the follow-up contract is tested without a server.

import type { EndMeetingPayload, L10EndResponse, L10Issue, L10Todo } from "./types";

export interface Person {
  /** users.id (416's profile_id). */
  id: string;
  name: string;
}

export type RatingEntry = { user_id: string; rating: number | null | undefined };

export function isValidRating(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10;
}

/**
 * The POST body for .../end.
 *
 * Backend's parser currently allows only the key `ratings`, holding entries
 * of exactly `{ user_id, rating }`: user_id is users.id, rating an integer
 * 1–10, each attendee at most once. So an attendee who was not rated is left
 * out (never sent as null), and a repeated user_id is dropped here (the first
 * one wins) rather than sent for the server to reject.
 */
export function buildEndMeetingPayload(entries: readonly RatingEntry[]): EndMeetingPayload {
  const seen = new Set<string>();
  const ratings: EndMeetingPayload["ratings"] = [];
  for (const entry of entries) {
    if (!entry.user_id || seen.has(entry.user_id)) continue;
    seen.add(entry.user_id);
    if (!isValidRating(entry.rating)) continue;
    ratings.push({ user_id: entry.user_id, rating: entry.rating });
  }
  return { ratings };
}

/** Average of the ratings that exist, to one decimal. Null when nobody rated. */
export function averageRating(ratings: readonly (number | null | undefined)[]): number | null {
  const given = ratings.filter(isValidRating);
  if (given.length === 0) return null;
  const sum = given.reduce((total, value) => total + value, 0);
  return Math.round((sum / given.length) * 10) / 10;
}

export function formatAverage(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

// ── Recap counts ──────────────────────────────────────────────────────

export interface MeetingTotals {
  newTodos: number;
  issuesSolved: number;
  issuesKept: number;
}

export function meetingTotals(
  meetingId: string,
  todos: readonly L10Todo[],
  issues: readonly L10Issue[]
): MeetingTotals {
  return {
    newTodos: todos.filter((todo) => todo.source_meeting_id === meetingId).length,
    issuesSolved: issues.filter((issue) => issue.status === "solved" && issue.resolved_meeting_id === meetingId)
      .length,
    issuesKept: issues.filter((issue) => issue.status !== "solved").length,
  };
}

// ── Confirm step ──────────────────────────────────────────────────────

export interface PersonTodos {
  user_id: string;
  name: string;
  count: number;
}

export interface ConfirmSummary {
  /** People who get a DM with their open to-dos. */
  dmCount: number;
  /** 1 when the team has a recap channel, else 0. */
  recapPosts: number;
  issuesKept: number;
  unratedNames: string[];
  todosPerPerson: PersonTodos[];
}

/** Open to-dos per attendee, in attendee order. People with none are left out. */
export function todosPerPerson(attendees: readonly Person[], todos: readonly L10Todo[]): PersonTodos[] {
  const rows: PersonTodos[] = [];
  for (const person of attendees) {
    const count = todos.filter((todo) => !todo.done && todo.owner_id === person.id).length;
    if (count > 0) rows.push({ user_id: person.id, name: person.name, count });
  }
  return rows;
}

export function buildConfirmSummary(input: {
  attendees: readonly Person[];
  ratings: Readonly<Record<string, number | null | undefined>>;
  todos: readonly L10Todo[];
  issues: readonly L10Issue[];
  hasRecapChannel: boolean;
}): ConfirmSummary {
  const perPerson = todosPerPerson(input.attendees, input.todos);
  return {
    dmCount: perPerson.length,
    recapPosts: input.hasRecapChannel ? 1 : 0,
    issuesKept: input.issues.filter((issue) => issue.status !== "solved").length,
    unratedNames: input.attendees.filter((person) => !isValidRating(input.ratings[person.id])).map((p) => p.name),
    todosPerPerson: perPerson,
  };
}

// ── Sent view ─────────────────────────────────────────────────────────

export type DmStatus = "sent" | "failed" | "skipped" | "unknown";
export type RecapStatus = "posted" | "failed" | "skipped" | "unknown";

function normalise(outcome: unknown): string {
  return typeof outcome === "string" ? outcome.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
}

const SKIPPED = new Set(["skipped", "no_channel", "not_configured", "disabled", "no_slack", "no_todos"]);

/** sent / already-sent are a success; anything unrecognised is a failure. */
export function dmStatus(outcome: unknown): DmStatus {
  const value = normalise(outcome);
  if (value === "sent" || value === "already_sent") return "sent";
  if (!value) return "unknown";
  if (SKIPPED.has(value)) return "skipped";
  return "failed";
}

/** posted / already-posted are a success; anything unrecognised is a failure. */
export function recapStatus(outcome: unknown): RecapStatus {
  const value = normalise(outcome);
  if (value === "posted" || value === "already_posted") return "posted";
  if (!value) return "unknown";
  if (SKIPPED.has(value)) return "skipped";
  return "failed";
}

export interface SentPerson extends PersonTodos {
  status: DmStatus;
}

export interface SentView {
  people: SentPerson[];
  recap: RecapStatus;
  /** True when the server said the meeting had already ended (a retry). */
  alreadyEnded: boolean;
  average: number | null;
  ratedCount: number;
  totals: MeetingTotals;
  /** Open to-dos that carry over to next week. */
  carriedTodos: number;
}

/**
 * Read the End response. Only the outcome codes are used; no server text is
 * shown. People are the ones the confirm step promised a DM to, plus anyone
 * else the server reports on.
 */
export function readEndResponse(
  response: L10EndResponse,
  context: {
    meetingId: string;
    attendees: readonly Person[];
    ratings: Readonly<Record<string, number | null | undefined>>;
    todos: readonly L10Todo[];
    issues: readonly L10Issue[];
  }
): SentView {
  const results = new Map<string, string>();
  for (const result of response.followup?.results ?? []) {
    if (result && typeof result.user_id === "string") results.set(result.user_id, result.outcome);
  }
  const people: SentPerson[] = todosPerPerson(context.attendees, context.todos).map((row) => ({
    ...row,
    status: dmStatus(results.get(row.user_id)),
  }));
  const listed = new Set(people.map((row) => row.user_id));
  for (const [userId, outcome] of results) {
    if (listed.has(userId)) continue;
    const name = context.attendees.find((person) => person.id === userId)?.name ?? "Team member";
    people.push({ user_id: userId, name, count: 0, status: dmStatus(outcome) });
  }
  const given = context.attendees.map((person) => context.ratings[person.id]).filter(isValidRating);
  return {
    people,
    recap: recapStatus(response.recap?.outcome),
    alreadyEnded: response.already_ended === true,
    average: averageRating(given),
    ratedCount: given.length,
    totals: meetingTotals(context.meetingId, context.todos, context.issues),
    carriedTodos: context.todos.filter((todo) => !todo.done).length,
  };
}
