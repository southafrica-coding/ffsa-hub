import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { MemoryDb } from "@/lib/l10/testing/memory-db";
import {
  DEPT_LEAD,
  DEPT_ROCK,
  LEAD,
  LIVE,
  LIVE_ONLY,
  NOSLACK,
  OUTSIDER,
  PRODUCTION,
  PW_ID,
  TEAM3,
  ROCK,
  SINGER,
  makeWorld,
  pwRls,
  COOK,
  GROUNDS,
  GROUNDS_LEAD,
  KITCHEN,
  OPS_ID,
  OPS_LEAD,
  OPS_SLUG,
} from "@/lib/l10/testing/world";

const h = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as unknown as MemoryDb,
  posts: [] as { channel: string; text: string }[],
}));

vi.mock("@/lib/departments/internal/open", () => ({
  isOpened: (r: object) => !("response" in r),
  // Stands in for the department routes' gate: the department comes from the slug.
  openDepartment: async (slug: string) => {
    if (!h.userId) return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
    const dept = h.db.tables.staff_ministries.find((d) => d.slug === slug);
    if (h.userId === OUTSIDER || !dept) return { response: NextResponse.json({ error: "Department not found" }, { status: 404 }) };
    return {
      supabase: h.db.client({ userId: h.userId, rls: pwRls(h.db.tables) }),
      admin: h.db.client(),
      userId: h.userId,
      department: { id: dept.id, slug: dept.slug },
      access: { canSeeDepartmentDetail: true, canEditRocks: h.userId === DEPT_LEAD },
    };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/services/audit", () => ({ createAuditLog: vi.fn(async () => ({ error: null })) }));
vi.mock("@/lib/slack/bots", () => ({ isBotConfigured: () => true }));
vi.mock("@/lib/slack/client", () => ({
  openConversation: vi.fn(async (id: string) => ({ ok: true, channel: { id: `D_${id}` } })),
  postMessage: vi.fn(async (args: { channel: string; text: string }) => {
    h.posts.push({ channel: args.channel, text: args.text });
    return { ok: true };
  }),
}));

const { GET: listTeams } = await import("./route");
const { GET: getTeam } = await import("./teams/[teamId]/route");
const { GET: listKind, POST: createKind } = await import("./teams/[teamId]/[kind]/route");
const { PATCH: patchItem, DELETE: deleteItem } = await import("./teams/[teamId]/[kind]/[itemId]/route");
const { POST: startMeeting } = await import("./teams/[teamId]/meetings/route");
const { GET: getMeeting } = await import("./teams/[teamId]/meetings/[meetingId]/route");
const { POST: advance } = await import("./teams/[teamId]/meetings/[meetingId]/advance/route");
const { POST: end } = await import("./teams/[teamId]/meetings/[meetingId]/end/route");
const { POST: dismiss, DELETE: restore } = await import("./teams/[teamId]/[kind]/[itemId]/dismiss/route");

const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/x", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const get = (q = "") => new Request(`http://localhost/x${q}`);
type AnyParams = { slug: string; teamId: string; kind: string; itemId: string; meetingId: string };
// One loose params shape for every route under test; each route reads only its own keys.
const p = (v: Record<string, string>) => ({ params: Promise.resolve({ slug: "prayer_and_worship", ...v } as AnyParams) });
const prod = (extra: Record<string, string> = {}) => p({ teamId: PRODUCTION, ...extra });

beforeEach(() => {
  h.db = makeWorld();
  h.userId = SINGER;
  h.posts = [];
  h.db.tables.l10_teams.find((t) => t.id === PRODUCTION)!.slack_channel_id = "C_PROD";
});
afterEach(() => vi.unstubAllEnvs());

describe("permissions", () => {
  it("refuses someone signed out or outside P&W", async () => {
    h.userId = null;
    expect((await listTeams(get(), p({}))).status).toBe(401);
    h.userId = OUTSIDER;
    expect((await listTeams(get(), p({}))).status).toBe(404);
    expect((await getTeam(get(), prod())).status).toBe(404);
    expect((await createKind(json({ title: "x" }), prod({ kind: "todos" }))).status).toBe(404);
  });

  it("lists only the teams I can see, with my role; an overseer sees all three", async () => {
    const mine = await (await listTeams(get(), p({}))).json();
    expect(mine.teams.map((t: { name: string; my_role: string | null }) => [t.name, t.my_role])).toEqual([["Production", "member"]]);
    h.userId = DEPT_LEAD;
    const all = await (await listTeams(get(), p({}))).json();
    expect(all.teams.map((t: { name: string; my_role: string | null }) => [t.name, t.my_role])).toEqual([
      ["Production", null],
      ["Live", null],
      ["Team 3", null],
    ]);
  });

  it("hides a team from a P&W member who is not on it", async () => {
    h.userId = LIVE_ONLY;
    expect((await getTeam(get(), prod())).status).toBe(404);
    expect((await createKind(json({ title: "x" }), prod({ kind: "todos" }))).status).toBe(404);
    expect((await startMeeting(json({}), prod())).status).toBe(404);
    expect((await getTeam(get(), p({ teamId: LIVE }))).status).toBe(200);
    expect(h.db.tables.l10_todos).toHaveLength(0);
  });

  it("lets a member create and edit, but only a leader or overseer delete a rock", async () => {
    const team = await (await getTeam(get(), prod())).json();
    expect(team.access).toEqual({ canView: true, canEdit: true, canManage: false });
    expect(team.rocks.map((r: { id: string }) => r.id)).toEqual([ROCK]); // not the department rock
    const created = await createKind(json({ title: "Buy gaffer tape", owner_id: LEAD, due_on: "2026-12-01" }), prod({ kind: "todos" }));
    expect(created.status).toBe(200);
    const todo = (await created.json()).todo;
    expect(todo).toMatchObject({ team_id: PRODUCTION, done: false, owner_id: LEAD, created_by: SINGER });
    const done = await patchItem(json({ done: true }, "PATCH"), prod({ kind: "todos", itemId: todo.id }));
    expect((await done.json()).todo.done_at).toBeTruthy();

    expect((await deleteItem(get(), prod({ kind: "rocks", itemId: ROCK }))).status).toBe(403);
    h.userId = LEAD;
    expect((await deleteItem(get(), prod({ kind: "rocks", itemId: ROCK }))).status).toBe(200);
    expect(h.db.tables.rocks.map((r) => r.id)).toEqual([DEPT_ROCK]);
  });

  it("lets an overseer who is on no team work on it", async () => {
    h.userId = DEPT_LEAD;
    const team = await (await getTeam(get(), prod())).json();
    expect(team.access).toEqual({ canView: true, canEdit: true, canManage: true });
    const rock = await createKind(json({ title: "Hire a lighting tech", owner_user_id: LEAD }), prod({ kind: "rocks" }));
    expect((await rock.json()).rock).toMatchObject({ team_id: PRODUCTION, staff_ministry_id: PW_ID });
  });

  it("refuses an owner who is not on the team, an unknown kind and a team from another department", async () => {
    expect((await createKind(json({ title: "x", owner_id: LIVE_ONLY }), prod({ kind: "todos" }))).status).toBe(400);
    expect((await listKind(get(), prod({ kind: "secrets" }))).status).toBe(404);
    h.db.tables.l10_teams.find((t) => t.id === PRODUCTION)!.department_id = "00000000-0000-4000-8000-000000000999";
    expect((await getTeam(get(), prod())).status).toBe(404);
  });

  it("keeps one scorecard value per measurable per week", async () => {
    const m = await (await createKind(json({ title: "Volunteers rostered", unit: "number", goal_value: 12 }), prod({ kind: "measurables" }))).json();
    const v = json({ measurable_id: m.measurable.id, week_start: "2026-11-23", value: 10 });
    expect((await createKind(v, prod({ kind: "measurable_values" }))).status).toBe(200);
    const dup = json({ measurable_id: m.measurable.id, week_start: "2026-11-23", value: 11 });
    expect((await createKind(dup, prod({ kind: "measurable_values" }))).status).toBe(409);
  });
});

describe("a meeting, end to end", () => {
  async function runMeeting(userId = LEAD, body: Record<string, unknown> = {}) {
    h.userId = userId;
    const started = await startMeeting(json(body), prod());
    expect(started.status).toBe(200);
    const startedBody = await started.json();
    expect(startedBody.meeting.current_segment).toBe("segue");
    const meetingId = startedBody.meeting.id as string;
    const mp = prod({ meetingId });
    const first = await advance(json({ from: "segue" }), mp);
    expect((await first.json()).meeting.current_segment).toBe("scorecard");
    expect((await advance(json({ from: "segue" }), mp)).status).toBe(409);
    return { meetingId, mp };
  }

  it("ending twice saves ratings once, DMs each attendee once and posts one recap", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const { meetingId, mp } = await runMeeting();
    await createKind(json({ title: "Fix click track", owner_id: SINGER, source_meeting_id: meetingId }), prod({ kind: "todos" }));

    const ratings = { ratings: [{ user_id: LEAD, rating: 8 }, { user_id: SINGER, rating: 9 }] };
    const [a, b] = await Promise.all([end(json(ratings), mp), end(json(ratings), mp)]);
    const bodies = [await a.json(), await b.json()];
    expect(bodies.map((x) => x.already_ended).sort()).toEqual([false, true]);
    expect(bodies.every((x) => x.average_rating === 8.5)).toBe(true);
    const again = await (await end(json({ ratings: [{ user_id: LEAD, rating: 1 }] }), mp)).json();
    expect(again.already_ended).toBe(true);
    expect(again.average_rating).toBe(8.5);

    const dms = h.posts.filter((x) => x.channel.startsWith("D_")).map((x) => x.channel).sort();
    expect(dms).toEqual(["D_U_LEAD", "D_U_SINGER"]); // NOSLACK skipped
    expect(h.posts.filter((x) => x.channel === "C_PROD")).toHaveLength(1);
    const meeting = await (await getMeeting(get(), mp)).json();
    expect(meeting.meeting.recap_posted_at).toBeTruthy();
  });

  it("refuses a member rating someone else, and lets the facilitator do it", async () => {
    const { mp } = await runMeeting(LEAD, { facilitator_id: NOSLACK });
    h.userId = SINGER;
    expect((await end(json({ ratings: [{ user_id: LEAD, rating: 2 }] }), mp)).status).toBe(403);
    expect(h.db.tables.l10_meetings[0].ended_at).toBeNull();
    h.userId = NOSLACK; // the facilitator, a plain member
    const ok = await end(json({ ratings: [{ user_id: LEAD, rating: 8 }, { user_id: SINGER, rating: 7 }] }), mp);
    expect(ok.status).toBe(200);
    h.userId = SINGER; // own rating after the end: already set, so unchanged
    expect((await (await end(json({ ratings: [{ user_id: SINGER, rating: 1 }] }), mp)).json()).average_rating).toBe(7.5);
  });

  it("lets a team leader rate anyone", async () => {
    const { mp } = await runMeeting(SINGER, { facilitator_id: SINGER });
    h.userId = LEAD;
    expect((await end(json({ ratings: [{ user_id: NOSLACK, rating: 9 }] }), mp)).status).toBe(200);
  });

  it("skips the recap for a team with no channel", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    h.db.tables.l10_teams.find((t) => t.id === PRODUCTION)!.slack_channel_id = null;
    const { mp } = await runMeeting();
    const body = await (await end(json({}), mp)).json();
    expect(body.recap.outcome).toBe("no-channel");
    expect(h.posts.filter((x) => x.channel.startsWith("C_"))).toHaveLength(0);
    expect(h.db.tables.l10_meetings[0].recap_posted_at).toBeNull();
  });

  it("sends nothing on a preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const { mp } = await runMeeting();
    const body = await (await end(json({}), mp)).json();
    expect(body.followup.outcome).toBe("off");
    expect(body.recap.outcome).toBe("off");
    expect(h.posts).toHaveLength(0);
  });

  it("carries an unsolved issue to the next meeting without copying it", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const { meetingId, mp } = await runMeeting();
    const raised = await createKind(json({ title: "Need a second sound tech", source_meeting_id: meetingId }), prod({ kind: "issues" }));
    const issue = (await raised.json()).issue;
    const other = await (await createKind(json({ title: "Old cables" }), prod({ kind: "issues" }))).json();
    const solved = await (await patchItem(json({ status: "solved" }, "PATCH"), prod({ kind: "issues", itemId: other.issue.id }))).json();
    expect(solved.issue).toMatchObject({ status: "solved", resolved_meeting_id: meetingId });
    expect(solved.issue.solved_at).toBeTruthy();
    await end(json({}), mp);
    await end(json({}), mp);
    const issuesBefore = h.db.tables.l10_issues.length;

    const next = await runMeeting();
    expect(next.meetingId).not.toBe(meetingId);
    const open = await (await listKind(get(), prod({ kind: "issues" }))).json();
    expect(open.issues.map((i: { id: string }) => i.id)).toEqual([issue.id]);
    expect(h.db.tables.l10_issues).toHaveLength(issuesBefore);
    const detail = await (await getTeam(get(), prod())).json();
    expect(detail.issues.map((i: { id: string }) => i.id)).toEqual([issue.id]);
    expect(detail.running_meeting.meeting.id).toBe(next.meetingId);
    const recap = h.posts.filter((x) => x.channel === "C_PROD");
    expect(recap).toHaveLength(1);
    expect(recap[0].text).toContain("1 solved, 1 open");
  });

  it("refuses to start a second running meeting", async () => {
    await runMeeting();
    expect((await startMeeting(json({}), prod())).status).toBe(409);
  });
});

describe("the cross-team headline", () => {
  /** A Production meeting that has ended, for Live to hear about. */
  async function productionMeetingEnded(ratings: { user_id: string; rating: number }[] = []) {
    h.userId = LEAD;
    const started = await (await startMeeting(json({}), prod())).json();
    const mp = prod({ meetingId: started.meeting.id });
    await createKind(json({ title: "Tape the stage", owner_id: SINGER, source_meeting_id: started.meeting.id }), prod({ kind: "todos" }));
    await end(json({ ratings }), mp);
    return started.meeting.id as string;
  }
  const liveP = (extra: Record<string, string> = {}) => p({ teamId: LIVE, ...extra });

  it("gives Live one headline recapping Production's last ended meeting, on start and on load", async () => {
    const sourceId = await productionMeetingEnded([{ user_id: LEAD, rating: 8 }]);
    h.userId = LIVE_ONLY;
    const started = await (await startMeeting(json({}), liveP())).json();
    expect(started.auto_headline).toBe("inserted");
    // A second start while this one runs: one meeting, one headline, a coded 409.
    const twice = await startMeeting(json({}), liveP());
    expect(twice.status).toBe(409);
    expect((await twice.json()).code).toBe("l10_meeting_already_open");
    const mp = liveP({ meetingId: started.meeting.id });
    const again = await (await getMeeting(get(), mp)).json();
    expect(again.auto_headline).toBe("exists");
    await advance(json({ from: "segue" }), mp);
    await getTeam(get(), liveP());
    const autos = h.db.tables.l10_headlines.filter((x) => x.is_auto);
    expect(autos).toHaveLength(1);
    expect(autos[0]).toMatchObject({ team_id: LIVE, source_meeting_id: started.meeting.id, recap_of_meeting_id: sourceId, author_id: null });
    expect(again.headlines[0]).toMatchObject({ is_auto: true, dismissed_at: null });
    expect(String(autos[0].body)).toContain("Production L10 on");
    expect(String(autos[0].body)).toContain("Average rating 8/10 (1 rated)");
  });

  it("adds it to a meeting started before it existed, when the meeting is loaded", async () => {
    await productionMeetingEnded();
    h.userId = LIVE_ONLY;
    const started = await (await startMeeting(json({}), liveP())).json();
    h.db.tables.l10_headlines.length = 0; // as if it had been started earlier
    const loaded = await (await getMeeting(get(), liveP({ meetingId: started.meeting.id }))).json();
    expect(loaded.auto_headline).toBe("inserted");
    expect(h.db.tables.l10_headlines.filter((x) => x.is_auto)).toHaveLength(1);
  });

  it("gives Team 3 (no pairing) nothing, and nothing while the source team has no ended meeting", async () => {
    await productionMeetingEnded();
    h.userId = LEAD;
    const t3 = await (await startMeeting(json({}), p({ teamId: TEAM3 }))).json();
    expect(t3.auto_headline).toBe("no-source-team");
    h.userId = LIVE_ONLY;
    // Production's ended meeting exists, but Live -> Production; check the reverse with nothing ended:
    const w = h.db.tables;
    w.l10_meetings.filter((m) => m.team_id === PRODUCTION).forEach((m) => (m.ended_at = null));
    const live = await (await startMeeting(json({}), liveP())).json();
    expect(live.auto_headline).toBe("no-ended-source-meeting");
    expect(w.l10_headlines.filter((x) => x.is_auto)).toHaveLength(0);
  });

  it("refuses edits and deletes of an auto headline, lets anyone on the team dismiss it, and keeps is_auto off requests", async () => {
    await productionMeetingEnded();
    h.userId = LIVE_ONLY;
    await startMeeting(json({}), liveP());
    const auto = h.db.tables.l10_headlines.find((x) => x.is_auto)!;
    const item = liveP({ kind: "headlines", itemId: auto.id as string });
    const patched = await patchItem(json({ body: "edited" }, "PATCH"), item);
    expect(patched.status).toBe(409);
    expect((await patched.json()).code).toBe("l10_auto_headline_locked");
    expect((await deleteItem(get(), item)).status).toBe(409);
    expect(h.db.tables.l10_headlines.find((x) => x.id === auto.id)?.body).toBe(auto.body);

    const dismissed = await (await dismiss(get(), item)).json();
    expect(dismissed.headline.dismissed_at).toBeTruthy();
    const list = await (await listKind(get(), liveP({ kind: "headlines" }))).json();
    expect(list.headlines[0]).toMatchObject({ id: auto.id, is_auto: true });
    expect(list.headlines[0].dismissed_at).toBeTruthy();
    const shown = await (await restore(get(), item)).json();
    expect(shown.headline).toMatchObject({ id: auto.id, is_auto: true, dismissed_at: null });

    for (const body of [{ body: "x", is_auto: true }, { body: "x", recap_of_meeting_id: auto.id }, { body: "x", dismissed_at: "2026-01-01" }]) {
      const r = await createKind(json(body), liveP({ kind: "headlines" }));
      expect(r.status).toBe(400);
      expect((await r.json()).code).toBe("l10_auto_headline_field");
    }
    expect(h.db.tables.l10_headlines.filter((x) => x.is_auto)).toHaveLength(1);
    // An ordinary headline can still be edited and dismissed.
    const mine = await (await createKind(json({ body: "New bassist" }), liveP({ kind: "headlines" }))).json();
    expect(mine.headline).toMatchObject({ is_auto: false, author_id: LIVE_ONLY });
    expect((await patchItem(json({ body: "New bass player" }, "PATCH"), liveP({ kind: "headlines", itemId: mine.headline.id }))).status).toBe(200);
  });
});

describe("a second department uses the same L10 with nothing special-cased", () => {
  const ops = (v: Record<string, string> = {}) => p({ slug: OPS_SLUG, ...v });

  it("lists only its own teams, by slug", async () => {
    h.userId = OPS_LEAD;
    const all = await (await listTeams(get(), ops())).json();
    expect(all.teams.map((t: { id: string; name: string }) => [t.id, t.name])).toEqual([[GROUNDS, "Grounds"], [KITCHEN, "Kitchen"]]);
    h.userId = COOK;
    const mine = await (await listTeams(get(), ops())).json();
    expect(mine.teams.map((t: { name: string; my_role: string | null }) => [t.name, t.my_role])).toEqual([["Grounds", "member"], ["Kitchen", "leader"]]);
    // A P&W team is not reachable through this department's slug, and vice versa.
    expect((await getTeam(get(), ops({ teamId: PRODUCTION }))).status).toBe(404);
    expect((await getTeam(get(), p({ teamId: GROUNDS }))).status).toBe(404);
    h.userId = DEPT_LEAD; // P&W's leader oversees nothing here
    expect((await (await listTeams(get(), ops())).json()).teams).toEqual([]);
  });

  it("ends a meeting with DMs and a channel recap, then recaps it on the paired team's next meeting", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    h.db.tables.l10_teams.find((t) => t.id === GROUNDS)!.slack_channel_id = "C_GROUNDS";
    h.userId = GROUNDS_LEAD;
    const started = await (await startMeeting(json({}), ops({ teamId: GROUNDS }))).json();
    expect(started.auto_headline).toBe("no-ended-source-meeting"); // Kitchen has not met yet
    const mp = ops({ teamId: GROUNDS, meetingId: started.meeting.id });
    await createKind(json({ title: "Mow the field", owner_id: COOK, source_meeting_id: started.meeting.id }), ops({ teamId: GROUNDS, kind: "todos" }));
    const ended = await (await end(json({ ratings: [{ user_id: GROUNDS_LEAD, rating: 9 }, { user_id: COOK, rating: 7 }] }), mp)).json();
    expect(ended.average_rating).toBe(8);
    await end(json({}), mp);

    expect(h.posts.filter((x) => x.channel.startsWith("D_")).map((x) => x.channel).sort()).toEqual(["D_U_COOK", "D_U_GROUNDS"]);
    const recaps = h.posts.filter((x) => x.channel === "C_GROUNDS");
    expect(recaps).toHaveLength(1);
    expect(recaps[0].text).toContain("Grounds");

    h.userId = COOK;
    const kitchen = await (await startMeeting(json({}), ops({ teamId: KITCHEN }))).json();
    expect(kitchen.auto_headline).toBe("inserted");
    await getMeeting(get(), ops({ teamId: KITCHEN, meetingId: kitchen.meeting.id }));
    const autos = h.db.tables.l10_headlines.filter((x) => x.is_auto);
    expect(autos).toHaveLength(1);
    expect(autos[0]).toMatchObject({ team_id: KITCHEN, recap_of_meeting_id: started.meeting.id });
    expect(String(autos[0].body)).toContain("Grounds L10 on");
    expect(String(autos[0].body)).toContain("New to-dos: 1 (Kim C)");
    expect(String(autos[0].body)).toContain("Average rating 8/10 (2 rated)");
    expect(h.db.tables.l10_teams.find((t) => t.id === KITCHEN)!.department_id).toBe(OPS_ID);
  });
});
