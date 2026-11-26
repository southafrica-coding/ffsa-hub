// Browser client for the L10 route handlers in Hub Backend PR #741.
// Every path is built here, so a route change is one edit. Server text is
// never passed on: failures become a kind, and field errors become our own
// wording for fields we know.

import type {
  EndMeetingPayload,
  IssuePatch,
  L10Attendee,
  L10EndResponse,
  L10Headline,
  AutoHeadlineOutcome,
  L10Issue,
  L10Meeting,
  L10MeetingDetail,
  L10RunningMeeting,
  L10Member,
  L10PersonName,
  L10Segment,
  L10Team,
  L10TeamDetail,
  L10TeamsResponse,
  L10Todo,
  NewHeadlineInput,
  NewIssueInput,
  NewMeasurableValueInput,
  NewTodoInput,
} from "./types";
import {
  L10_AUTO_HEADLINE_FIELD,
  L10_AUTO_HEADLINE_LOCKED,
  L10_MEETING_ALREADY_OPEN,
  L10_ONE_AUTO_RECAP,
  L10_RATING_NOT_ALLOWED,
} from "./types";
import { personName } from "./derive";

export {
  L10_AUTO_HEADLINE_FIELD,
  L10_AUTO_HEADLINE_LOCKED,
  L10_MEETING_ALREADY_OPEN,
  L10_ONE_AUTO_RECAP,
  L10_RATING_NOT_ALLOWED,
};

export type FailureKind = "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid" | "error";

export type ApiFailure = {
  ok: false;
  kind: FailureKind;
  fieldErrors: Record<string, string>;
  /** Machine-readable #741 `code`. Null when the body had none. */
  code: string | null;
  /** Open meeting id, when the code is l10_meeting_already_open. */
  meetingId: string | null;
};

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

/** Our copy for each known #741 `code`. The server's `error` text is never used. */
export const CODE_COPY: Record<string, string> = {
  [L10_MEETING_ALREADY_OPEN]: "This team already has a meeting running.",
  [L10_AUTO_HEADLINE_LOCKED]: "This headline can't be edited or deleted. Dismiss it instead.",
  [L10_AUTO_HEADLINE_FIELD]: "That field is set by the Hub, not by a person on the team.",
  [L10_RATING_NOT_ALLOWED]: "You can only set your own rating.",
  [L10_ONE_AUTO_RECAP]: "This meeting already has that recap.",
};

/** Reads `code` only — never `error`. */
export function readErrorCode(body: unknown): string | null {
  if (!isRecord(body)) return null;
  return typeof body.code === "string" && body.code.length > 0 ? body.code : null;
}

export function readMeetingId(body: unknown): string | null {
  if (!isRecord(body) || typeof body.meeting_id !== "string" || body.meeting_id.length === 0) return null;
  return body.meeting_id;
}

/** Friendly copy for a known code, or null. Never returns the server's `error` string. */
export function copyForCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return CODE_COPY[code] ?? null;
}

/**
 * Map a JSON error body to our copy by `code` only. A body with only `error`
 * (or an unknown code) yields null, so the caller can fall back to kind copy.
 */
export function copyFromErrorBody(body: unknown): string | null {
  return copyForCode(readErrorCode(body));
}

function apiFailure(status: number, body: unknown): ApiFailure {
  return {
    ok: false,
    kind: kindFor(status),
    fieldErrors: mapFieldErrors(body),
    code: readErrorCode(body),
    meetingId: readMeetingId(body),
  };
}

function networkFailure(): ApiFailure {
  return { ok: false, kind: "error", fieldErrors: {}, code: null, meetingId: null };
}

/** Friendly copy when POST measurable_values hits 409 (unique week). */
export const WEEK_VALUE_EXISTS_COPY = "That week already has a number.";

const FIELD_COPY: Record<string, string> = {
  title: "Say what it is.",
  body: "Say what it is.",
  owner_id: "Pick someone on the team.",
  author_id: "Pick someone on the team.",
  due_on: "Pick a valid date.",
  priority: "Rank 1, 2 or 3.",
  ratings: "Ratings are whole numbers from 1 to 10.",
  rating: "Ratings are whole numbers from 1 to 10.",
  from: "The meeting has moved on. Refresh to catch up.",
  week_start: "Pick a Monday.",
  measurable_id: "Pick a scorecard row.",
  value: "Enter a number.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Our copy for each known field the server flagged. Unknown fields stay hidden. */
export function mapFieldErrors(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(body) || !isRecord(body.fieldErrors)) return out;
  for (const field of Object.keys(body.fieldErrors)) {
    const copy = FIELD_COPY[field];
    if (copy) out[field] = copy;
  }
  return out;
}

/**
 * 409 on a scorecard week value. The unique key is (measurable_id, week_start).
 * Always our copy — never the server's "That already exists" (or any other) text.
 */
export function weekValueConflictResult(): ApiFailure {
  return { ok: false, kind: "conflict", fieldErrors: { week_start: WEEK_VALUE_EXISTS_COPY }, code: null, meetingId: null };
}

function kindFor(status: number): FailureKind {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "invalid";
  return "error";
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function send(path: string, init: RequestInit): Promise<{ status: number; ok: boolean; body: unknown } | null> {
  try {
    const response = await fetch(path, {
      ...init,
      credentials: "include",
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
      cache: "no-store",
    });
    return { status: response.status, ok: response.ok, body: await readBody(response) };
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const response = await send(path, init);
  if (!response) return networkFailure();
  if (!response.ok) return apiFailure(response.status, response.body);
  return { ok: true, data: response.body as T };
}

/** End already happened: the boolean field or a `code`, never the `error` text. */
function saysAlreadyEnded(body: unknown): boolean {
  if (!isRecord(body)) return false;
  return body.already_ended === true || body.code === "already_ended";
}

/**
 * Reads the End response. A retry after the meeting ended (200 with
 * already_ended, or a 409 carrying that code) is still a result: whatever
 * follow-up outcomes it reports are shown, and missing ones read as unknown.
 */
export function readEndResult(response: { status: number; ok: boolean; body: unknown } | null): ApiResult<L10EndResponse> {
  if (!response) return networkFailure();
  const body = isRecord(response.body) ? response.body : {};
  if (response.ok || (response.status === 409 && saysAlreadyEnded(body))) {
    const followup = isRecord(body.followup) && Array.isArray(body.followup.results)
      ? {
          results: body.followup.results.flatMap((row: unknown) =>
            isRecord(row) && typeof row.user_id === "string"
              ? [{ user_id: row.user_id, outcome: typeof row.outcome === "string" ? row.outcome : "" }]
              : []
          ),
        }
      : null;
    const recap = isRecord(body.recap) && typeof body.recap.outcome === "string" ? { outcome: body.recap.outcome } : null;
    const meeting = isRecord(body.meeting) ? normalizeMeeting(body.meeting) : undefined;
    return { ok: true, data: { meeting, already_ended: saysAlreadyEnded(body), followup, recap } };
  }
  return apiFailure(response.status, body);
}

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeMeeting(raw: unknown): L10Meeting {
  const row = isRecord(raw) ? raw : {};
  const timings = isRecord(row.segment_timings) ? row.segment_timings : {};
  const current = row.current_segment;
  return {
    ...(row as unknown as L10Meeting),
    segment_timings: timings as L10Meeting["segment_timings"],
    current_segment:
      typeof current === "string" && current.length > 0 ? (current as L10Meeting["current_segment"]) : null,
  };
}

function named(user: L10PersonName | null | undefined, fallback?: string | null): string | null {
  const name = personName(user, fallback);
  return name === "Team member" && !fallback && !user ? null : name;
}

function normalizeMember(raw: L10Member): L10Member {
  return { ...raw, name: named(raw.user, raw.name) ?? raw.name ?? null };
}

function normalizeAttendee(raw: L10Attendee): L10Attendee {
  return { ...raw, name: named(raw.user, raw.name) ?? raw.name ?? null };
}

function normalizeRunning(raw: unknown): L10RunningMeeting | null {
  if (!isRecord(raw)) return null;
  if (isRecord(raw.meeting) && typeof raw.meeting.id === "string") {
    return {
      meeting: normalizeMeeting(raw.meeting),
      attendees: asList<L10Attendee>(raw.attendees).map(normalizeAttendee),
      headlines: asList<L10Headline>(raw.headlines),
    };
  }
  // Tolerate a bare meeting row if an older stub ever sent one.
  if (typeof raw.id === "string" && typeof raw.started_at === "string") {
    return { meeting: normalizeMeeting(raw), attendees: [], headlines: [] };
  }
  return null;
}

const AUTO_OUTCOMES: readonly AutoHeadlineOutcome[] = [
  "inserted",
  "exists",
  "no-source-team",
  "no-ended-source-meeting",
  "meeting-ended",
  "not-found",
  "error",
];

function normalizeAutoOutcome(value: unknown): AutoHeadlineOutcome | null {
  return typeof value === "string" && (AUTO_OUTCOMES as readonly string[]).includes(value)
    ? (value as AutoHeadlineOutcome)
    : null;
}

function normalizeHeadline(raw: L10Headline): L10Headline {
  return {
    ...raw,
    is_auto: raw.is_auto === true,
    recap_of_meeting_id: raw.recap_of_meeting_id ?? null,
    dismissed_at: raw.dismissed_at ?? null,
  };
}

export function normalizeTeamDetail(raw: unknown, listedHeadlines?: L10Headline[]): L10TeamDetail {
  const row = isRecord(raw) ? raw : {};
  const running = normalizeRunning(row.running_meeting);
  const fromRunning = running?.headlines ?? [];
  const listed = listedHeadlines ?? asList<L10Headline>(row.headlines);
  const byId = new Map<string, L10Headline>();
  for (const headline of [...fromRunning, ...listed]) {
    if (headline?.id) byId.set(headline.id, normalizeHeadline(headline));
  }
  return {
    team: row.team as L10Team,
    my_role: (row.my_role as L10TeamDetail["my_role"]) ?? null,
    access: isRecord(row.access) ? (row.access as L10TeamDetail["access"]) : undefined,
    quarter: typeof row.quarter === "string" ? row.quarter : undefined,
    members: asList<L10Member>(row.members).map(normalizeMember),
    rocks: asList(row.rocks),
    measurables: asList(row.measurables),
    measurable_values: asList(row.measurable_values ?? row.values),
    todos: asList(row.todos),
    issues: asList(row.issues),
    headlines: [...byId.values()],
    running_meeting: running
      ? { ...running, headlines: running.headlines.map(normalizeHeadline) }
      : null,
    recent_meetings: asList(row.recent_meetings).map(normalizeMeeting),
  };
}

export function normalizeMeetingDetail(raw: unknown): L10MeetingDetail {
  const row = isRecord(raw) ? raw : {};
  return {
    meeting: normalizeMeeting(row.meeting ?? row),
    attendees: asList<L10Attendee>(row.attendees).map(normalizeAttendee),
    average_rating: typeof row.average_rating === "number" ? row.average_rating : null,
    headlines: asList<L10Headline>(row.headlines).map(normalizeHeadline),
    auto_headline: normalizeAutoOutcome(row.auto_headline),
  };
}

/** API paths as #741 serves them. Page URLs stay /departments/[slug]/l10/[teamId]. */
export function l10Paths(slug: string) {
  const base = `/api/departments/${encodeURIComponent(slug)}/l10`;
  const team = (teamId: string) => `${base}/teams/${encodeURIComponent(teamId)}`;
  const kind = (teamId: string, itemKind: string) => `${team(teamId)}/${itemKind}`;
  const item = (teamId: string, itemKind: string, id: string) =>
    `${kind(teamId, itemKind)}/${encodeURIComponent(id)}`;
  const meeting = (teamId: string, meetingId: string) =>
    `${team(teamId)}/meetings/${encodeURIComponent(meetingId)}`;
  return {
    teams: base,
    team,
    meetings: (teamId: string) => `${team(teamId)}/meetings`,
    meeting,
    advance: (teamId: string, meetingId: string) => `${meeting(teamId, meetingId)}/advance`,
    end: (teamId: string, meetingId: string) => `${meeting(teamId, meetingId)}/end`,
    kind,
    item,
    todos: (teamId: string) => kind(teamId, "todos"),
    todo: (teamId: string, id: string) => item(teamId, "todos", id),
    issues: (teamId: string) => kind(teamId, "issues"),
    issue: (teamId: string, id: string) => item(teamId, "issues", id),
    headlines: (teamId: string) => kind(teamId, "headlines"),
    headline: (teamId: string, id: string) => item(teamId, "headlines", id),
    headlineDismiss: (teamId: string, id: string) => `${item(teamId, "headlines", id)}/dismiss`,
    measurableValues: (teamId: string) => kind(teamId, "measurable_values"),
    measurableValue: (teamId: string, id: string) => item(teamId, "measurable_values", id),
  };
}

/** Page URLs. Slack follow-up buttons link to `team`. */
export function l10Pages(slug: string) {
  const base = `/departments/${encodeURIComponent(slug)}/l10`;
  return {
    department: `/departments/${encodeURIComponent(slug)}`,
    teams: base,
    team: (teamId: string) => `${base}/${encodeURIComponent(teamId)}`,
    meeting: (teamId: string, meetingId: string) =>
      `${base}/${encodeURIComponent(teamId)}/meetings/${encodeURIComponent(meetingId)}`,
  };
}

export function createL10Api(slug: string) {
  const paths = l10Paths(slug);
  return {
    async listTeams(): Promise<ApiResult<L10TeamsResponse>> {
      const result = await request<L10TeamsResponse | L10TeamsResponse["teams"]>(paths.teams);
      if (!result.ok) return result;
      const data = Array.isArray(result.data) ? { teams: result.data } : result.data;
      return { ok: true, data: { ...data, teams: Array.isArray(data?.teams) ? data.teams : [] } };
    },
    async getTeam(teamId: string): Promise<ApiResult<L10TeamDetail>> {
      const [team, headlines] = await Promise.all([
        request<unknown>(paths.team(teamId)),
        request<{ headlines?: L10Headline[] }>(paths.headlines(teamId)),
      ]);
      if (!team.ok) return team;
      return {
        ok: true,
        data: normalizeTeamDetail(team.data, headlines.ok ? headlines.data.headlines : undefined),
      };
    },
    async startMeeting(teamId: string): Promise<ApiResult<{ meeting: L10Meeting; attendees?: L10Attendee[] }>> {
      const result = await request<{ meeting: L10Meeting; attendees?: L10Attendee[] }>(paths.meetings(teamId), {
        method: "POST",
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          meeting: normalizeMeeting(result.data.meeting),
          attendees: result.data.attendees?.map(normalizeAttendee),
        },
      };
    },
    async getMeeting(teamId: string, meetingId: string): Promise<ApiResult<L10MeetingDetail>> {
      const result = await request<unknown>(paths.meeting(teamId, meetingId));
      if (!result.ok) return result;
      return { ok: true, data: normalizeMeetingDetail(result.data) };
    },
    /** `from` makes a double tap move once: the second call no longer matches. */
    async advance(teamId: string, meetingId: string, from: L10Segment): Promise<ApiResult<{ meeting: L10Meeting }>> {
      const result = await request<{ meeting: L10Meeting }>(paths.advance(teamId, meetingId), json("POST", { from }));
      if (!result.ok) return result;
      return { ok: true, data: { meeting: normalizeMeeting(result.data.meeting) } };
    },
    async end(teamId: string, meetingId: string, payload: EndMeetingPayload): Promise<ApiResult<L10EndResponse>> {
      return readEndResult(await send(paths.end(teamId, meetingId), json("POST", payload)));
    },
    addTodo: (teamId: string, input: NewTodoInput) =>
      request<{ todo: L10Todo }>(paths.todos(teamId), json("POST", input)),
    setTodoDone: (teamId: string, id: string, done: boolean) =>
      request<{ todo: L10Todo }>(paths.todo(teamId, id), json("PATCH", { done })),
    addIssue: (teamId: string, input: NewIssueInput) =>
      request<{ issue: L10Issue }>(paths.issues(teamId), json("POST", input)),
    updateIssue: (teamId: string, id: string, patch: IssuePatch) =>
      request<{ issue: L10Issue }>(paths.issue(teamId, id), json("PATCH", patch)),
    /** 416 has no dropped status, so Drop deletes the issue. */
    deleteIssue: (teamId: string, id: string) => request<unknown>(paths.issue(teamId, id), { method: "DELETE" }),
    addHeadline: (teamId: string, input: NewHeadlineInput) =>
      request<{ headline: L10Headline }>(paths.headlines(teamId), json("POST", input)),
    /** POST .../headlines/:id/dismiss sets dismissed_at. */
    dismissHeadline: (teamId: string, id: string) =>
      request<{ headline: L10Headline }>(paths.headlineDismiss(teamId, id), { method: "POST" }),
    /** DELETE .../headlines/:id/dismiss clears dismissed_at (Undo / Restore). */
    restoreHeadline: (teamId: string, id: string) =>
      request<{ headline: L10Headline }>(paths.headlineDismiss(teamId, id), { method: "DELETE" }),
    async addMeasurableValue(
      teamId: string,
      input: NewMeasurableValueInput
    ): Promise<ApiResult<{ measurable_value: unknown }>> {
      const response = await send(paths.measurableValues(teamId), json("POST", input));
      if (!response) return networkFailure();
      if (response.status === 409) return weekValueConflictResult();
      if (!response.ok) return apiFailure(response.status, response.body);
      return { ok: true, data: response.body as { measurable_value: unknown } };
    },
  };
}

export type L10Api = ReturnType<typeof createL10Api>;
