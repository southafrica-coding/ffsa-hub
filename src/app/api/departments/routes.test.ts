import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeQuery } from "@/lib/testing/fake-supabase";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import {
  ADMIN,
  FINANCE_USER,
  INACTIVE_ADMIN,
  LEADER,
  LEADERSHIP_MEMBER,
  LINK_ID,
  MEDIA,
  MEMBER,
  OTHER_ROCK_ID,
  OUTSIDER,
  ROCK_ID,
  SCOPED_ADMIN,
  makeDepartmentWorld,
  resolveDepartmentWorld,
  type DepartmentWorld,
} from "@/lib/testing/department-world";
import { currentQuarter } from "@/lib/departments/quarter";

const h = vi.hoisted(() => ({
  userId: null as string | null,
  world: null as DepartmentWorld | null,
  userQueries: [] as FakeQuery[],
  adminQueries: [] as FakeQuery[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const fake = createFakeSupabase({
      user: h.userId ? { id: h.userId } : null,
      resolve: (query) => resolveDepartmentWorld(h.world as DepartmentWorld, query),
    });
    h.userQueries = fake.queries;
    return fake.client;
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const fake = createFakeSupabase({
      user: h.userId ? { id: h.userId } : null,
      resolve: (query) => resolveDepartmentWorld(h.world as DepartmentWorld, query),
    });
    h.adminQueries = fake.queries;
    return fake.client;
  },
}));

const { GET: getOverview } = await import("./[slug]/overview/route");
const { GET: getPeople } = await import("./[slug]/people/route");
const { GET: getOkrs } = await import("./[slug]/okrs/route");
const { GET: getRocks, POST: postRock } = await import("./[slug]/rocks/route");
const { PATCH: patchRock } = await import("./[slug]/rocks/[rockId]/route");
const { GET: getBudget, PATCH: patchBudget } = await import("./[slug]/budget/route");
const { GET: getRollup } = await import("./rocks/route");
const { GET: getServices } = await import("../services/route");
const { GET: getService } = await import("../services/[key]/route");

function slugCtx(slug: string) {
  return { params: Promise.resolve({ slug }) };
}
function rockCtx(slug: string, rockId: string) {
  return { params: Promise.resolve({ slug, rockId }) };
}
function keyCtx(key: string) {
  return { params: Promise.resolve({ key }) };
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.userId = MEMBER;
  h.world = makeDepartmentWorld();
  h.userQueries = [];
  h.adminQueries = [];
});

describe("department routes", () => {
  it("asks a signed-out caller to sign in", async () => {
    h.userId = null;
    const calls = [
      getOverview(new Request("http://localhost/api/departments/media/overview"), slugCtx("media")),
      getPeople(new Request("http://localhost/api/departments/media/people"), slugCtx("media")),
      getOkrs(new Request("http://localhost/api/departments/media/okrs"), slugCtx("media")),
      getRocks(new Request("http://localhost/api/departments/media/rocks"), slugCtx("media")),
      postRock(jsonRequest("http://localhost/api/departments/media/rocks", "POST", { title: "A" }), slugCtx("media")),
      patchRock(
        jsonRequest("http://localhost/api/departments/media/rocks/" + ROCK_ID, "PATCH", { status: "done" }),
        rockCtx("media", ROCK_ID)
      ),
      getBudget(new Request("http://localhost/api/departments/media/budget"), slugCtx("media")),
      patchBudget(
        jsonRequest("http://localhost/api/departments/media/budget", "PATCH", { link_id: LINK_ID, budget_cents: 1 }),
        slugCtx("media")
      ),
      getRollup(new Request("http://localhost/api/departments/rocks")),
      getServices(),
      getService(new Request("http://localhost/api/services/communications"), keyCtx("communications")),
    ];
    const responses = await Promise.all(calls);
    expect(responses.map((response) => response.status)).toEqual(Array(calls.length).fill(401));
  });

  it("returns 404 for an unknown department or service, and 403 for an inactive admin", async () => {
    h.userId = ADMIN;
    expect((await getOverview(new Request("http://localhost/x"), slugCtx("not_a_department"))).status).toBe(404);
    expect((await getPeople(new Request("http://localhost/x"), slugCtx("not_a_department"))).status).toBe(404);
    expect((await getService(new Request("http://localhost/x"), keyCtx("not_a_service"))).status).toBe(404);
    expect((await getService(new Request("http://localhost/x"), keyCtx("Communications"))).status).toBe(404);

    h.userId = INACTIVE_ADMIN;
    expect((await getOverview(new Request("http://localhost/x"), slugCtx("media"))).status).toBe(403);
    expect((await getBudget(new Request("http://localhost/x"), slugCtx("media"))).status).toBe(403);
    expect((await getRollup(new Request("http://localhost/x"))).status).toBe(403);
    expect((await getServices()).status).toBe(403);
  });

  it("denies the request when the access lookup fails", async () => {
    h.userId = ADMIN;
    h.world!.errors = { users: true };
    expect((await getOverview(new Request("http://localhost/x"), slugCtx("media"))).status).toBe(403);
    expect((await getRollup(new Request("http://localhost/x"))).status).toBe(403);
    expect((await getServices()).status).toBe(403);
  });

  it("returns 500 when the department itself cannot be loaded", async () => {
    h.userId = ADMIN;
    h.world!.errors = { staff_ministries: true };
    const response = await getOverview(new Request("http://localhost/x"), slugCtx("media"));
    expect(response.status).toBe(500);
  });

  it("shows a member their department and hides it from an outsider", async () => {
    const overview = await getOverview(new Request("http://localhost/x"), slugCtx("media"));
    expect(overview.status).toBe(200);
    const body = await overview.json();
    expect(body.department).toMatchObject({ slug: "media", purpose: "Cameras and stories" });
    expect(body.counts).toMatchObject({ people: 2, leaders: 1, rocks: 1, objectives: 1 });
    expect(body.leaders).toEqual([
      expect.objectContaining({ user_id: LEADER, name: "Hanno Leader", is_point_leader: true, job_title: "Producer" }),
    ]);
    expect(body.quarter).toBe(currentQuarter());

    h.userId = OUTSIDER;
    expect((await getOverview(new Request("http://localhost/x"), slugCtx("media"))).status).toBe(403);
    h.userId = SCOPED_ADMIN;
    expect((await getOverview(new Request("http://localhost/x"), slugCtx("media"))).status).toBe(403);
    h.userId = LEADERSHIP_MEMBER;
    expect((await getOverview(new Request("http://localhost/x"), slugCtx("media"))).status).toBe(200);
  });

  it("returns the roster and the open reporting line", async () => {
    const response = await getPeople(new Request("http://localhost/x"), slugCtx("media"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.roster.map((row: { name: string; status: string }) => [row.name, row.status])).toEqual([
      ["Hanno Leader", "active"],
      ["Pete Pending", "pending"],
      ["Amahle Member", "active"],
    ]);
    expect(body.reporting_lines).toEqual([
      expect.objectContaining({ kind: "oversees", leader_name: "Hanno Leader", ends_on: null }),
    ]);

    h.userId = OUTSIDER;
    expect((await getPeople(new Request("http://localhost/x"), slugCtx("media"))).status).toBe(403);
  });

  it("returns the current ministry cycle and leaves individual OKRs out", async () => {
    const response = await getOkrs(new Request("http://localhost/x"), slugCtx("media"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.cycle.slug).toBe("2026");
    expect(body.objectives.map((row: { title: string }) => row.title)).toEqual(["Tell the story"]);
    expect(body.objectives[0].key_results[0]).toMatchObject({ description: "Publish 12 films", current_value: 4 });

    h.userId = OUTSIDER;
    expect((await getOkrs(new Request("http://localhost/x"), slugCtx("media"))).status).toBe(403);
  });

  it("lets a member read rocks and only a leader create or update them", async () => {
    const listed = await getRocks(new Request("http://localhost/api/departments/media/rocks"), slugCtx("media"));
    expect(listed.status).toBe(200);
    const listBody = await listed.json();
    expect(listBody.can_edit).toBe(false);
    expect(listBody.rocks.map((row: { title: string }) => row.title)).toEqual(["Finish the recap"]);

    const denied = await postRock(
      jsonRequest("http://localhost/api/departments/media/rocks", "POST", { title: "Ship the film" }),
      slugCtx("media")
    );
    expect(denied.status).toBe(403);
    expect(h.adminQueries.some((query) => query.action === "insert")).toBe(false);

    h.userId = LEADER;
    const created = await postRock(
      jsonRequest("http://localhost/api/departments/media/rocks", "POST", {
        title: "Ship the film",
        owner_user_id: LEADER,
      }),
      slugCtx("media")
    );
    expect(created.status).toBe(200);
    const createdBody = await created.json();
    expect(createdBody.rock).toMatchObject({ title: "Ship the film", owner_name: "Hanno Leader", status: "on_track" });
    const inserted = h.adminQueries.find((query) => query.table === "rocks" && query.action === "insert");
    expect(inserted?.payload).toMatchObject({
      staff_ministry_id: MEDIA,
      title: "Ship the film",
      quarter: currentQuarter(),
      created_by: LEADER,
      status: "on_track",
    });

    h.userId = MEMBER;
    const memberPatch = await patchRock(
      jsonRequest("http://localhost/x", "PATCH", { status: "done" }),
      rockCtx("media", ROCK_ID)
    );
    expect(memberPatch.status).toBe(403);

    h.userId = LEADER;
    const patched = await patchRock(
      jsonRequest("http://localhost/x", "PATCH", { status: "done" }),
      rockCtx("media", ROCK_ID)
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).rock.status).toBe("done");

    const missing = await patchRock(
      jsonRequest("http://localhost/x", "PATCH", { status: "done" }),
      rockCtx("media", OTHER_ROCK_ID)
    );
    expect(missing.status).toBe(404);

    const badQuarter = await getRocks(
      new Request("http://localhost/api/departments/media/rocks?quarter=nope"),
      slugCtx("media")
    );
    expect(badQuarter.status).toBe(400);
  });

  it("lets Finances & Legal read every budget and only a leader edit it", async () => {
    h.userId = FINANCE_USER;
    const read = await getBudget(new Request("http://localhost/x"), slugCtx("media"));
    expect(read.status).toBe(200);
    const readBody = await read.json();
    expect(readBody.can_edit).toBe(false);
    expect(readBody.links[0]).toMatchObject({
      id: LINK_ID,
      budget_cents: 500000,
      spend_cents: 125000,
      currency: "ZAR",
      project: { name: "Media", org_key: "npc", org_name: "FFSA NPC" },
    });

    const edit = await patchBudget(
      jsonRequest("http://localhost/x", "PATCH", { link_id: LINK_ID, budget_cents: 1 }),
      slugCtx("media")
    );
    expect(edit.status).toBe(403);
    expect(h.adminQueries.some((query) => query.action === "update")).toBe(false);

    h.userId = MEMBER;
    expect((await getBudget(new Request("http://localhost/x"), slugCtx("media"))).status).toBe(403);
    expect(
      (
        await patchBudget(
          jsonRequest("http://localhost/x", "PATCH", { link_id: LINK_ID, budget_cents: 1 }),
          slugCtx("media")
        )
      ).status
    ).toBe(403);

    h.userId = LEADER;
    const spend = await patchBudget(
      jsonRequest("http://localhost/x", "PATCH", { link_id: LINK_ID, spend_cents: 1 }),
      slugCtx("media")
    );
    expect(spend.status).toBe(400);
    expect(h.adminQueries.some((query) => query.action === "update")).toBe(false);

    const saved = await patchBudget(
      jsonRequest("http://localhost/x", "PATCH", { link_id: LINK_ID, budget_cents: 600000 }),
      slugCtx("media")
    );
    expect(saved.status).toBe(200);
    expect((await saved.json()).link).toMatchObject({ budget_cents: 600000, spend_cents: 125000 });
    expect(h.adminQueries.find((query) => query.action === "update")?.payload).toMatchObject({
      budget_cents: 600000,
      updated_by: LEADER,
    });
  });

  it("rolls every department's rocks up for Leadership Team and admins only", async () => {
    h.userId = LEADERSHIP_MEMBER;
    const response = await getRollup(new Request("http://localhost/api/departments/rocks"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.quarter).toBe(currentQuarter());
    expect(body.departments.map((row: { slug: string }) => row.slug)).toEqual([
      "leadership_team",
      "prayer_and_worship",
      "media",
      "hulk",
      "operations",
      "finances_legal",
    ]);
    const media = body.departments.find((row: { slug: string }) => row.slug === "media");
    expect(media.rocks.map((row: { title: string }) => row.title)).toEqual(["Finish the recap"]);
    expect(body.departments.some((row: { slug: string }) => row.slug === "woven")).toBe(false);

    h.userId = LEADER;
    expect((await getRollup(new Request("http://localhost/x"))).status).toBe(403);
    h.userId = ADMIN;
    expect((await getRollup(new Request("http://localhost/x"))).status).toBe(200);
    h.userId = LEADERSHIP_MEMBER;
    const bad = await getRollup(new Request("http://localhost/api/departments/rocks?quarter=2026-Q5"));
    expect(bad.status).toBe(400);
  });

  it("lists service ownership for any active user", async () => {
    h.userId = OUTSIDER;
    const list = await getServices();
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.services.map((row: { service_key: string }) => row.service_key)).toEqual([
      "communications",
      "contacts",
      "evangelism",
      "gear_hire",
    ]);

    const one = await getService(new Request("http://localhost/x"), keyCtx("gear_hire"));
    expect(one.status).toBe(200);
    const gear = await one.json();
    expect(gear.admin_href).toBe("/bookings/equipment/gear");
    expect(gear.owners.map((owner: { name: string }) => owner.name)).toEqual([
      "Media",
      "Operations",
      "Prayer & Worship",
    ]);
  });
});
