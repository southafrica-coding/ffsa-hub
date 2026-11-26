import { describe, expect, it } from "vitest";
import { ensureAutoHeadline } from "./auto-headline";
import { recapHeadlineBody, type MeetingRecap } from "./recap";
import { GROUNDS, LEAD, LIVE, NOSLACK, OPS_ID, PRODUCTION, PW_ID, SINGER, TEAM3, makeWorld } from "./testing/world";

const SRC_OLD = "00000000-0000-4000-8000-00000000f001";
const SRC = "00000000-0000-4000-8000-00000000f002";
const SRC_RUNNING = "00000000-0000-4000-8000-00000000f003";
const LIVE_MEETING = "00000000-0000-4000-8000-00000000f004";

function world() {
  return makeWorld({
    l10_meetings: [
      { id: SRC_OLD, team_id: PRODUCTION, department_id: PW_ID, started_at: "2026-11-12T17:00:00.000Z", ended_at: "2026-11-12T18:30:00.000Z", segment_timings: {} },
      { id: SRC, team_id: PRODUCTION, department_id: PW_ID, started_at: "2026-11-19T17:00:00.000Z", ended_at: "2026-11-19T18:30:00.000Z", segment_timings: {} },
      { id: SRC_RUNNING, team_id: PRODUCTION, department_id: PW_ID, started_at: "2026-11-26T17:00:00.000Z", ended_at: null, segment_timings: {} },
      { id: LIVE_MEETING, team_id: LIVE, department_id: PW_ID, started_at: "2026-11-26T18:00:00.000Z", ended_at: null, segment_timings: {} },
    ],
    l10_meeting_attendees: [
      { id: "a1", team_id: PRODUCTION, meeting_id: SRC, profile_id: LEAD, rating: 9 },
      { id: "a2", team_id: PRODUCTION, meeting_id: SRC, profile_id: SINGER, rating: 8 },
      { id: "a3", team_id: PRODUCTION, meeting_id: SRC, profile_id: NOSLACK, rating: null },
    ],
    rocks: [
      { id: "r1", team_id: PRODUCTION, staff_ministry_id: PW_ID, quarter: "2026-Q4", title: "a", status: "on_track" },
      { id: "r2", team_id: PRODUCTION, staff_ministry_id: PW_ID, quarter: "2026-Q4", title: "b", status: "on_track" },
      { id: "r3", team_id: PRODUCTION, staff_ministry_id: PW_ID, quarter: "2026-Q4", title: "c", status: "off_track" },
      { id: "r4", team_id: null, staff_ministry_id: PW_ID, quarter: "2026-Q4", title: "dept", status: "off_track" },
    ],
    l10_todos: [
      // open when SRC started: two done during it, one not
      { id: "t1", team_id: PRODUCTION, title: "x", owner_id: LEAD, done: true, done_at: "2026-11-19T17:30:00.000Z", created_at: "2026-11-12T18:00:00.000Z" },
      { id: "t2", team_id: PRODUCTION, title: "y", owner_id: SINGER, done: true, done_at: "2026-11-19T17:40:00.000Z", created_at: "2026-11-12T18:00:00.000Z" },
      { id: "t3", team_id: PRODUCTION, title: "z", owner_id: SINGER, done: false, done_at: null, created_at: "2026-11-12T18:00:00.000Z" },
      // done before SRC started: not counted
      { id: "t4", team_id: PRODUCTION, title: "w", owner_id: LEAD, done: true, done_at: "2026-11-15T10:00:00.000Z", created_at: "2026-11-12T18:00:00.000Z" },
      // raised in SRC
      { id: "t5", team_id: PRODUCTION, source_meeting_id: SRC, title: "Buy batteries", owner_id: SINGER, done: false, created_at: "2026-11-19T18:10:00.000Z" },
      { id: "t6", team_id: PRODUCTION, source_meeting_id: SRC, title: "Book truck", owner_id: LEAD, done: false, created_at: "2026-11-19T18:11:00.000Z" },
      { id: "t7", team_id: PRODUCTION, source_meeting_id: SRC, title: "Call venue", owner_id: SINGER, done: false, created_at: "2026-11-19T18:12:00.000Z" },
    ],
    l10_issues: [
      { id: "i1", team_id: PRODUCTION, title: "Hum on channel 4", status: "solved", solved_at: "2026-11-19T18:00:00.000Z", resolved_meeting_id: SRC },
      { id: "i2", team_id: PRODUCTION, title: "Solved elsewhere", status: "solved", solved_at: "2026-11-12T18:00:00.000Z", resolved_meeting_id: SRC_OLD },
    ],
  });
}

describe("ensureAutoHeadline", () => {
  it("recaps the source team's latest ENDED meeting, once, with the right facts", async () => {
    const db = world();
    const admin = db.client();
    expect((await ensureAutoHeadline(admin, LIVE_MEETING)).outcome).toBe("inserted");
    expect((await ensureAutoHeadline(admin, LIVE_MEETING)).outcome).toBe("exists");
    const autos = db.tables.l10_headlines.filter((h) => h.is_auto);
    expect(autos).toHaveLength(1);
    expect(autos[0]).toMatchObject({ team_id: LIVE, department_id: PW_ID, source_meeting_id: LIVE_MEETING, recap_of_meeting_id: SRC, author_id: null });
    const inserted = db.log.find((e) => e.table === "l10_headlines" && e.action === "insert");
    expect(inserted?.payload).not.toHaveProperty("department_id");
    expect(String(autos[0].body).split("\n")).toEqual([
      "Production L10 on Thu 19 Nov 2026",
      "Rocks: 2 on track, 1 off track",
      "To-dos done: 67% (2 of 3)",
      "Issues solved: Hum on channel 4",
      "New to-dos: 3 (Sip K, Thandi M)",
      "Average rating 8.5/10 (2 rated)",
    ]);
  });

  it("inserts one when calls race", async () => {
    const db = world();
    const outcomes = await Promise.all([1, 2, 3].map(() => ensureAutoHeadline(db.client(), LIVE_MEETING)));
    expect(outcomes.filter((o) => o.outcome === "inserted")).toHaveLength(1);
    expect(db.tables.l10_headlines.filter((h) => h.is_auto)).toHaveLength(1);
  });

  it("inserts nothing for an unpaired team, with no ended source meeting, or for an ended meeting", async () => {
    const db = world();
    db.tables.l10_meetings.push({ id: "t3m", team_id: TEAM3, department_id: PW_ID, started_at: "2026-11-26T18:00:00.000Z", ended_at: null, segment_timings: {} });
    expect((await ensureAutoHeadline(db.client(), "t3m")).outcome).toBe("no-source-team");
    expect((await ensureAutoHeadline(db.client(), SRC)).outcome).toBe("meeting-ended");
    const none = world();
    none.tables.l10_meetings.forEach((m) => {
      if (m.team_id === PRODUCTION) m.ended_at = null;
    });
    expect((await ensureAutoHeadline(none.client(), LIVE_MEETING)).outcome).toBe("no-ended-source-meeting");
    expect([...db.tables.l10_headlines, ...none.tables.l10_headlines]).toHaveLength(0);
  });

  it("never pairs across departments", async () => {
    const db = world();
    db.tables.l10_teams.find((t) => t.id === LIVE)!.recap_source_team_id = GROUNDS;
    expect(db.tables.l10_teams.find((t) => t.id === GROUNDS)!.department_id).toBe(OPS_ID);
    const logs: string[] = [];
    expect((await ensureAutoHeadline(db.client(), LIVE_MEETING, (m) => logs.push(m))).outcome).toBe("no-source-team");
    expect(logs[0]).toContain("not a team of this department");
  });

  it("says when there is nothing to report", () => {
    const empty: MeetingRecap = {
      meetingId: "m",
      teamId: "t",
      teamName: "Any team",
      departmentId: "d",
      slackChannelId: null,
      startedAt: "2026-11-26T08:00:00.000Z",
      endedAt: "2026-11-26T09:00:00.000Z",
      date: "2026-11-26",
      averageRating: null,
      ratedCount: 0,
      rocks: { onTrack: 0, offTrack: 0, done: 0, total: 0 },
      todoReview: { due: 0, done: 0, percent: null },
      newTodos: [],
      solved: [],
      open: [],
    };
    expect(recapHeadlineBody(empty)).toBe(
      "Any team L10 on Thu 26 Nov 2026\nRocks: none this quarter\nTo-dos: none were due\nIssues solved: none\nNew to-dos: none\nNo ratings given"
    );
  });
});
