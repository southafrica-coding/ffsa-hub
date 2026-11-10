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
  ROCK_ID,
  MEMBER,
  OUTSIDER,
  PROJECT_ID,
  makeDepartmentWorld,
  resolveDepartmentWorld,
  type DepartmentWorld,
} from "@/lib/testing/department-world";

const h = vi.hoisted(() => ({
  userId: null as string | null,
  world: null as DepartmentWorld | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    createFakeSupabase({
      user: h.userId ? { id: h.userId } : null,
      resolve: (query: FakeQuery) => {
        const world = h.world as DepartmentWorld;
        world.callerId = h.userId;
        return resolveDepartmentWorld(world, query);
      },
    }).client,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createFakeSupabase({
      user: h.userId ? { id: h.userId } : null,
      resolve: (query: FakeQuery) => {
        const world = h.world as DepartmentWorld;
        world.callerId = h.userId;
        return resolveDepartmentWorld(world, query);
      },
    }).client,
}));

const { GET: listDepartments } = await import("./route");
const { GET: getHome } = await import("./[slug]/route");
const { GET: getPeople } = await import("./[slug]/people/route");
const { GET: getOkrs } = await import("./[slug]/okrs/route");
const { GET: getRocks, POST: postRock } = await import("./[slug]/rocks/route");
const { PATCH: patchRock } = await import("./[slug]/rocks/[rockId]/route");
const { GET: getBudget, POST: postBudget, PATCH: patchBudget } = await import("./[slug]/budget/route");
const { GET: getOverview } = await import("./[slug]/overview/route");
const { GET: getRollup } = await import("./rocks/route");
const { GET: getServices } = await import("../services/route");
const { GET: getService } = await import("../services/[key]/route");
const { GET: getMeHome } = await import("../me/home/route");

const slug = (value: string) => ({ params: Promise.resolve({ slug: value }) });
const serviceKey = (value: string) => ({ params: Promise.resolve({ key: value }) });
const rockParams = { params: Promise.resolve({ slug: "media", rockId: ROCK_ID }) };
const write = (method: string) =>
  new Request("http://localhost/x", { method, body: "{}", headers: { "content-type": "application/json" } });

beforeEach(() => {
  h.userId = MEMBER;
  h.world = makeDepartmentWorld();
});

describe("department visibility", () => {
  it("gives a finance-only viewer the budget and nothing else", async () => {
    h.userId = FINANCE_USER;
    const home = await getHome(new Request("http://localhost/x"), slug("media"));
    expect(home.status).toBe(200);
    const body = await home.json();
    expect(body.access).toMatchObject({
      canSeeDepartmentDetail: false,
      canSeeBudget: true,
      canEditBudget: false,
      canEditRocks: false,
      canSeePeopleEmails: false,
    });
    expect(body.department.budgetOnly).toBe(true);
    expect(body.department.memberCount).toBeNull();
    expect(body.department.purpose).toBe("Cameras and stories");
    expect(body.department.cluster).toBeNull();
    expect(body.people).toBeNull();
    expect(body.okrs).toBeNull();
    expect(body.rocks).toBeNull();
    expect(body.servicesRun).toBeNull();
    expect(body.subMinistries).toBeNull();
    expect(body.budget.links[0]).toMatchObject({
      projectId: PROJECT_ID,
      name: "Media",
      budgetCents: 500000,
      spentCents: 125000,
      currency: "ZAR",
    });

    expect((await getPeople(new Request("http://localhost/x"), slug("media"))).status).toBe(404);
    expect((await getOkrs(new Request("http://localhost/x"), slug("media"))).status).toBe(404);
    expect((await getRocks(new Request("http://localhost/x"), slug("media"))).status).toBe(404);
    expect((await getBudget(new Request("http://localhost/x"), slug("media"))).status).toBe(200);

    const list = await listDepartments();
    const media = (await list.json()).find((row: { slug: string }) => row.slug === "media");
    expect(media.budgetOnly).toBe(true);
    expect(media.memberCount).toBeNull();
    expect(media.access.canSeeBudget).toBe(true);
  });

  it("gives a Leadership-only viewer detail with a null budget", async () => {
    h.userId = LEADERSHIP_MEMBER;
    const home = await getHome(new Request("http://localhost/x"), slug("media"));
    expect(home.status).toBe(200);
    const body = await home.json();
    expect(body.access.canSeeDepartmentDetail).toBe(true);
    expect(body.access.canSeeBudget).toBe(false);
    expect(body.budget).toBeNull();
    expect(body.people).not.toBeNull();
    expect(body.people.every((person: { email: string | null }) => person.email == null)).toBe(true);
    expect((await getBudget(new Request("http://localhost/x"), slug("media"))).status).toBe(404);
    expect((await getPeople(new Request("http://localhost/x"), slug("media"))).status).toBe(200);
  });

  it("returns 404 for an outsider and for a blocked slug", async () => {
    h.userId = OUTSIDER;
    expect((await getHome(new Request("http://localhost/x"), slug("media"))).status).toBe(404);
    expect((await getBudget(new Request("http://localhost/x"), slug("media"))).status).toBe(404);
    h.userId = ADMIN;
    expect((await getHome(new Request("http://localhost/x"), slug("woven"))).status).toBe(404);
    expect((await getHome(new Request("http://localhost/x"), slug("no_ministry"))).status).toBe(404);
    h.userId = null;
    expect((await getHome(new Request("http://localhost/x"), slug("media"))).status).toBe(401);
  });

  it("shows emails to a leader and keeps a missing rock due date null", async () => {
    h.userId = LEADER;
    const people = await getPeople(new Request("http://localhost/x"), slug("media"));
    const roster = (await people.json()).people as Array<{ email: string | null; name: string }>;
    expect(roster.find((row) => row.name === "Hanno Leader")?.email).toBe("hanno@example.com");
    const home = await (await getHome(new Request("http://localhost/x"), slug("media"))).json();
    expect(home.access.canEditRocks).toBe(true);
    expect(home.rocks[0].dueOn).toBe("2026-12-01");
    expect(home.budget).not.toBeNull();
    expect(home.budget.links[0].id === LINK_ID || home.budget.links[0].projectId === PROJECT_ID).toBe(true);
  });

  it("denies budget and rock writes to a point leader who is not a leader", async () => {
    h.userId = MEMBER;
    const membership = h.world!.memberships.find((row) => row.user_id === MEMBER && row.staff_ministry_id === MEDIA);
    if (membership) {
      membership.member_role = "member";
      membership.is_point_leader = true;
    }
    const home = await getHome(new Request("http://localhost/x"), slug("media"));
    expect(home.status).toBe(200);
    const body = await home.json();
    expect(body.access).toMatchObject({
      canSeeDepartmentDetail: true,
      canSeeBudget: false,
      canEditBudget: false,
      canEditRocks: false,
      canSeePeopleEmails: false,
    });
    expect(body.budget).toBeNull();
    expect(body.viewerMemberships).toEqual(
      expect.arrayContaining([expect.objectContaining({ departmentSlug: "media", isPointLeader: true })])
    );
    const people = await (await getPeople(new Request("http://localhost/x"), slug("media"))).json();
    expect(people.people.every((person: { email: string | null }) => person.email == null)).toBe(true);

    const write = { method: "POST", body: "{}", headers: { "content-type": "application/json" } };
    expect((await postBudget(new Request("http://localhost/x", write), slug("media"))).status).toBe(404);
    expect((await postRock(new Request("http://localhost/x", write), slug("media"))).status).toBe(404);
    expect(
      (await patchRock(new Request("http://localhost/x", { ...write, method: "PATCH" }), {
        params: Promise.resolve({ slug: "media", rockId: ROCK_ID }),
      })).status
    ).toBe(404);
  });

  it("returns 403 when the account is inactive or a membership lookup fails", async () => {
    const call = () =>
      Promise.all([
        listDepartments(),
        getHome(new Request("http://localhost/x"), slug("media")),
        getOverview(new Request("http://localhost/x"), slug("media")),
        getPeople(new Request("http://localhost/x"), slug("media")),
        getOkrs(new Request("http://localhost/x"), slug("media")),
        getRocks(new Request("http://localhost/x"), slug("media")),
        getBudget(new Request("http://localhost/x"), slug("media")),
        getRollup(new Request("http://localhost/api/departments/rocks")),
      ]);

    h.userId = INACTIVE_ADMIN;
    for (const response of await call()) expect(response.status).toBe(403);

    h.userId = MEMBER;
    h.world!.errors = { users: true };
    for (const response of await call()) expect(response.status).toBe(403);

    h.world = makeDepartmentWorld();
    h.world.errors = { staff_ministry_members: true };
    for (const response of await call()) expect(response.status).toBe(403);
  });

  it("returns 403 for writes, services, and home when the account or lookup fails", async () => {
    const call = () =>
      Promise.all([
        postRock(write("POST"), slug("media")),
        patchRock(write("PATCH"), rockParams),
        postBudget(write("POST"), slug("media")),
        patchBudget(write("PATCH"), slug("media")),
        getServices(),
        getService(new Request("http://localhost/x"), serviceKey("gear_hire")),
        getMeHome(),
      ]);

    h.userId = INACTIVE_ADMIN;
    for (const response of await call()) expect(response.status).toBe(403);

    h.userId = MEMBER;
    h.world!.errors = { users: true };
    for (const response of await call()) expect(response.status).toBe(403);

    h.world = makeDepartmentWorld();
    h.world.errors = { staff_ministry_members: true };
    expect((await postRock(write("POST"), slug("media"))).status).toBe(403);
    expect((await patchRock(write("PATCH"), rockParams)).status).toBe(403);
    expect((await postBudget(write("POST"), slug("media"))).status).toBe(403);
    expect((await patchBudget(write("PATCH"), slug("media"))).status).toBe(403);

    h.world = makeDepartmentWorld();
    h.world.errors = { service_owners: true };
    expect((await getServices()).status).toBe(403);
    expect((await getMeHome()).status).toBe(403);
    expect((await getService(new Request("http://localhost/x"), serviceKey("gear_hire"))).status).toBe(403);
  });

  it("does not reveal whether a service key exists to a caller who cannot use it", async () => {
    h.userId = OUTSIDER;
    h.world!.errors = { services: true, service_owners: true };
    const hidden = await getService(new Request("http://localhost/x"), serviceKey("communications"));
    const missing = await getService(new Request("http://localhost/x"), serviceKey("not_a_service"));
    expect(hidden.status).toBe(403);
    expect(missing.status).toBe(hidden.status);
  });

  it("returns quarter rocks for every home from one rocks query", async () => {
    h.userId = LEADERSHIP_MEMBER;
    const response = await getRollup(new Request("http://localhost/api/departments/rocks"));
    expect(response.status).toBe(200);
    const body = await response.json();
    const media = body.departments.find((row: { slug: string }) => row.slug === "media");
    expect(media.rocks[0]).toMatchObject({ id: ROCK_ID, title: "Finish the recap", dueOn: "2026-12-01" });
    expect(media.rocks[0].created_by).toBeUndefined();
  });

  it("returns a bare services array whose gear_hire audience follows the open_to_all row", async () => {
    h.userId = OUTSIDER;
    const response = await getServices();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    const gear = body.find((row: { id: string }) => row.id === "gear_hire");
    expect(gear.audience).toBe("all_signed_in");
    expect(gear.owners.some((owner: { role: string }) => owner.role === "manager")).toBe(true);
  });
});
