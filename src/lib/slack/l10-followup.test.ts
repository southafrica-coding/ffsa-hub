import { describe, expect, it, vi } from "vitest";
import {
  buildFollowupMessage,
  canSendL10Followup,
  dueLabel,
  runL10Followup,
  runL10MeetingEnded,
  runL10Recap,
  type L10FollowupDeps,
} from "./l10-followup";
import {
  DONE_TODO,
  LEAD,
  MEETING_TODO,
  NOSLACK,
  OLD_TODO,
  PRODUCTION,
  SINGER,
  makeWorld,
} from "@/lib/l10/testing/world";

const LIVE_ENV = { VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "https://hub.test" } as unknown as NodeJS.ProcessEnv;
const MEETING = "00000000-0000-4000-8000-0000000000f1";
const NOW = new Date("2026-11-26T19:00:00Z");

function deps(over: { sendSlackDm?: L10FollowupDeps["sendSlackDm"]; postToChannel?: L10FollowupDeps["postToChannel"] } = {}) {
  return {
    sendSlackDm: vi.fn<L10FollowupDeps["sendSlackDm"]>(over.sendSlackDm ?? (async () => ({ ok: true }))),
    postToChannel: vi.fn<L10FollowupDeps["postToChannel"]>(over.postToChannel ?? (async () => ({ ok: true }))),
    slackReady: () => true,
    now: () => NOW,
    log: vi.fn<(message: string) => void>(),
  };
}

function endedWorld(opts: { channel?: string | null; ended?: boolean } = {}) {
  const db = makeWorld({
    l10_meetings: [
      {
        id: MEETING,
        team_id: PRODUCTION,
        started_at: "2026-11-26T17:00:00.000Z",
        ended_at: opts.ended === false ? null : "2026-11-26T18:30:00.000Z",
        facilitator_id: LEAD,
        segment_timings: {},
        recap_posted_at: null,
        followup_sent_at: null,
      },
    ],
    l10_meeting_attendees: [
      { id: "a1", team_id: PRODUCTION, meeting_id: MEETING, profile_id: LEAD, rating: 9, followup_sent_at: null },
      { id: "a2", team_id: PRODUCTION, meeting_id: MEETING, profile_id: SINGER, rating: 7, followup_sent_at: null },
      { id: "a3", team_id: PRODUCTION, meeting_id: MEETING, profile_id: NOSLACK, rating: null, followup_sent_at: null },
    ],
    l10_todos: [
      { id: MEETING_TODO, team_id: PRODUCTION, source_meeting_id: MEETING, title: "Order new DI boxes", owner_id: SINGER, due_on: "2026-12-03", done: false, done_at: null },
      { id: OLD_TODO, team_id: PRODUCTION, source_meeting_id: null, title: "Label <cables> & stands", owner_id: SINGER, due_on: "2026-11-20", done: false, done_at: null },
      { id: DONE_TODO, team_id: PRODUCTION, source_meeting_id: null, title: "Done already", owner_id: SINGER, due_on: null, done: true, done_at: "2026-11-25T10:00:00Z" },
    ],
    l10_issues: [
      { id: "i1", team_id: PRODUCTION, title: "Monitor mix too loud", owner_id: LEAD, status: "solved", solved_at: "2026-11-26T18:00:00.000Z", resolved_meeting_id: MEETING, priority: 1 },
      { id: "i2", team_id: PRODUCTION, title: "Old solved", owner_id: LEAD, status: "solved", solved_at: "2026-11-01T18:00:00.000Z", resolved_meeting_id: null, priority: 1 },
      { id: "i3", team_id: PRODUCTION, source_meeting_id: MEETING, title: "Not enough volunteers", owner_id: SINGER, status: "discussed", solved_at: null, priority: 2 },
      { id: "i4", team_id: PRODUCTION, title: "Projector flicker", owner_id: null, status: "identified", solved_at: null, priority: null },
    ],
  });
  const team = db.tables.l10_teams.find((t) => t.id === PRODUCTION)!;
  team.slack_channel_id = opts.channel === undefined ? "C_PROD" : opts.channel;
  return db;
}

describe("follow-up DMs", () => {
  it("sends one DM per attendee with Slack, and none on a second run", async () => {
    const db = endedWorld();
    const d = deps();
    const first = await runL10Followup(db.client(), MEETING, { deps: d, env: LIVE_ENV });
    expect(first.outcome).toBe("done");
    expect(Object.fromEntries(first.results.map((r) => [r.user_id, r.outcome]))).toEqual({
      [LEAD]: "sent",
      [SINGER]: "sent",
      [NOSLACK]: "no-slack",
    });
    expect(d.sendSlackDm).toHaveBeenCalledTimes(2);
    expect(db.tables.l10_meetings[0].followup_sent_at).toBeTruthy();
    const second = await runL10Followup(db.client(), MEETING, { deps: d, env: LIVE_ENV });
    expect(second.results.filter((r) => r.outcome === "sent")).toHaveLength(0);
    expect(d.sendSlackDm).toHaveBeenCalledTimes(2);
  });

  it("sends exactly one DM per attendee when runs race", async () => {
    const db = endedWorld();
    const d = deps();
    await Promise.all([1, 2, 3, 4].map(() => runL10Followup(db.client(), MEETING, { deps: d, env: LIVE_ENV })));
    const to = d.sendSlackDm.mock.calls.map((c) => (c as unknown[])[0]).sort();
    expect(to).toEqual(["U_LEAD", "U_SINGER"]);
  });

  it("skips and logs someone with no Slack id without claiming them", async () => {
    const db = endedWorld();
    const d = deps();
    await runL10Followup(db.client(), MEETING, { deps: d, env: LIVE_ENV });
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining(`user ${NOSLACK} has no Slack id`));
    expect(db.tables.l10_meeting_attendees.find((a) => a.profile_id === NOSLACK)?.followup_sent_at).toBeNull();
  });

  it("gives the claim back when Slack refuses, so a retry sends", async () => {
    const db = endedWorld();
    const failing = deps({ sendSlackDm: vi.fn(async () => ({ ok: false, error: "channel_not_found" })) });
    const r = await runL10Followup(db.client(), MEETING, { deps: failing, env: LIVE_ENV });
    expect(r.results.filter((x) => x.outcome === "error")).toHaveLength(2);
    expect(db.tables.l10_meeting_attendees.every((a) => a.followup_sent_at === null)).toBe(true);
    const ok = deps();
    await runL10Followup(db.client(), MEETING, { deps: ok, env: LIVE_ENV });
    expect(ok.sendSlackDm).toHaveBeenCalledTimes(2);
  });

  it("sends nothing and claims nothing off the live site or before the end", async () => {
    expect(canSendL10Followup({ VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(canSendL10Followup({ VERCEL_ENV: "production", PREVIEW_WRITES_DISABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    const db = endedWorld();
    const d = deps();
    expect((await runL10Followup(db.client(), MEETING, { deps: d, env: { VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv })).outcome).toBe("off");
    const live = endedWorld({ ended: false });
    expect((await runL10Followup(live.client(), MEETING, { deps: d, env: LIVE_ENV })).outcome).toBe("not-ended");
    expect(d.sendSlackDm).not.toHaveBeenCalled();
    expect(db.tables.l10_meeting_attendees.every((a) => a.followup_sent_at === null)).toBe(true);
  });

  it("lists this meeting's to-dos, then the others still open, with due dates and the link", async () => {
    const db = endedWorld();
    const d = deps();
    await runL10Followup(db.client(), MEETING, { deps: d, env: LIVE_ENV });
    const call = d.sendSlackDm.mock.calls.find((c) => (c as unknown[])[0] === "U_SINGER") as unknown as [string, { text: string; blocks: { text?: { text: string }; elements?: { url: string }[] }[] }];
    const body = JSON.stringify(call[1].blocks);
    expect(body).toContain("Hi Sip");
    expect(body).toContain("From this meeting");
    expect(body).toContain("Order new DI boxes");
    expect(body).toContain("due Thu 3 Dec");
    expect(body).toContain("Still open");
    expect(body).toContain("Label &lt;cables&gt; &amp; stands");
    expect(body).toContain("overdue");
    expect(body).not.toContain("Done already");
    expect(body).toContain(`https://hub.test/departments/prayer_and_worship/l10/${PRODUCTION}`);
    expect(call[1].text).toContain("2 open to-dos");
  });

  it("formats dates and an empty list", () => {
    expect(dueLabel(null, "2026-11-26")).toBe("no due date");
    expect(dueLabel("2026-11-26", "2026-11-26")).toContain("due Thu 26 Nov");
    const m = buildFollowupMessage({ teamName: "Live", firstName: null, meetingId: MEETING, todos: [], url: "u", today: "2026-11-26" });
    expect(JSON.stringify(m.blocks)).toContain("no open to-dos");
  });
});

describe("team channel recap", () => {
  it("posts one recap with the rating, to-dos with owners, solved and open issues", async () => {
    const db = endedWorld();
    const d = deps();
    expect((await runL10Recap(db.client(), MEETING, { deps: d, env: LIVE_ENV })).outcome).toBe("posted");
    expect(d.postToChannel).toHaveBeenCalledTimes(1);
    const [channel, msg] = d.postToChannel.mock.calls[0] as unknown as [string, { blocks: unknown[] }];
    expect(channel).toBe("C_PROD");
    const body = JSON.stringify(msg.blocks);
    expect(body).toContain("Average rating *8* / 10 (2 rated)");
    expect(body).toContain("Order new DI boxes — Sip K");
    expect(body).not.toContain("Label"); // not from this meeting
    expect(body).toContain("Monitor mix too loud");
    expect(body).not.toContain("Old solved");
    expect(body).toContain("Not enough volunteers");
    expect(body).toContain("Projector flicker");
  });

  it("posts once when ended twice or when runs race", async () => {
    const db = endedWorld();
    const d = deps();
    await runL10MeetingEnded(db.client(), MEETING, { deps: d, env: LIVE_ENV });
    await runL10MeetingEnded(db.client(), MEETING, { deps: d, env: LIVE_ENV });
    await Promise.all([1, 2, 3].map(() => runL10Recap(db.client(), MEETING, { deps: d, env: LIVE_ENV })));
    expect(d.postToChannel).toHaveBeenCalledTimes(1);
    expect(d.sendSlackDm).toHaveBeenCalledTimes(2);
  });

  it("skips and logs a team with no channel, without claiming", async () => {
    const db = endedWorld({ channel: null });
    const d = deps();
    expect((await runL10Recap(db.client(), MEETING, { deps: d, env: LIVE_ENV })).outcome).toBe("no-channel");
    expect(d.postToChannel).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("no slack_channel_id"));
    expect(db.tables.l10_meetings[0].recap_posted_at).toBeNull();
  });

  it("gives the claim back when the post fails, so a retry posts", async () => {
    const db = endedWorld();
    const bad = deps({ postToChannel: vi.fn(async () => ({ ok: false, error: "not_in_channel" })) });
    expect((await runL10Recap(db.client(), MEETING, { deps: bad, env: LIVE_ENV })).outcome).toBe("error");
    expect(db.tables.l10_meetings[0].recap_posted_at).toBeNull();
    const ok = deps();
    expect((await runL10Recap(db.client(), MEETING, { deps: ok, env: LIVE_ENV })).outcome).toBe("posted");
  });
});
