import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  filterValue,
  permissionWorldResolver,
  type FakeQuery,
  type FakeResult,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

// GET /api/mobile/staff-decisions and /api/mobile/staff-decisions/[programId]:
// the web /staff-decisions gate (Leadership Team or super_admin — role-only,
// a plain admin is not enough), service-role reads only after the check.

const state = vi.hoisted(() => ({
  user: null as unknown as { client: unknown; queries: FakeQuery[] },
  admin: null as unknown as { client: unknown; queries: FakeQuery[] },
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.user.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.admin.client }));

import { GET } from "./route";
import { GET as DETAIL } from "./[programId]/route";

const LT_2026 = "11111111-1111-4111-8111-111111111111";
const LT_2025 = "22222222-2222-4222-8222-222222222222";
const DTS = "33333333-3333-4333-8333-333333333333";

const PROGRAMS = [
  { id: LT_2025, name: "Leadership Track 2025", code: "L-TRACK", status: "archived" },
  { id: LT_2026, name: "Leadership Track 2026", code: "TRACK", status: "active" },
  { id: DTS, name: "DTS 2026", code: "DTS", status: "active" },
];

const ENROLLMENTS = [
  { id: "e1", program_id: LT_2026, user_id: "s1", status: "arrived", removed_at: null, person_email: null, person_info: null },
  { id: "e2", program_id: LT_2026, user_id: "s2", status: "graduated", removed_at: null, person_email: null, person_info: null },
  { id: "e3", program_id: LT_2026, user_id: null, status: "arrived", removed_at: null, person_email: "c@x.test", person_info: { first_name: "Cara", last_name: "Lee" } },
  // Not listed: never arrived, no decision.
  { id: "e4", program_id: LT_2026, user_id: "s4", status: "accepted", removed_at: null, person_email: null, person_info: null },
  { id: "e5", program_id: LT_2025, user_id: "s5", status: "graduated", removed_at: null, person_email: null, person_info: null },
];

const DECISIONS = [
  { enrollment_id: "e1", program_id: LT_2026, accepted: true, note: null, decided_at: "2026-10-01T10:00:00Z", decided_by: "lt1" },
  { enrollment_id: "e2", program_id: LT_2026, accepted: false, note: "Not this year", decided_at: "2026-10-02T10:00:00Z", decided_by: "lt1" },
];

const USERS = [
  { id: "s1", first_name: "Ann", last_name: "Bell", email: "ann@x.test", department: null },
  { id: "s2", first_name: "Ben", last_name: "Cole", email: "ben@x.test", department: "media" },
  { id: "s5", first_name: "Eve", last_name: "Fox", email: "eve@x.test", department: null },
  { id: "lt1", first_name: "Lee", last_name: "Team", email: "lee@x.test", department: null },
];

const MINISTRIES = [
  { name: "Leadership Team", slug: "leadership_team" },
  { name: "Media", slug: "media" },
  { name: "Worship", slug: "worship" },
];

function adminResolve(q: FakeQuery): FakeResult {
  const programId = filterValue(q, "eq", "program_id");
  switch (q.table) {
    case "programs": {
      const id = filterValue(q, "eq", "id");
      if (id) return { data: PROGRAMS.filter((p) => p.id === id) };
      const codes = filterValue(q, "in", "code") as string[];
      return { data: PROGRAMS.filter((p) => codes.includes(p.code)) };
    }
    case "enrollments":
      return { data: ENROLLMENTS.filter((e) => e.program_id === programId) };
    case "staff_acceptance_decisions":
      return { data: DECISIONS.filter((d) => d.program_id === programId) };
    case "users": {
      const ids = filterValue(q, "in", "id") as string[];
      return { data: USERS.filter((u) => ids.includes(u.id)) };
    }
    case "user_roles":
      // Only s2 already holds the staff role.
      return { data: [{ user_id: "s2" }] };
    default:
      return { data: [] };
  }
}

function as(world: PermissionWorld | null) {
  const perms = world ? permissionWorldResolver(world) : () => null;
  state.user = createFakeSupabase({
    user: world ? { id: "u1" } : null,
    resolve: (q) => (q.table === "staff_ministries" ? { data: MINISTRIES } : perms(q) ?? { data: [] }),
  });
  state.admin = createFakeSupabase({ user: null, resolve: adminResolve });
}

const ADMIN: PermissionWorld = { roles: [{ id: "r-a", name: "admin" }], direct: [] };
const SUPER: PermissionWorld = { roles: [{ id: "r-s", name: "super_admin" }], direct: [] };
const STAFF: PermissionWorld = { roles: [{ id: "r-st", name: "staff" }], direct: [] };
const LEADERSHIP: PermissionWorld = { roles: [{ id: "r-l", name: "leadership_team" }], direct: [] };

const params = (programId: string) => ({ params: Promise.resolve({ programId }) });
const req = () => new Request("http://x.test");

describe("GET /api/mobile/staff-decisions", () => {
  beforeEach(() => as(LEADERSHIP));

  it("401 when not signed in, before any read", async () => {
    as(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(state.admin.queries).toHaveLength(0);
  });

  it.each([
    ["plain admin", ADMIN],
    ["staff", STAFF],
  ])("403 for %s without leadership_team, never touching the service-role client", async (_l, world) => {
    as(world);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(state.admin.queries).toHaveLength(0);
  });

  it("checks the role with the caller's own client", async () => {
    await GET();
    const q = state.user.queries.find((x) => x.table === "user_roles")!;
    expect(filterValue(q, "eq", "user_id")).toBe("u1");
    expect(filterValue(q, "in", "roles.name")).toEqual(["leadership_team", "super_admin"]);
  });

  it("200 for a super admin without leadership_team", async () => {
    as(SUPER);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).schools).toHaveLength(2);
  });

  it("200 for Leadership Team: Leadership Track schools only, newest first, with counts", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      schools: [
        { id: LT_2026, name: "Leadership Track 2026", status: "active", archived: false, total: 3, yes: 1, no: 1, undecided: 1 },
        { id: LT_2025, name: "Leadership Track 2025", status: "archived", archived: true, total: 1, yes: 0, no: 0, undecided: 1 },
      ],
    });
  });
});

describe("GET /api/mobile/staff-decisions/[programId]", () => {
  beforeEach(() => as(LEADERSHIP));

  it("401 when not signed in", async () => {
    as(null);
    expect((await DETAIL(req(), params(LT_2026))).status).toBe(401);
    expect(state.admin.queries).toHaveLength(0);
  });

  it("400 for an id that isn't a uuid", async () => {
    expect((await DETAIL(req(), params("nope"))).status).toBe(400);
    expect(state.admin.queries).toHaveLength(0);
  });

  it("403 for a plain admin without leadership_team", async () => {
    as(ADMIN);
    const res = await DETAIL(req(), params(LT_2026));
    expect(res.status).toBe(403);
    expect(state.admin.queries).toHaveLength(0);
  });

  it("404 for a school that isn't Leadership Track, and for one that doesn't exist", async () => {
    expect((await DETAIL(req(), params(DTS))).status).toBe(404);
    expect((await DETAIL(req(), params("44444444-4444-4444-8444-444444444444"))).status).toBe(404);
    expect(state.admin.queries.some((q) => q.table === "enrollments")).toBe(false);
  });

  it("200 for Leadership Team: the school with counts, rows sorted by name, departments", async () => {
    const res = await DETAIL(req(), params(LT_2026));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.school).toEqual({
      id: LT_2026,
      name: "Leadership Track 2026",
      status: "active",
      archived: false,
      total: 3,
      yes: 1,
      no: 1,
      undecided: 1,
    });
    expect(body.rows.map((r: { name: string }) => r.name)).toEqual(["Ann Bell", "Ben Cole", "Cara Lee"]);
    expect(body.rows[0]).toEqual({
      enrollmentId: "e1",
      userId: "s1",
      name: "Ann Bell",
      email: "ann@x.test",
      status: "arrived",
      isStaff: false,
      department: null,
      decision: { accepted: true, note: null, decidedAt: "2026-10-01T10:00:00Z", decidedByName: "Lee Team" },
    });
    expect(body.rows[1]).toMatchObject({ isStaff: true, department: "media", decision: { accepted: false, note: "Not this year" } });
    expect(body.rows[2]).toMatchObject({ userId: null, email: "c@x.test", decision: null });
    // leadership_team is a real ministry in the fixture and is not offered.
    expect(body.departmentOptions).toEqual([
      { value: "media", label: "Media" },
      { value: "worship", label: "Worship" },
    ]);
    // Departments come from the caller's own client, as on the web tab.
    expect(state.user.queries.some((q) => q.table === "staff_ministries")).toBe(true);
    expect(state.admin.queries.some((q) => q.table === "staff_ministries")).toBe(false);
  });
});
