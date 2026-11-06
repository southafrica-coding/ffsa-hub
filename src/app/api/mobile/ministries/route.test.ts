import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  filterValue,
  permissionWorldResolver,
  type FakeQuery,
  type FakeResult,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

// GET /api/mobile/ministries and /api/mobile/ministries/access: the web
// /ministry page's gate (admin / Leadership Team see all, leaders see the
// ones they lead, nobody else), service-role read only after the check.

const state = vi.hoisted(() => ({
  user: null as unknown as { client: unknown; queries: FakeQuery[] },
  admin: null as unknown as { client: unknown; queries: FakeQuery[] },
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.user.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.admin.client }));

import { GET } from "./route";
import { GET as ACCESS } from "./access/route";

const WORSHIP = "11111111-1111-4111-8111-111111111111";
const MEDIA = "22222222-2222-4222-8222-222222222222";
const KIDS = "33333333-3333-4333-8333-333333333333";

const MINISTRY_ROWS = [
  { id: KIDS, name: "Kids", slug: "kids", description: "", is_active: false, sort_order: 3, ministry_type: "part_time", staff_ministry_members: [{ count: 1 }] },
  { id: MEDIA, name: "Media", slug: "media", description: "Cameras and sound", is_active: true, sort_order: 2, ministry_type: "main", staff_ministry_members: [{ count: 4 }] },
  { id: WORSHIP, name: "Worship", slug: "worship", description: null, is_active: true, sort_order: 1, ministry_type: null, staff_ministry_members: [] },
];

type World = PermissionWorld & { leads?: string[] };

function as(world: World | null, adminError?: string) {
  const perms = world ? permissionWorldResolver(world) : () => null;
  state.user = createFakeSupabase({
    user: world ? { id: "u1" } : null,
    resolve: (q): FakeResult => {
      if (q.table === "staff_ministry_members") {
        return { data: (world?.leads ?? []).map((id) => ({ staff_ministry_id: id })) };
      }
      return perms(q) ?? { data: [] };
    },
  });
  state.admin = createFakeSupabase({
    user: null,
    resolve: (q) =>
      adminError ? { error: { message: adminError } } : q.table === "staff_ministries" ? { data: MINISTRY_ROWS } : { data: [] },
  });
}

const VOLUNTEER: World = { roles: [{ id: "r-ss", name: "self_service" }], direct: [] };
const ADMIN: World = { roles: [{ id: "r-a", name: "admin" }], direct: [] };
const LEADERSHIP: World = { roles: [{ id: "r-l", name: "leadership_team" }], direct: [] };
const LEADER: World = { roles: [{ id: "r-ml", name: "ministry_leader" }], direct: [], leads: [MEDIA] };

describe("GET /api/mobile/ministries", () => {
  beforeEach(() => as(ADMIN));

  it("401 when not signed in, before any read", async () => {
    as(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(state.admin.queries).toHaveLength(0);
  });

  it("403 for a volunteer who leads nothing, and never touches the service-role client", async () => {
    as(VOLUNTEER);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(state.admin.queries).toHaveLength(0);
  });

  it("403 for a ministry_leader role holder who leads no ministry (role alone is not enough)", async () => {
    as({ ...LEADER, leads: [] });
    expect((await GET()).status).toBe(403);
  });

  it("a leader sees only the ministries they lead", async () => {
    as(LEADER);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe("led");
    expect(body.canCreate).toBe(false);
    expect(body.ministries.map((m: { id: string }) => m.id)).toEqual([MEDIA]);
    // The leader rows were read as the caller (their own RLS), active only.
    const q = state.user.queries.find((x) => x.table === "staff_ministry_members")!;
    expect(filterValue(q, "eq", "user_id")).toBe("u1");
    expect(filterValue(q, "eq", "member_role")).toBe("leader");
    expect(filterValue(q, "eq", "status")).toBe("active");
  });

  it("admin sees every ministry and may create; fields are the web's, camelCased", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      scope: "all",
      canCreate: true,
      ministries: [
        { id: KIDS, name: "Kids", description: null, isActive: false, ministryType: "part_time", peopleCount: 1 },
        { id: MEDIA, name: "Media", description: "Cameras and sound", isActive: true, ministryType: "main", peopleCount: 4 },
        { id: WORSHIP, name: "Worship", description: null, isActive: true, ministryType: "main", peopleCount: 0 },
      ],
    });
  });

  it("Leadership Team sees every ministry but may not create", async () => {
    as(LEADERSHIP);
    const body = await (await GET()).json();
    expect(body.scope).toBe("all");
    expect(body.canCreate).toBe(false);
    expect(body.ministries).toHaveLength(3);
  });

  it("500 JSON on a read error", async () => {
    as(ADMIN, "boom");
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "server_error" });
  });
});

describe("GET /api/mobile/ministries/access", () => {
  it("401 when not signed in", async () => {
    as(null);
    expect((await ACCESS()).status).toBe(401);
  });

  it.each([
    ["volunteer", VOLUNTEER, false, "led"],
    ["leader of one", LEADER, true, "led"],
    ["admin", ADMIN, true, "all"],
    ["leadership team", LEADERSHIP, true, "all"],
  ] as const)("%s → canView %s", async (_label, world, canView, scope) => {
    as(world);
    const res = await ACCESS();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ canView, scope });
    // The probe never uses the service-role client.
    expect(state.admin.queries).toHaveLength(0);
  });
});
