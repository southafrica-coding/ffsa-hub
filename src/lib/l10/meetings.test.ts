import { describe, expect, it } from "vitest";
import { advanceSegment, averageRating, currentSegment, endMeeting, nextSegment, startMeeting } from "./meetings";
import { L10_SEGMENTS } from "./types";
import { parseItemCreate, parseItemPatch, parseMeetingEnd, parseMeetingStart, parseSegmentAdvance } from "./validate";
import { LEAD, LIVE_ONLY, NOSLACK, PRODUCTION, SINGER, makeWorld, pwRls } from "./testing/world";

const TEAM = { id: PRODUCTION, facilitator_id: null };

function session(userId = LEAD) {
  const db = makeWorld();
  return { db, s: db.client({ userId, rls: pwRls(db.tables) }) };
}

async function started(s: unknown, userId = LEAD, facilitator: string | null = null) {
  const r = await startMeeting(s, TEAM, userId, { attendee_user_ids: null, facilitator_id: facilitator });
  if (!r.ok) throw new Error(`start failed: ${JSON.stringify(r)}`);
  return r.value.meeting.id;
}

describe("segment order", () => {
  it("runs the EOS agenda in 416's order and stops at conclude", () => {
    expect(L10_SEGMENTS).toEqual(["segue", "scorecard", "rock_review", "headlines", "todo_list", "ids", "conclude"]);
    expect(nextSegment(null)).toBe("segue");
    expect(nextSegment("ids")).toBe("conclude");
    expect(nextSegment("conclude")).toBeNull();
    expect(currentSegment({})).toBeNull();
    expect(currentSegment({ segue: { started_at: "a", ended_at: "b" }, scorecard: { started_at: "b", ended_at: null } })).toBe("scorecard");
  });

  it("advances one step at a time through every segment, timing each, then refuses", async () => {
    const { s, db } = session();
    const id = await started(s);
    const seen: (string | null)[] = [currentSegment(db.tables.l10_meetings[0].segment_timings as never)];
    for (let i = 1; i < L10_SEGMENTS.length; i++) {
      const moved = await advanceSegment(s, PRODUCTION, id, { from: null });
      if (!moved.ok) throw new Error("advance failed");
      seen.push(currentSegment(moved.value.meeting.segment_timings));
    }
    expect(seen).toEqual([...L10_SEGMENTS]);
    const timings = db.tables.l10_meetings[0].segment_timings as Record<string, { started_at: string; ended_at: string | null }>;
    expect(Object.keys(timings)).toEqual([...L10_SEGMENTS]);
    expect(L10_SEGMENTS.slice(0, -1).every((k) => timings[k].started_at && timings[k].ended_at)).toBe(true);
    expect(await advanceSegment(s, PRODUCTION, id, { from: null })).toMatchObject({ ok: false, kind: "bad_request" });
  });

  it("moves once when two clicks race, and refuses a stale from", async () => {
    const { s } = session();
    const id = await started(s);
    const [a, b] = await Promise.all([
      advanceSegment(s, PRODUCTION, id, { from: "segue" }),
      advanceSegment(s, PRODUCTION, id, { from: "segue" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(a.ok ? b : a).toMatchObject({ ok: false, kind: "conflict" });
    const stale = await advanceSegment(s, PRODUCTION, id, { from: "segue" });
    expect(stale).toMatchObject({ ok: false, kind: "conflict", extra: { current_segment: "scorecard" } });
  });

  it("advances into a segment whose key is there but not started (started_at null)", async () => {
    const { s, db } = session();
    const id = await started(s);
    const m = db.tables.l10_meetings.find((x) => x.id === id)!;
    m.segment_timings = { ...(m.segment_timings as object), scorecard: { started_at: null, ended_at: null } };
    const moved = await advanceSegment(s, PRODUCTION, id, { from: "segue" });
    expect(moved.ok).toBe(true);
    expect((db.tables.l10_meetings.find((x) => x.id === id)!.segment_timings as Record<string, { started_at: string | null }>).scorecard.started_at).toBeTruthy();
    // And a started one is still refused by the same filter.
    const again = await advanceSegment(s, PRODUCTION, id, { from: null });
    expect(again.ok).toBe(true); // scorecard -> rocks
    expect(await advanceSegment(s, PRODUCTION, id, { from: "scorecard" })).toMatchObject({ ok: false, kind: "conflict" });
  });
});

/** 416's segment_timings rule: strict ISO-8601 with an offset, ended_at >= started_at. */
const ISO = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]{1,6})?)?(Z|[+-]([01][0-9]|2[0-3]):?[0-5][0-9])$/;
function expectValidTimings(m: Record<string, unknown>) {
  const timings = (m.segment_timings ?? {}) as Record<string, { started_at: string | null; ended_at: string | null }>;
  for (const t of Object.values(timings)) {
    for (const v of [t.started_at, t.ended_at]) if (v !== null) expect(v).toMatch(ISO);
    if (t.started_at && t.ended_at) expect(Date.parse(t.ended_at)).toBeGreaterThanOrEqual(Date.parse(t.started_at));
  }
  if (m.ended_at) expect(Date.parse(m.ended_at as string)).toBeGreaterThanOrEqual(Date.parse(m.started_at as string));
}

describe("timestamps 416 accepts", () => {
  it("never ends a segment or the meeting before it started, even when this server's clock is behind", async () => {
    const { s, db } = session();
    const t0 = new Date("2026-11-26T18:00:00.000Z");
    const behind = () => new Date(t0.getTime() - 5 * 60_000); // another server, 5 min behind
    const r = await startMeeting(s, TEAM, LEAD, { attendee_user_ids: null, facilitator_id: null }, () => t0);
    if (!r.ok) throw new Error("start failed");
    const id = r.value.meeting.id as string;
    expect((await advanceSegment(s, PRODUCTION, id, { from: "segue" }, behind)).ok).toBe(true);
    expect((await advanceSegment(s, PRODUCTION, id, { from: "scorecard" }, () => new Date(t0.getTime() + 60_000))).ok).toBe(true);
    expect((await endMeeting(s, PRODUCTION, id, LEAD, { ratings: [] }, { canManage: true, now: behind })).ok).toBe(true);
    const m = db.tables.l10_meetings.find((x) => x.id === id)!;
    expectValidTimings(m);
    const t = m.segment_timings as Record<string, { started_at: string; ended_at: string }>;
    expect(t.segue).toEqual({ started_at: t0.toISOString(), ended_at: t0.toISOString() });
    expect(t.rock_review.ended_at).toBe("2026-11-26T18:01:00.000Z");
    expect(m.ended_at).toBe("2026-11-26T18:01:00.000Z");
  });
});

describe("start", () => {
  it("adds every member as an attendee, with team_id, and refuses a second running meeting", async () => {
    const { s, db } = session();
    await started(s);
    expect(db.tables.l10_meeting_attendees.map((a) => a.profile_id).sort()).toEqual([LEAD, SINGER, NOSLACK].sort());
    expect(db.tables.l10_meeting_attendees.every((a) => a.team_id === PRODUCTION)).toBe(true);
    expect(db.tables.l10_meetings[0].facilitator_id).toBe(LEAD);
    const second = await startMeeting(s, TEAM, LEAD, { attendee_user_ids: null, facilitator_id: null });
    expect(second).toMatchObject({ ok: false, kind: "conflict" });
  });

  it("keeps one running meeting when two starts race", async () => {
    const { s, db } = session();
    const results = await Promise.all([
      startMeeting(s, TEAM, LEAD, { attendee_user_ids: null, facilitator_id: null }),
      startMeeting(s, TEAM, SINGER, { attendee_user_ids: null, facilitator_id: null }),
    ]);
    expect(db.tables.l10_meetings.filter((m) => m.ended_at === null)).toHaveLength(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ kind: "conflict", extra: { code: "l10_meeting_already_open" } });
  });

  it("turns the one-open-meeting index (23505) into a clean conflict when the pre-check misses it", async () => {
    const { s, db } = session();
    const first = await startMeeting(s, TEAM, LEAD, { attendee_user_ids: null, facilitator_id: null });
    expect(first.ok).toBe(true);
    // A racing start whose pre-check ran before the first insert: its first
    // running-meeting read sees none, so only the unique index stops it.
    const emptyRead = { select: () => ({ eq: () => ({ is: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) };
    let first_read = true;
    const real = s as { from: (t: string) => unknown };
    const racing = {
      from: (t: string) => {
        if (t === "l10_meetings" && first_read) {
          first_read = false;
          return emptyRead;
        }
        return real.from(t);
      },
    };
    const second = await startMeeting(racing, TEAM, SINGER, { attendee_user_ids: null, facilitator_id: null });
    expect(second).toMatchObject({ ok: false, kind: "conflict", extra: { code: "l10_meeting_already_open" } });
    expect(db.tables.l10_meetings).toHaveLength(1);
  });

  it("refuses an attendee or facilitator who is not on the team", async () => {
    const { s } = session();
    expect(await startMeeting(s, TEAM, LEAD, { attendee_user_ids: [LEAD, LIVE_ONLY], facilitator_id: null })).toMatchObject({ ok: false, kind: "bad_request" });
    expect(await startMeeting(s, TEAM, LEAD, { attendee_user_ids: null, facilitator_id: LIVE_ONLY })).toMatchObject({ ok: false, kind: "bad_request" });
  });
});

describe("end with ratings", () => {
  it("ends once, saves each rating and averages them; a repeat never overwrites", async () => {
    const { s, db } = session();
    const id = await started(s);
    const ended = await endMeeting(s, PRODUCTION, id, LEAD, { ratings: [{ user_id: LEAD, rating: 9 }, { user_id: SINGER, rating: 8 }] }, { canManage: true });
    if (!ended.ok) throw new Error("end failed");
    expect(ended.value.already_ended).toBe(false);
    expect(ended.value.meeting.ended_at).toBeTruthy();
    expect(ended.value.average_rating).toBe(8.5);
    expect(currentSegment(ended.value.meeting.segment_timings)).toBeNull();
    const ratings = Object.fromEntries(db.tables.l10_meeting_attendees.map((a) => [a.profile_id, a.rating]));
    expect(ratings).toEqual({ [LEAD]: 9, [SINGER]: 8, [NOSLACK]: null });

    const again = await endMeeting(s, PRODUCTION, id, LEAD, { ratings: [{ user_id: LEAD, rating: 1 }] }, { canManage: true });
    if (!again.ok) throw new Error("second end failed");
    expect(again.value.already_ended).toBe(true);
    expect(db.tables.l10_meeting_attendees.find((a) => a.profile_id === LEAD)?.rating).toBe(9);
  });

  it("lets exactly one of two racing ends win", async () => {
    const { s } = session();
    const id = await started(s);
    const both = await Promise.all([
      endMeeting(s, PRODUCTION, id, LEAD, { ratings: [] }, { canManage: true }),
      endMeeting(s, PRODUCTION, id, SINGER, { ratings: [] }, { canManage: false }),
    ]);
    expect(both.map((r) => (r.ok ? r.value.already_ended : null)).sort()).toEqual([false, true]);
  });

  it("lets a member rate only themself", async () => {
    const { db } = session();
    const singer = db.client({ userId: SINGER, rls: pwRls(db.tables) });
    const id = await started(singer, SINGER, LEAD);
    const other = await endMeeting(singer, PRODUCTION, id, SINGER, { ratings: [{ user_id: NOSLACK, rating: 3 }] }, { canManage: false });
    expect(other).toMatchObject({ ok: false, kind: "forbidden" });
    expect(db.tables.l10_meetings[0].ended_at).toBeNull();
    const own = await endMeeting(singer, PRODUCTION, id, SINGER, { ratings: [{ user_id: SINGER, rating: 7 }] }, { canManage: false });
    expect(own).toMatchObject({ ok: true });
    // and can still add their own after someone else ended it
    const late = await endMeeting(db.client({ userId: NOSLACK, rls: pwRls(db.tables) }), PRODUCTION, id, NOSLACK, { ratings: [{ user_id: NOSLACK, rating: 6 }] }, { canManage: false });
    expect(late).toMatchObject({ ok: true, value: { already_ended: true, average_rating: 6.5 } });
  });

  it("lets the facilitator or a leader rate anyone", async () => {
    const { db } = session();
    const singer = db.client({ userId: SINGER, rls: pwRls(db.tables) });
    const id = await started(singer, SINGER, SINGER); // SINGER facilitates
    const r = await endMeeting(singer, PRODUCTION, id, SINGER, { ratings: [{ user_id: NOSLACK, rating: 8 }] }, { canManage: false });
    expect(r).toMatchObject({ ok: true });

    const w = makeWorld();
    const lead = w.client({ userId: LEAD, rls: pwRls(w.tables) });
    const id2 = await started(lead, LEAD, SINGER); // SINGER facilitates, LEAD leads the team
    const byLeader = await endMeeting(lead, PRODUCTION, id2, LEAD, { ratings: [{ user_id: SINGER, rating: 9 }] }, { canManage: true });
    expect(byLeader).toMatchObject({ ok: true });
  });

  it("refuses a rating for someone who was not there", async () => {
    const { s } = session();
    const r0 = await startMeeting(s, TEAM, LEAD, { attendee_user_ids: [LEAD], facilitator_id: null });
    if (!r0.ok) throw new Error("start failed");
    const r = await endMeeting(s, PRODUCTION, r0.value.meeting.id, LEAD, { ratings: [{ user_id: SINGER, rating: 7 }] }, { canManage: true });
    expect(r).toMatchObject({ ok: false, kind: "bad_request" });
  });

  it("averages only the ratings given", () => {
    expect(averageRating([{ rating: null }])).toBeNull();
    expect(averageRating([{ rating: 7 }, { rating: 8 }, { rating: 8 }])).toBe(7.7);
  });
});

describe("parsers", () => {
  it("checks ratings, segments and the start body", () => {
    expect(parseMeetingEnd({ ratings: [{ user_id: LEAD, rating: 11 }] }).ok).toBe(false);
    expect(parseMeetingEnd({ ratings: [{ user_id: LEAD, rating: 7.5 }] }).ok).toBe(false);
    expect(parseMeetingEnd({ ratings: [{ user_id: LEAD, rating: 7 }, { user_id: LEAD, rating: 8 }] }).ok).toBe(false);
    expect(parseMeetingEnd(null)).toEqual({ ok: true, value: { ratings: [] } });
    expect(parseSegmentAdvance({ from: "nope" }).ok).toBe(false);
    expect(parseSegmentAdvance({ from: "ids" })).toEqual({ ok: true, value: { from: "ids" } });
    expect(parseMeetingStart({ facilitator_id: "x" }).ok).toBe(false);
  });

  it("uses 416's columns, fills defaults and refuses unknown or fixed fields", () => {
    expect(parseItemCreate("todos", { title: " Fix in-ears ", owner_id: LEAD }, { quarter: "2026-Q4" })).toEqual({
      ok: true,
      value: { done: false, title: "Fix in-ears", owner_id: LEAD },
    });
    expect(parseItemCreate("issues", { title: "x" }, { quarter: "2026-Q4" })).toMatchObject({ ok: true, value: { status: "identified" } });
    expect(parseItemCreate("issues", { title: "x", status: "open" }, { quarter: "2026-Q4" }).ok).toBe(false);
    expect(parseItemCreate("headlines", { body: "New drummer" }, { quarter: "2026-Q4" }).ok).toBe(true);
    expect(parseItemCreate("measurables", { title: "Volunteers", unit: "yes_no" }, { quarter: "2026-Q4" })).toMatchObject({ ok: true, value: { goal_direction: "at_least" } });
    expect(parseItemCreate("measurable_values", { measurable_id: LEAD, week_start: "2026-11-24" }, { quarter: "2026-Q4" }).ok).toBe(false); // a Tuesday
    expect(parseItemCreate("measurable_values", { measurable_id: LEAD, week_start: "2026-11-23", value: 4 }, { quarter: "2026-Q4" }).ok).toBe(true);
    expect(parseItemCreate("rocks", { title: "x" }, { quarter: "2026-Q4" })).toMatchObject({ ok: true, value: { quarter: "2026-Q4", status: "on_track" } });
    expect(parseItemCreate("todos", { title: "x", team_id: PRODUCTION }, { quarter: "2026-Q4" }).ok).toBe(false);
    expect(parseItemPatch("todos", { source_meeting_id: PRODUCTION }).ok).toBe(false);
    expect(parseItemPatch("measurable_values", { week_start: "2026-11-23" }).ok).toBe(false);
    expect(parseItemPatch("todos", {}).ok).toBe(false);
    expect(parseItemPatch("todos", { due_on: "2026-02-30" }).ok).toBe(false);
  });
});
