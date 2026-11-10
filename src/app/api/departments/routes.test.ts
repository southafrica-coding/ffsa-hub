import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeQuery } from "@/lib/testing/fake-supabase";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import {
  ADMIN,
  FINANCE_USER,
  LEADER,
  LEADERSHIP_MEMBER,
  LINK_ID,
  MEDIA,
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
      resolve: (query: FakeQuery) => resolveDepartmentWorld(h.world as DepartmentWorld, query),
    }).client,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createFakeSupabase({
      user: h.userId ? { id: h.userId } : null,
      resolve: (query: FakeQuery) => resolveDepartmentWorld(h.world as DepartmentWorld, query),
    }).client,
}));

const { GET: listDepartments } = await import("./route");
const { GET: getHome } = await import("./[slug]/route");
const { GET: getPeople } = await import("./[slug]/people/route");
const { GET: getOkrs } = await import("./[slug]/okrs/route");
const { GET: getRocks } = await import("./[slug]/rocks/route");
const { GET: getBudget } = await import("./[slug]/budget/route");
const { GET: getServices } = await import("../services/route");

const slug = (value: string) => ({ params: Promise.resolve({ slug: value }) });

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
    const roster = (await people.json()).roster as Array<{ email: string | null; user_id: string }>;
    expect(roster.find((row) => row.user_id === LEADER)?.email).toBe("hanno@example.com");
    const home = await (await getHome(new Request("http://localhost/x"), slug("media"))).json();
    expect(home.access.canEditRocks).toBe(true);
    expect(home.rocks[0].dueOn).toBe("2026-12-01");
    expect(home.budget).not.toBeNull();
    expect(home.budget.links[0].id === LINK_ID || home.budget.links[0].projectId === PROJECT_ID).toBe(true);
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
