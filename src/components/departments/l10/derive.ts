// Pure view helpers: names, meeting times in the team's zone, scorecard
// status and the IDS lists. 416 has no issue category, so the IDS groups are
// derived here from priority and from matching titles.

import type { L10Headline, L10Issue, L10Measurable, L10MeasurableValue, L10Member, L10PersonName, L10Rock, L10Team, L10TeamDetail, L10Todo } from "./types";
import type { Person } from "./followup";

export const DEFAULT_ZONE = "Africa/Johannesburg";
const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

// ── People ────────────────────────────────────────────────────────────

export function personName(user: L10PersonName | null | undefined, fallback?: string | null): string {
  const given = fallback?.trim();
  if (given) return given;
  if (!user) return "Team member";
  const preferred = user.preferred_name?.trim();
  const first = user.first_name?.trim();
  const last = user.last_name?.trim();
  const combined = [preferred || first, last].filter(Boolean).join(" ");
  return combined || "Team member";
}

export function displayName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : "Team member";
}

export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function firstName(name: string | null | undefined): string {
  return displayName(name).split(/\s+/)[0] ?? "";
}

export function membersAsPeople(members: readonly L10Member[]): Person[] {
  return members.map((member) => ({ id: member.profile_id, name: personName(member.user, member.name) }));
}

/** The open meeting from a #741 running_meeting payload. */
export function runningMeetingOf(detail: Pick<L10TeamDetail, "running_meeting">) {
  return detail.running_meeting?.meeting ?? null;
}

export function isAutoHeadline(headline: Pick<L10Headline, "is_auto">): boolean {
  return headline.is_auto === true;
}

export function isShowingHeadline(headline: Pick<L10Headline, "dismissed_at">): boolean {
  return headline.dismissed_at == null;
}

/**
 * Auto recaps to show in Headlines: every showing auto row, and if none
 * are showing, the newest dismissed one so the person can Undo / Restore.
 */
export function recapHeadlines(headlines: readonly L10Headline[]): L10Headline[] {
  const autos = headlines.filter(isAutoHeadline);
  const showing = autos.filter(isShowingHeadline);
  if (showing.length > 0) return showing;
  const newest = [...autos].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return newest ? [newest] : [];
}

/**
 * Name of the paired team an auto headline recaps. Prefers a name on the
 * row, then the team's recap_source_team_id looked up in `teams`.
 */
export function recapSourceName(
  headline: Pick<L10Headline, "recap_source_team_name" | "is_auto">,
  team: Pick<L10Team, "recap_source_team_id"> | null | undefined,
  teams: readonly Pick<L10Team, "id" | "name">[] = []
): string | null {
  const named = headline.recap_source_team_name?.trim();
  if (named) return named;
  const id = team?.recap_source_team_id;
  if (!id) return null;
  return teams.find((item) => item.id === id)?.name ?? null;
}

export function visibleHeadlines(headlines: readonly L10Headline[]): L10Headline[] {
  return headlines.filter(isShowingHeadline);
}

export function nameOf(id: string | null | undefined, people: readonly Person[]): string | null {
  if (!id) return null;
  return people.find((person) => person.id === id)?.name ?? null;
}

// ── Time in the team's zone ───────────────────────────────────────────

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** ISO weekday 1–7. */
  weekday: number;
}

function wall(instant: number, timeZone: string): Wall {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    }).formatToParts(new Date(instant));
  } catch {
    return wall(instant, DEFAULT_ZONE);
  }
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = WEEKDAYS.indexOf(read("weekday").slice(0, 3) as (typeof WEEKDAYS)[number]) + 1;
  const hour = Number(read("hour"));
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: hour === 24 ? 0 : hour,
    minute: Number(read("minute")),
    weekday,
  };
}

/** The instant a wall-clock time in `timeZone` happens. */
export function zonedToInstant(
  date: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  timeZone: string
): number {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const seen = wall(guess, timeZone);
  const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  return guess - (seenUtc - guess);
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(date: { year: number; month: number; day: number }, days: number) {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function parseTime(value: string | null): { hour: number; minute: number } | null {
  const match = value ? /^(\d{1,2}):(\d{2})/.exec(value) : null;
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function zoneOf(team: Pick<L10Team, "meeting_timezone">): string {
  return team.meeting_timezone || DEFAULT_ZONE;
}

/** Today's calendar date in the zone, 'YYYY-MM-DD'. */
export function todayIn(now: number, timeZone = DEFAULT_ZONE): string {
  const w = wall(now, timeZone);
  return ymd(w.year, w.month, w.day);
}

/**
 * The next scheduled start at or after `now`. A meeting that started earlier
 * today rolls to next week. Null when the team has no day or time set.
 */
export function nextMeetingStart(
  team: Pick<L10Team, "meeting_weekday" | "meeting_time" | "meeting_timezone">,
  now: number
): number | null {
  const time = parseTime(team.meeting_time);
  if (!team.meeting_weekday || !time) return null;
  const zone = zoneOf(team);
  const today = wall(now, zone);
  const delta = (team.meeting_weekday - today.weekday + 7) % 7;
  const start = zonedToInstant(addDays(today, delta), time.hour, time.minute, zone);
  return start >= now ? start : zonedToInstant(addDays(today, delta + 7), time.hour, time.minute, zone);
}

/**
 * Default due date for a new to-do: the next L10 day after today, so a to-do
 * added in today's meeting is due at next week's. Without a set day, a week.
 */
export function nextL10Date(team: Pick<L10Team, "meeting_weekday" | "meeting_timezone">, now: number): string {
  const zone = zoneOf(team);
  const today = wall(now, zone);
  const delta = team.meeting_weekday ? (team.meeting_weekday - today.weekday + 7) % 7 || 7 : 7;
  const due = addDays(today, delta);
  return ymd(due.year, due.month, due.day);
}

/** "Tue 1 Dec". */
export function formatDay(instant: number, timeZone = DEFAULT_ZONE): string {
  const w = wall(instant, timeZone);
  return `${WEEKDAYS[w.weekday - 1] ?? ""} ${w.day} ${MONTHS[w.month - 1] ?? ""}`.trim();
}

/** "09:00". */
export function formatHm(instant: number, timeZone = DEFAULT_ZONE): string {
  const w = wall(instant, timeZone);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
}

/** 'YYYY-MM-DD' → "1 Dec". */
export function formatDueDay(value: string | null): string | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1] ?? ""}`;
}

/** "Tuesday weekly · 09:00", or null if not scheduled. */
export function scheduleLabel(team: Pick<L10Team, "meeting_weekday" | "meeting_time">): string | null {
  const time = parseTime(team.meeting_time);
  if (!team.meeting_weekday || !time) return null;
  const day = WEEKDAYS[team.meeting_weekday - 1];
  return `${day} · ${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

// ── Scorecard ─────────────────────────────────────────────────────────

/** Monday (YYYY-MM-DD) of the week before the one `now` is in: the week the meeting reports on. */
export function reportWeek(now: number, timeZone = DEFAULT_ZONE): string {
  const today = wall(now, timeZone);
  const monday = addDays(today, -(today.weekday - 1) - 7);
  return ymd(monday.year, monday.month, monday.day);
}

export function weeksBefore(week: string, count: number): string[] {
  const [y, m, d] = week.split("-").map(Number) as [number, number, number];
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const day = addDays({ year: y, month: m, day: d }, -7 * i);
    out.push(ymd(day.year, day.month, day.day));
  }
  return out;
}

export type MeasureStatus = "on" | "off" | "not_marked";

export function measureStatus(measurable: L10Measurable, value: number | null | undefined): MeasureStatus {
  if (value == null) return "not_marked";
  const goal = measurable.goal_value;
  if (goal == null) return "on";
  const v = Number(value);
  const g = Number(goal);
  switch (measurable.goal_direction) {
    case "at_least":
      return v >= g ? "on" : "off";
    case "at_most":
      return v <= g ? "on" : "off";
    case "exactly":
      return v === g ? "on" : "off";
  }
}

function plain(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatMeasure(measurable: Pick<L10Measurable, "unit">, value: number | null | undefined): string {
  if (value == null) return "—";
  const v = Number(value);
  switch (measurable.unit) {
    case "yes_no":
      return v >= 1 ? "Yes" : "No";
    case "percent":
      return `${plain(v)}%`;
    case "currency":
      return `R${Math.round(v).toLocaleString("en-US").replace(/,/g, " ")}`;
    case "number":
      return plain(v);
  }
}

export function goalLabel(measurable: L10Measurable): string {
  if (measurable.goal_value == null) return "No target";
  const target = formatMeasure(measurable, measurable.goal_value);
  if (measurable.unit === "yes_no") return target;
  const sign = measurable.goal_direction === "at_least" ? "≥" : measurable.goal_direction === "at_most" ? "≤" : "=";
  return `${sign} ${target}`;
}

export interface ScoreRow {
  measurable: L10Measurable;
  value: number | null;
  status: MeasureStatus;
  /** Oldest first, report week last. Null where not entered. */
  trend: (number | null)[];
}

export function scoreRows(
  measurables: readonly L10Measurable[],
  values: readonly L10MeasurableValue[],
  week: string
): ScoreRow[] {
  const weeks = weeksBefore(week, 4);
  return measurables
    .filter((m) => m.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((measurable) => {
      const of = (w: string) =>
        values.find((v) => v.measurable_id === measurable.id && v.week_start === w)?.value ?? null;
      const value = of(week);
      return { measurable, value, status: measureStatus(measurable, value), trend: weeks.map(of) };
    });
}

/** True when any trend has at least two entered values. */
export function hasTrend(rows: readonly ScoreRow[]): boolean {
  return rows.some((row) => row.trend.filter((v) => v != null).length >= 2);
}

// ── Team stats ────────────────────────────────────────────────────────

export interface TeamStats {
  openIssues: number;
  openTodos: number;
  rocksOnTrack: number;
  rocksTotal: number;
}

export function teamStats(detail: Pick<L10TeamDetail, "issues" | "todos" | "rocks">): TeamStats {
  return {
    openIssues: detail.issues.filter((issue) => issue.status !== "solved").length,
    openTodos: detail.todos.filter((todo) => !todo.done).length,
    rocksOnTrack: detail.rocks.filter((rock) => rock.status !== "off_track").length,
    rocksTotal: detail.rocks.length,
  };
}

// ── IDS ───────────────────────────────────────────────────────────────

function key(text: string): string {
  return text.trim().toLowerCase();
}

export function issueFor(title: string, issues: readonly L10Issue[]): L10Issue | undefined {
  const k = key(title);
  return issues.find((issue) => issue.status !== "solved" && key(issue.title) === k);
}

export type IdsRow =
  | { kind: "issue"; issue: L10Issue }
  | { kind: "rock"; rock: L10Rock }
  | { kind: "todo"; todo: L10Todo };

export interface IdsGroups {
  /** Ranked 1–3: urgent and important, this week. */
  urgent: IdsRow[];
  offTrackRocks: IdsRow[];
  incompleteTodos: IdsRow[];
  /** Everything else that's open: not urgent, important, talk it through. */
  talk: IdsRow[];
}

/**
 * Groups for the IDS segment. An issue whose title matches an off-track rock
 * or an unfinished carried-over to-do sits with it; a rock or to-do with no
 * issue yet is listed so it can be raised in one tap. Issues solved in this
 * meeting stay in place, marked solved.
 */
export function idsGroups(input: {
  meetingId: string;
  meetingStartedAt: string;
  issues: readonly L10Issue[];
  rocks: readonly L10Rock[];
  todos: readonly L10Todo[];
}): IdsGroups {
  const visible = input.issues.filter(
    (issue) => issue.status !== "solved" || issue.resolved_meeting_id === input.meetingId
  );
  const offRocks = input.rocks.filter((rock) => rock.status === "off_track");
  const carried = input.todos.filter((todo) => !todo.done && todo.created_at < input.meetingStartedAt);
  const rockKeys = new Set(offRocks.map((rock) => key(rock.title)));
  const todoKeys = new Set(carried.map((todo) => key(todo.title)));

  const urgent = visible
    .filter((issue) => issue.priority != null)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  const unranked = visible.filter((issue) => issue.priority == null);
  const byRock = unranked.filter((issue) => rockKeys.has(key(issue.title)));
  const byTodo = unranked.filter((issue) => !rockKeys.has(key(issue.title)) && todoKeys.has(key(issue.title)));
  const talk = unranked.filter((issue) => !rockKeys.has(key(issue.title)) && !todoKeys.has(key(issue.title)));
  const raised = new Set(visible.map((issue) => key(issue.title)));

  const asIssue = (issue: L10Issue): IdsRow => ({ kind: "issue", issue });
  return {
    urgent: urgent.map(asIssue),
    offTrackRocks: [
      ...byRock.map(asIssue),
      ...offRocks.filter((rock) => !raised.has(key(rock.title))).map((rock): IdsRow => ({ kind: "rock", rock })),
    ],
    incompleteTodos: [
      ...byTodo.map(asIssue),
      ...carried.filter((todo) => !raised.has(key(todo.title))).map((todo): IdsRow => ({ kind: "todo", todo })),
    ],
    talk: talk.map(asIssue),
  };
}

/** Open issues in the order they get discussed. */
export function discussionOrder(groups: IdsGroups): L10Issue[] {
  return [...groups.urgent, ...groups.offTrackRocks, ...groups.incompleteTodos, ...groups.talk]
    .flatMap((row) => (row.kind === "issue" && row.issue.status !== "solved" ? [row.issue] : []));
}

/**
 * Patches that give `issueId` rank `rank` (or clear it with null). Whoever
 * held that rank gives it up, so there is one issue per rank.
 */
export function rankChanges(
  issues: readonly L10Issue[],
  issueId: string,
  rank: number | null
): { id: string; priority: number | null }[] {
  const changes: { id: string; priority: number | null }[] = [];
  if (rank != null) {
    for (const issue of issues) {
      if (issue.id !== issueId && issue.priority === rank && issue.status !== "solved") {
        changes.push({ id: issue.id, priority: null });
      }
    }
  }
  changes.push({ id: issueId, priority: rank });
  return changes;
}
