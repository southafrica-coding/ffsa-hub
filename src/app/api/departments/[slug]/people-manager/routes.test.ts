import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { MemoryDb } from "@/lib/l10/testing/memory-db";
import {
  ADA,
  BEN,
  GINA,
  GROUNDS_SLUG,
  GUS,
  MIA,
  OUTSIDER,
  PROD_ENV,
  PW_ID,
  PW_SLUG,
  SIPHO,
  T_ANNUAL,
  T_GROUNDS_SICK,
  T_SICK,
  ZOE,
  makeWorld,
  seedRequest,
  serviceClient,
  sessionClient,
  tick,
} from "@/lib/people-manager/testing/world";
import type { LeaveSlackDeps } from "@/lib/slack/leave-approval";

const h = vi.hoisted(() => ({ userId: null as string | null, db: null as unknown as MemoryDb }));

vi.mock("@/lib/departments/internal/open", () => ({
  isOpened: (r: object) => !("response" in r),
  // Stands in for the department routes' gate: the department comes from the slug.
  openDepartment: async (slug: string) => {
    if (!h.userId) return { response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
    const dept = h.db.tables.staff_ministries.find((d) => d.slug === slug);
    if (h.userId === OUTSIDER || !dept) return { response: NextResponse.json({ error: "Department not found" }, { status: 404 }) };
    return {
      supabase: sessionClient(h.db, h.userId),
      admin: serviceClient(h.db),
      userId: h.userId,
      department: { id: dept.id, slug: dept.slug, name: dept.name },
      access: {},
    };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => serviceClient(h.db) }));
vi.mock("@/services/audit", () => ({ createAuditLog: vi.fn(async () => ({ error: null })) }));

const H = await import("./_lib/handlers");
const { GET: overviewRoute } = await import("./route");
const { POST: createRoute } = await import("./requests/route");

let dms: string[];
const slack: LeaveSlackDeps = {
  sendSlackDm: async (to) => {
    dms.push(to);
    return { ok: true, channel: `D_${to}`, ts: `${dms.length}.1` };
  },
  updateMessage: async () => ({ ok: true }),
  slackReady: () => true,
  now: () => new Date(tick()),
  log: () => {},
};
const deps = { slack, env: PROD_ENV, today: "2026-11-26" };
const json = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const get = (q = "") => new Request(`http://localhost/x${q}`);
const as = (id: string | null) => (h.userId = id);
const row = (id: unknown) => h.db.tables.leave_requests.find((r) => r.id === id)!;

beforeEach(() => {
  h.db = makeWorld();
  dms = [];
  as(SIPHO);
});
afterEach(() => vi.unstubAllEnvs());

describe("permissions", () => {
  it("refuses someone signed out or outside the department", async () => {
    as(null);
    expect((await overviewRoute(get(), { params: Promise.resolve({ slug: PW_SLUG }) })).status).toBe(401);
    as(OUTSIDER);
    expect((await H.getOverview(get(), PW_SLUG, deps)).status).toBe(404);
    expect((await H.createRequest(json({}), PW_SLUG, deps)).status).toBe(404);
  });

  it("lets only a member ask for leave in their department", async () => {
    as(GUS); // Grounds staff, asking in P&W
    const res = await H.createRequest(json({ leave_type_id: T_ANNUAL, start_date: "2026-12-14", end_date: "2026-12-14" }), PW_SLUG, deps);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("leave_request_not_member");
    expect(h.db.tables.leave_requests).toHaveLength(0);
  });

  it("keeps the department list and other people's usage to leaders and admins", async () => {
    expect((await H.listRequests(get("?scope=department"), PW_SLUG, deps)).status).toBe(403);
    expect((await H.listRequests(get("?scope=pending"), PW_SLUG, deps)).status).toBe(403);
    expect((await H.getUsage(get(`?person=${ZOE}`), PW_SLUG, deps)).status).toBe(403);
    as(BEN);
    expect((await H.listRequests(get("?scope=department"), PW_SLUG, deps)).status).toBe(200);
    as(ADA);
    expect((await H.listRequests(get("?scope=department"), PW_SLUG, deps)).status).toBe(200);
  });

  it("hides another person's request from staff (RLS)", async () => {
    const r = seedRequest(h.db, { requester_id: ZOE, department_id: PW_ID, leave_type_id: T_SICK, start_date: "2026-12-14", end_date: "2026-12-14" });
    expect((await H.getRequest(get(), PW_SLUG, String(r.id), deps)).status).toBe(404);
    as(MIA);
    expect((await H.getRequest(get(), PW_SLUG, String(r.id), deps)).status).toBe(200);
  });

  it("stops staff and the requester from deciding", async () => {
    const r = seedRequest(h.db, { requester_id: ZOE, department_id: PW_ID, leave_type_id: T_SICK, start_date: "2026-12-14", end_date: "2026-12-14" });
    as(ZOE);
    const own = await H.decideRequest(json({ decision: "approved" }), PW_SLUG, String(r.id), deps);
    expect(own.status).toBe(403);
    expect((await own.json()).code).toBe("leave_request_self_decision");
    const mine = seedRequest(h.db, { requester_id: BEN, department_id: PW_ID, leave_type_id: T_SICK, start_date: "2026-12-15", end_date: "2026-12-15" });
    as(SIPHO);
    expect((await H.decideRequest(json({ decision: "approved" }), PW_SLUG, String(mine.id), deps)).status).toBe(404); // not visible to staff
    expect(row(r.id).status).toBe("pending");
  });

  it("lets only the requester cancel", async () => {
    const r = seedRequest(h.db, { requester_id: SIPHO, department_id: PW_ID, leave_type_id: T_SICK, start_date: "2026-12-14", end_date: "2026-12-14" });
    as(BEN);
    expect((await (await H.cancelRequest(get(), PW_SLUG, String(r.id), deps)).json()).code).toBe("leave_request_cancel_not_allowed");
    as(SIPHO);
    const res = await H.cancelRequest(get(), PW_SLUG, String(r.id), deps);
    expect(res.status).toBe(200);
    expect(row(r.id)).toMatchObject({ status: "cancelled", cancelled_by: SIPHO });
  });
});

describe("asking for leave", () => {
  it("creates a pending request and DMs the department's leaders", async () => {
    const res = await H.createRequest(
      json({ leave_type_id: T_ANNUAL, start_date: "2026-12-10", end_date: "2026-12-18", notes: "Family trip", covering_user_id: ZOE }),
      PW_SLUG,
      deps
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.request).toMatchObject({
      status: "pending",
      department_id: PW_ID,
      requester_id: SIPHO,
      days_count: 6, // 7 weekdays less the Day of Reconciliation
      days_by_year: { "2026": 6 },
      type: { slug: "annual", label: "Annual leave" },
      covering: { id: ZOE, name: "Zoe Adams" },
      can_cancel: true,
      can_decide: false,
    });
    expect(body.request).not.toHaveProperty("slack_notify");
    expect(body.request.sent_to.map((s: { name: string }) => s.name)).toEqual(["Ben Okoro", "Mia Fourie"]);
    expect(body.slack.results.map((r: { outcome: string }) => r.outcome)).toEqual(["sent", "sent"]);
    expect(dms).toEqual(["U_BEN", "U_MIA"]);
  });

  it("sends nothing to Slack outside production", async () => {
    const res = await H.createRequest(json({ leave_type_id: T_ANNUAL, start_date: "2026-12-14", end_date: "2026-12-14" }), PW_SLUG, {
      ...deps,
      env: { VERCEL_ENV: "preview" } as never,
    });
    expect(res.status).toBe(201);
    expect((await res.json()).slack.outcome).toBe("off");
    expect(dms).toEqual([]);
  });

  it("refuses a range with no working days, bad half days and a type from another department", async () => {
    const weekend = await H.createRequest(json({ leave_type_id: T_ANNUAL, start_date: "2026-11-28", end_date: "2026-11-29" }), PW_SLUG, deps);
    expect((await weekend.json()).code).toBe("leave_request_no_working_days");
    expect((await H.createRequest(json({ leave_type_id: T_ANNUAL, start_date: "2026-12-14", end_date: "2026-12-15", start_part: "am" }), PW_SLUG, deps)).status).toBe(400);
    const other = await H.createRequest(json({ leave_type_id: T_GROUNDS_SICK, start_date: "2026-12-14", end_date: "2026-12-14" }), PW_SLUG, deps);
    expect((await other.json()).code).toBe("leave_request_type_not_available");
    expect(h.db.tables.leave_requests).toHaveLength(0);
  });

  it("previews the count, the year split, usage and who else is away", async () => {
    seedRequest(h.db, { requester_id: SIPHO, department_id: PW_ID, leave_type_id: T_ANNUAL, start_date: "2026-08-03", end_date: "2026-08-07", status: "approved", decided_by: BEN, decided_at: "x" });
    seedRequest(h.db, { requester_id: ZOE, department_id: PW_ID, leave_type_id: T_ANNUAL, start_date: "2026-12-30", end_date: "2026-12-31" });
    const res = await H.previewRequest(
      json({ leave_type_id: T_ANNUAL, start_date: "2026-12-28", end_date: "2027-01-05", start_part: "pm", covering_user_id: ZOE }),
      PW_SLUG
    );
    const body = await res.json();
    expect(body).toMatchObject({ days: 5.5, by_year: { "2026": 3.5, "2027": 2 }, calendar_days: 9, no_working_days: false });
    expect(body.usage).toEqual([
      { year: 2026, used: 5, this_request: 3.5, total: 8.5, guideline: 15, over: 0, reaches_guideline: false, line: "Annual leave: 8.5 of 15 guideline days used" },
      { year: 2027, used: 0, this_request: 2, total: 2, guideline: 15, over: 0, reaches_guideline: false, line: "Annual leave: 2 of 15 guideline days used" },
    ]);
    expect(body.also_away.map((a: { name: string }) => a.name)).toEqual(["Zoe Adams"]);
    expect(body.cover_conflicts).toHaveLength(1);
    expect(body.goes_to).toEqual({ via: "leader", people: [{ user_id: BEN, name: "Ben Okoro" }, { user_id: MIA, name: "Mia Fourie" }] });
    expect(h.db.tables.leave_requests).toHaveLength(2); // nothing written
  });

  it("says a sole leader's request goes to an admin", async () => {
    as(GINA);
    const body = await (await H.getOverview(get(), GROUNDS_SLUG, deps)).json();
    expect(body.goes_to).toEqual({ via: "admin", people: [] });
    expect(body.me).toMatchObject({ is_leader: true, is_member: true, can_request: true });
    expect(body.types.find((t: { slug: string }) => t.slug === "sick").annual_allowance_days).toBe(10); // Grounds' own guideline
  });
});

describe("deciding in the Hub: the first decision wins", () => {
  it("approves once; a second decision gets 409 with who decided", async () => {
    const r = seedRequest(h.db, { requester_id: SIPHO, department_id: PW_ID, leave_type_id: T_SICK, start_date: "2026-12-14", end_date: "2026-12-14" });
    as(BEN);
    const first = await H.decideRequest(json({ decision: "approved", note: "Rest up" }), PW_SLUG, String(r.id), deps);
    expect(first.status).toBe(200);
    expect((await first.json()).request).toMatchObject({ status: "approved", decision_note: "Rest up", decided_by_person: { name: "Ben Okoro" } });
    as(MIA);
    const second = await H.decideRequest(json({ decision: "declined", note: "No" }), PW_SLUG, String(r.id), deps);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "leave_request_already_decided", error: "Already approved by Ben Okoro" });
    expect(row(r.id)).toMatchObject({ status: "approved", decided_by: BEN });
    expect(dms).toEqual(["U_SIPHO"]);
  });

  it("settles two leaders deciding at the same moment", async () => {
    const r = seedRequest(h.db, { requester_id: SIPHO, department_id: PW_ID, leave_type_id: T_SICK, start_date: "2026-12-14", end_date: "2026-12-14" });
    // Each call opens its own session as its own user.
    const decideAs = async (uid: string, body: unknown) => {
      as(uid);
      return H.decideRequest(json(body), PW_SLUG, String(r.id), deps);
    };
    const [a, b] = await Promise.all([decideAs(BEN, { decision: "approved" }), decideAs(MIA, { decision: "declined", note: "No" })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(["approved", "declined"]).toContain(row(r.id).status);
    expect(dms).toEqual(["U_SIPHO"]);
  });

  it("needs a note to decline", async () => {
    const r = seedRequest(h.db, { requester_id: SIPHO, department_id: PW_ID, leave_type_id: T_SICK, start_date: "2026-12-14", end_date: "2026-12-14" });
    as(BEN);
    const res = await H.decideRequest(json({ decision: "declined" }), PW_SLUG, String(r.id), deps);
    expect((await res.json()).code).toBe("leave_request_decline_note_required");
    expect(row(r.id).status).toBe("pending");
  });

  it("lets an admin decide a sole leader's leave, and not the leader", async () => {
    const r = seedRequest(h.db, { requester_id: GINA, department_id: "00000000-0000-4000-8000-0000000000d2", leave_type_id: T_GROUNDS_SICK, start_date: "2026-12-14", end_date: "2026-12-14" });
    as(GINA);
    expect((await H.decideRequest(json({ decision: "approved" }), GROUNDS_SLUG, String(r.id), deps)).status).toBe(403);
    as(ADA);
    expect((await H.decideRequest(json({ decision: "approved" }), GROUNDS_SLUG, String(r.id), deps)).status).toBe(200);
  });
});

describe("cancel", () => {
  it("cancels approved leave only before its first day", async () => {
    const started = seedRequest(h.db, { requester_id: SIPHO, department_id: PW_ID, leave_type_id: T_SICK, start_date: "2026-11-26", end_date: "2026-11-27", status: "approved", decided_by: BEN, decided_at: "x" });
    const later = seedRequest(h.db, { requester_id: SIPHO, department_id: PW_ID, leave_type_id: T_SICK, start_date: "2026-12-14", end_date: "2026-12-14", status: "approved", decided_by: BEN, decided_at: "x" });
    const res = await H.cancelRequest(get(), PW_SLUG, String(started.id), deps);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("leave_request_locked");
    expect((await H.cancelRequest(get(), PW_SLUG, String(later.id), deps)).status).toBe(200);
    // A repeat is a no-op.
    expect((await (await H.cancelRequest(get(), PW_SLUG, String(later.id), deps)).json()).already_cancelled).toBe(true);
  });
});

describe("usage, away and block-outs", () => {
  it("gives a leader every member's usage per type vs guideline, split by year", async () => {
    seedRequest(h.db, { requester_id: SIPHO, department_id: PW_ID, leave_type_id: T_SICK, start_date: "2026-02-09", end_date: "2026-02-11", status: "approved", decided_by: BEN, decided_at: "x" });
    seedRequest(h.db, { requester_id: SIPHO, department_id: PW_ID, leave_type_id: T_SICK, start_date: "2026-11-26", end_date: "2026-12-01" });
    seedRequest(h.db, { requester_id: ZOE, department_id: PW_ID, leave_type_id: T_ANNUAL, start_date: "2026-12-28", end_date: "2027-01-05", status: "approved", decided_by: BEN, decided_at: "x" });
    as(BEN);
    const body = await (await H.getUsage(get("?year=2026"), PW_SLUG, deps)).json();
    expect(body.people.map((p: { name: string }) => p.name)).toEqual(["Ben Okoro", "Mia Fourie", "Nolan Pike", "Sipho Ndlovu", "Zoe Adams"]);
    const sipho = body.people.find((p: { user_id: string }) => p.user_id === SIPHO);
    expect(sipho.usage.find((u: { slug: string }) => u.slug === "sick")).toMatchObject({ used: 3, pending: 4, guideline: 5, over: 0 });
    const zoe = body.people.find((p: { user_id: string }) => p.user_id === ZOE);
    expect(zoe.usage.find((u: { slug: string }) => u.slug === "annual").used).toBe(4);
    const next = await (await H.getUsage(get(`?year=2027&person=${ZOE}`), PW_SLUG, deps)).json();
    expect(next.people[0].usage.find((u: { slug: string }) => u.slug === "annual").used).toBe(2);
  });

  it("counts who is away per weekday and lists the holidays", async () => {
    seedRequest(h.db, { requester_id: ZOE, department_id: PW_ID, leave_type_id: T_ANNUAL, start_date: "2026-12-14", end_date: "2026-12-18", status: "approved", decided_by: BEN, decided_at: "x" });
    h.db.tables.leave_blockouts.push({ id: "b1", user_id: MIA, department_id: PW_ID, start_date: "2026-12-17", end_date: "2026-12-17", reason: "x" });
    const body = await (await H.getAway(get("?from=2026-12-14&to=2026-12-20"), PW_SLUG)).json();
    expect(body.days.map((d: { day: string; away: number }) => [d.day, d.away])).toEqual([
      ["2026-12-14", 1],
      ["2026-12-15", 1],
      ["2026-12-16", 1],
      ["2026-12-17", 2],
      ["2026-12-18", 1],
    ]);
    expect(body.holidays).toEqual([{ day: "2026-12-16", name: "Day of Reconciliation" }]);
    expect(body.rows.every((r: Record<string, unknown>) => !("reason" in r) && !("leave_type_id" in r))).toBe(true);
  });

  it("adds, edits and removes my own block-outs only", async () => {
    const made = await H.createBlockout(json({ start_date: "2026-12-12", end_date: "2026-12-13", reason: "Weekend sets" }), PW_SLUG);
    expect(made.status).toBe(201);
    const b = (await made.json()).blockout;
    expect(b).toMatchObject({ user_id: SIPHO, department_id: PW_ID });
    as(BEN);
    expect((await H.listBlockouts(get(`?person=${SIPHO}`), PW_SLUG)).status).toBe(200);
    expect(((await (await H.listBlockouts(get(`?person=${SIPHO}`), PW_SLUG)).json()).blockouts as unknown[]).length).toBe(1);
    const patch = new Request("http://localhost/x", { method: "PATCH", body: JSON.stringify({ start_date: "2026-12-12", end_date: "2026-12-12" }) });
    expect((await H.updateBlockout(patch, PW_SLUG, b.id)).status).toBe(404); // not Ben's
    expect((await H.deleteBlockout(get(), PW_SLUG, b.id)).status).toBe(404);
    as(SIPHO);
    expect((await H.deleteBlockout(get(), PW_SLUG, b.id)).status).toBe(200);
    expect(h.db.tables.leave_blockouts).toHaveLength(0);
  });
});

describe("any department", () => {
  it("runs the same flow in Grounds with Grounds' own leader and guideline", async () => {
    as(GUS);
    const created = await (await H.createRequest(json({ leave_type_id: T_GROUNDS_SICK, start_date: "2026-12-14", end_date: "2026-12-14" }), GROUNDS_SLUG, deps)).json();
    expect(dms).toEqual(["U_GINA"]);
    as(BEN); // a P&W leader cannot see or decide it
    expect((await H.decideRequest(json({ decision: "approved" }), GROUNDS_SLUG, created.request.id, deps)).status).toBe(404);
    as(GINA);
    expect((await H.decideRequest(json({ decision: "approved" }), GROUNDS_SLUG, created.request.id, deps)).status).toBe(200);
    expect(dms).toEqual(["U_GINA", "U_GUS"]);
  });

  it("goes through the route file with the real params", async () => {
    const res = await createRoute(json({ leave_type_id: T_ANNUAL, start_date: "2026-12-14", end_date: "2026-12-14" }), { params: Promise.resolve({ slug: PW_SLUG }) });
    expect(res.status).toBe(201);
    expect(dms).toEqual([]); // the route runs with the real env: not production, no Slack
  });
});
