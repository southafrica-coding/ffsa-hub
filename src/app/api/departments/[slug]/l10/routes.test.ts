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
  ROCK,
  SINGER,
  makeWorld,
  pwRls,
} from "@/lib/l10/testing/world";

const h = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as unknown as MemoryDb,
  posts: [] as { channel: string; text: string }[],
}));

vi.mock("@/lib/departments/internal/open", () => ({
  isOpened: (r: object) => !("response" in r),
  openDepartment: async () => {
    if (!h.userId) return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
    if (h.userId === OUTSIDER) return { response: NextResponse.json({ error: "Department not found" }, { status: 404 }) };
    return {
      supabase: h.db.client({ userId: h.userId, rls: pwRls(h.db.tables) }),
      admin: h.db.client(),
      userId: h.userId,
      department: { id: PW_ID, slug: "prayer_and_worship" },
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
    expect(detail.live_meeting.meeting.id).toBe(next.meetingId);
    const recap = h.posts.filter((x) => x.channel === "C_PROD");
    expect(recap).toHaveLength(1);
    expect(recap[0].text).toContain("1 solved, 1 open");
  });

  it("refuses to start a second running meeting", async () => {
    await runMeeting();
    expect((await startMeeting(json({}), prod())).status).toBe(409);
  });
});
