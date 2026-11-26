// Running an L10 meeting: start, move to the next segment, end with ratings.
// All writes use the caller's session client, so 416's RLS applies.
// Only the Slack follow-up (lib/slack/l10-followup) uses the service role.
//
// 416 has no status or current-segment column. A meeting is running while
// ended_at is null, and segment_timings ({segue: {started_at, ended_at}, …})
// says where it is: the segment that has started and not ended.

import {
  L10_COLUMNS,
  L10_SEGMENTS,
  L10_TABLES,
  type L10Meeting,
  type L10MeetingAttendee,
  type L10Segment,
  type L10SegmentTimings,
} from "./types";
import type { MeetingEnd, MeetingStart, SegmentAdvance } from "./validate";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;
type DbError = { code?: string; message?: string };

export type MeetingRow = Pick<
  L10Meeting,
  "id" | "team_id" | "started_at" | "ended_at" | "facilitator_id" | "segment_timings" | "notes" | "recap_posted_at" | "followup_sent_at" | "created_by"
>;
export type AttendeeRow = Pick<L10MeetingAttendee, "id" | "team_id" | "meeting_id" | "profile_id" | "rating" | "followup_sent_at">;

export type MeetingResult<T> =
  | { ok: true; value: T }
  | { ok: false; kind: "not_found" | "conflict" | "bad_request" | "forbidden"; message: string; extra?: Record<string, unknown> }
  | { ok: false; kind: "db"; error: DbError };

/** The segment after `current`, or null at the end of the agenda. */
export function nextSegment(current: L10Segment | null): L10Segment | null {
  if (current === null) return L10_SEGMENTS[0];
  const i = L10_SEGMENTS.indexOf(current);
  if (i < 0 || i === L10_SEGMENTS.length - 1) return null;
  return L10_SEGMENTS[i + 1];
}

/** The segment that has started and not ended; the latest in agenda order wins. */
export function currentSegment(timings: L10SegmentTimings | null | undefined): L10Segment | null {
  let current: L10Segment | null = null;
  for (const s of L10_SEGMENTS) {
    const t = timings?.[s];
    if (t?.started_at && !t.ended_at) current = s;
  }
  return current;
}

export function withCurrentSegment<T extends { segment_timings: L10SegmentTimings | null }>(m: T) {
  return { ...m, current_segment: currentSegment(m.segment_timings) };
}

export function averageRating(attendees: readonly Pick<AttendeeRow, "rating">[]): number | null {
  const rated = attendees.map((a) => a.rating).filter((r): r is number => typeof r === "number");
  if (!rated.length) return null;
  return Math.round((rated.reduce((s, r) => s + r, 0) / rated.length) * 10) / 10;
}

export async function loadMeeting(
  supabase: Client,
  teamId: string,
  meetingId: string
): Promise<MeetingResult<{ meeting: MeetingRow; attendees: AttendeeRow[] }>> {
  const meeting = await supabase
    .from(L10_TABLES.meetings)
    .select(L10_COLUMNS.meetings)
    .eq("id", meetingId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (meeting.error) return { ok: false, kind: "db", error: meeting.error };
  if (!meeting.data) return { ok: false, kind: "not_found", message: "Meeting not found" };
  const attendees = await supabase
    .from(L10_TABLES.attendees)
    .select(L10_COLUMNS.attendees)
    .eq("team_id", teamId)
    .eq("meeting_id", meetingId);
  if (attendees.error) return { ok: false, kind: "db", error: attendees.error };
  return { ok: true, value: { meeting: meeting.data, attendees: attendees.data ?? [] } };
}

async function liveMeetings(supabase: Client, teamId: string) {
  return supabase
    .from(L10_TABLES.meetings)
    .select("id, started_at")
    .eq("team_id", teamId)
    .is("ended_at", null)
    .order("started_at", { ascending: true })
    .limit(5);
}

export async function startMeeting(
  supabase: Client,
  team: { id: string; facilitator_id: string | null },
  userId: string,
  input: MeetingStart,
  now: () => Date = () => new Date()
): Promise<MeetingResult<{ meeting: MeetingRow; attendees: AttendeeRow[] }>> {
  const teamId = team.id;
  const live = await liveMeetings(supabase, teamId);
  if (live.error) return { ok: false, kind: "db", error: live.error };
  if (live.data?.length) {
    return { ok: false, kind: "conflict", message: "This team already has a meeting running", extra: { meeting_id: live.data[0].id } };
  }

  const members = await supabase.from(L10_TABLES.members).select("profile_id").eq("team_id", teamId);
  if (members.error) return { ok: false, kind: "db", error: members.error };
  const memberIds = new Set<string>(((members.data ?? []) as { profile_id: string }[]).map((m) => m.profile_id));
  const attendeeIds = input.attendee_user_ids ?? [...memberIds];
  if (!attendeeIds.length) return { ok: false, kind: "bad_request", message: "The team has no members to meet" };
  if (attendeeIds.some((id) => !memberIds.has(id))) {
    return { ok: false, kind: "bad_request", message: "Every attendee must be a member of this team" };
  }
  const facilitator = input.facilitator_id ?? team.facilitator_id ?? userId;
  if (input.facilitator_id && !memberIds.has(input.facilitator_id)) {
    return { ok: false, kind: "bad_request", message: "The facilitator must be a member of this team" };
  }

  const at = now().toISOString();
  const created = await supabase
    .from(L10_TABLES.meetings)
    .insert({
      team_id: teamId,
      started_at: at,
      facilitator_id: facilitator,
      segment_timings: { [L10_SEGMENTS[0]]: { started_at: at, ended_at: null } },
      created_by: userId,
    })
    .select(L10_COLUMNS.meetings)
    .single();
  if (created.error) return { ok: false, kind: "db", error: created.error };
  const meeting = created.data as MeetingRow;

  // 416 has no unique index on a team's running meeting, so two starts can
  // race. The earliest stays; a later one removes itself.
  const after = await liveMeetings(supabase, teamId);
  if (!after.error && (after.data ?? []).length > 1 && after.data[0].id !== meeting.id) {
    await supabase.from(L10_TABLES.meetings).delete().eq("id", meeting.id).eq("team_id", teamId);
    return { ok: false, kind: "conflict", message: "This team already has a meeting running", extra: { meeting_id: after.data[0].id } };
  }

  const rows = attendeeIds.map((profile_id) => ({ team_id: teamId, meeting_id: meeting.id, profile_id }));
  const attendees = await supabase.from(L10_TABLES.attendees).insert(rows).select(L10_COLUMNS.attendees);
  if (attendees.error) {
    // Do not leave a running meeting nobody is in.
    await supabase.from(L10_TABLES.meetings).delete().eq("id", meeting.id).eq("team_id", teamId);
    return { ok: false, kind: "db", error: attendees.error };
  }
  return { ok: true, value: { meeting, attendees: attendees.data ?? [] } };
}

export async function advanceSegment(
  supabase: Client,
  teamId: string,
  meetingId: string,
  input: SegmentAdvance,
  now: () => Date = () => new Date()
): Promise<MeetingResult<{ meeting: MeetingRow }>> {
  const found = await supabase
    .from(L10_TABLES.meetings)
    .select(L10_COLUMNS.meetings)
    .eq("id", meetingId)
    .eq("team_id", teamId)
    .maybeSingle();
  if (found.error) return { ok: false, kind: "db", error: found.error };
  if (!found.data) return { ok: false, kind: "not_found", message: "Meeting not found" };
  const meeting = found.data as MeetingRow;
  if (meeting.ended_at) return { ok: false, kind: "conflict", message: "This meeting has ended" };
  const timings: L10SegmentTimings = meeting.segment_timings ?? {};
  const current = currentSegment(timings);
  if (input.from && input.from !== current) {
    return { ok: false, kind: "conflict", message: "The meeting has already moved on", extra: { current_segment: current } };
  }
  const next = nextSegment(current);
  if (!next) return { ok: false, kind: "bad_request", message: "This is the last segment. End the meeting instead." };

  const at = now().toISOString();
  const updated: L10SegmentTimings = { ...timings, [next]: { started_at: at, ended_at: null } };
  if (current) updated[current] = { ...timings[current], ended_at: at };

  // Compare-and-set: only while the next segment has not started, so two
  // clicks move it one step, not two.
  const moved = await supabase
    .from(L10_TABLES.meetings)
    .update({ segment_timings: updated })
    .eq("id", meetingId)
    .eq("team_id", teamId)
    .is("ended_at", null)
    .is(`segment_timings->${next}`, null)
    .select(L10_COLUMNS.meetings);
  if (moved.error) return { ok: false, kind: "db", error: moved.error };
  const row = (moved.data ?? [])[0];
  if (!row) return { ok: false, kind: "conflict", message: "The meeting has already moved on" };
  return { ok: true, value: { meeting: row } };
}

export type EndOutcome = {
  meeting: MeetingRow;
  attendees: AttendeeRow[];
  average_rating: number | null;
  /** True when this call did not end it: it was already ended (a retry, a double click, a late rating). */
  already_ended: boolean;
};

/**
 * End a running meeting and save ratings. Ending is a compare-and-set on
 * ended_at IS NULL, so one caller wins. Ratings only fill an empty rating,
 * never overwrite one, so a member can add their own after the end and a
 * repeat changes nothing.
 *
 * A member may rate only themself. A team leader, an overseer (both are
 * `canRateOthers`, from l10_can_manage_team) or the meeting's facilitator
 * may rate anyone who attended.
 */
export async function endMeeting(
  supabase: Client,
  teamId: string,
  meetingId: string,
  userId: string,
  input: MeetingEnd,
  opts: { canManage: boolean; now?: () => Date }
): Promise<MeetingResult<EndOutcome>> {
  const now = opts.now ?? (() => new Date());
  const loaded = await loadMeeting(supabase, teamId, meetingId);
  if (!loaded.ok) return loaded;
  const { meeting, attendees } = loaded.value;

  const attendeeIds = new Set(attendees.map((a) => a.profile_id));
  if (input.ratings.some((r) => !attendeeIds.has(r.user_id))) {
    return { ok: false, kind: "bad_request", message: "Only attendees of this meeting can be rated" };
  }
  const canRateOthers = opts.canManage || (!!meeting.facilitator_id && meeting.facilitator_id === userId);
  if (!canRateOthers && input.ratings.some((r) => r.user_id !== userId)) {
    return { ok: false, kind: "forbidden", message: "You can only give your own rating" };
  }

  let already = !!meeting.ended_at;
  if (!already) {
    const at = now().toISOString();
    const timings: L10SegmentTimings = { ...(meeting.segment_timings ?? {}) };
    const current = currentSegment(timings);
    if (current) timings[current] = { ...timings[current], ended_at: at };
    const ended = await supabase
      .from(L10_TABLES.meetings)
      .update({ ended_at: at, segment_timings: timings })
      .eq("id", meetingId)
      .eq("team_id", teamId)
      .is("ended_at", null)
      .select("id");
    if (ended.error) return { ok: false, kind: "db", error: ended.error };
    already = !(ended.data ?? []).length;
  }

  for (const r of input.ratings) {
    const saved = await supabase
      .from(L10_TABLES.attendees)
      .update({ rating: r.rating })
      .eq("team_id", teamId)
      .eq("meeting_id", meetingId)
      .eq("profile_id", r.user_id)
      .is("rating", null);
    if (saved.error) return { ok: false, kind: "db", error: saved.error };
  }

  const again = await loadMeeting(supabase, teamId, meetingId);
  if (!again.ok) return again;
  return {
    ok: true,
    value: {
      meeting: again.value.meeting,
      attendees: again.value.attendees,
      average_rating: averageRating(again.value.attendees),
      already_ended: already,
    },
  };
}
