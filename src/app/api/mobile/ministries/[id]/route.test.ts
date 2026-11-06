import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  filterValue,
  permissionWorldResolver,
  type FakeQuery,
  type FakeResult,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

// GET /api/mobile/ministries/[id]: the web /ministry/[id] page's gate —
// canView = admin || leads this ministry || Leadership Team,
// canManage = admin || leads this ministry — and only the fields it shows.

const state = vi.hoisted(() => ({
  user: null as unknown as { client: unknown; queries: FakeQuery[] },
  admin: null as unknown as { client: unknown; queries: FakeQuery[] },
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.user.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.admin.client }));

import { GET } from "./route";

const MEDIA = "22222222-2222-4222-8222-222222222222";
const OTHER = "44444444-4444-4444-8444-444444444444";
const CAMS = "55555555-5555-4555-8555-555555555555";

const MINISTRY = { id: MEDIA, name: "Media", slug: "media", description: "Cameras", is_active: true, sort_order: 1, ministry_type: "main" };
const ROSTER = [
  {
    id: "m1",
    member_role: "leader",
    is_point_leader: true,
    status: "active",
    created_at: "2026-01-01",
    user: { id: "p1", first_name: "Ann", last_name: "Lee", display_name: null, preferred_name: null, email: "ann@x.test", job_title: "Pastor", avatar_url: "a.png", status: "active" },
    categories: [{ subcategory_id: CAMS, is_point_leader: true }],
  },
  {
    id: "m2",
    member_role: "member",
    is_point_leader: false,
    status: "pending",
    created_at: "2026-02-01",
    user: { id: "p2", first_name: null, last_name: null, display_name: "Bo", preferred_name: null, email: "bo@x.test", job_title: null, avatar_url: null, status: "active" },
    categories: [],
  },
];

type World = PermissionWorld & { leads?: string[] };

function as(world: World | null, opts: { missing?: boolean; adminError?: string } = {}) {
  const perms = world ? permissionWorldResolver(world) : () => null;
  state.user = createFakeSupabase({
    user: world ? { id: "u1" } : null,
    resolve: (q): FakeResult => {
      if (q.table === "staff_ministry_members") {
        const id = filterValue(q, "eq", "staff_ministry_id");
        return { data: (world?.leads ?? []).includes(id as string) ? [{ id: "lead-row" }] : [] };
      }
      return perms(q) ?? { data: [] };
    },
  });
  state.admin = createFakeSupabase({
    user: null,
    resolve: (q): FakeResult => {
      if (q.table === "staff_ministries") {
        if (opts.missing) return { data: null, error: { code: "PGRST116", message: "no rows" } };
        if (opts.adminError) return { error: { message: opts.adminError } };
        return { data: [MINISTRY] };
      }
      if (q.table === "staff_ministry_members") return { data: ROSTER };
      if (q.table === "staff_ministry_subcategories") return { data: [{ id: CAMS, staff_ministry_id: MEDIA, name: "Cameras", sort_order: 0 }] };
      return { data: [] };
    },
  });
}

const call = (id: string = MEDIA) => GET(new Request("http://x.test"), { params: Promise.resolve({ id }) });

const VOLUNTEER: World = { roles: [{ id: "r-ss", name: "self_service" }], direct: [] };
const ADMIN: World = { roles: [{ id: "r-a", name: "super_admin" }], direct: [] };
const LEADERSHIP: World = { roles: [{ id: "r-l", name: "leadership_team" }], direct: [] };
const LEADER: World = { roles: [{ id: "r-ml", name: "ministry_leader" }], direct: [], leads: [MEDIA] };
const OTHER_LEADER: World = { roles: [{ id: "r-ml", name: "ministry_leader" }], direct: [], leads: [OTHER] };

describe("GET /api/mobile/ministries/[id]", () => {
  beforeEach(() => as(LEADER));

  it("401 when not signed in", async () => {
    as(null);
    expect((await call()).status).toBe(401);
    expect(state.admin.queries).toHaveLength(0);
  });

  it("400 for an id that isn't a uuid, before any access query", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(400);
    expect(state.user.queries).toHaveLength(0);
    expect(state.admin.queries).toHaveLength(0);
  });

  it("403 for a volunteer, without a service-role read", async () => {
    as(VOLUNTEER);
    const res = await call();
    expect(res.status).toBe(403);
    expect(state.admin.queries).toHaveLength(0);
  });

  it("403 for the leader of a different ministry", async () => {
    as(OTHER_LEADER);
    expect((await call()).status).toBe(403);
    expect(state.admin.queries).toHaveLength(0);
  });

  it("this ministry's leader may view and manage; payload is the web's fields only", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      ministry: { id: MEDIA, name: "Media", description: "Cameras", isActive: true, ministryType: "main" },
      canManage: true,
      subcategories: [{ id: CAMS, name: "Cameras" }],
      roster: [
        {
          membershipId: "m1",
          userId: "p1",
          name: "Ann Lee",
          email: "ann@x.test",
          role: "leader",
          status: "active",
          isPointLeader: true,
          categoryIds: [CAMS],
          pointLeaderCategoryIds: [CAMS],
        },
        {
          membershipId: "m2",
          userId: "p2",
          name: "Bo",
          email: "bo@x.test",
          role: "member",
          status: "pending",
          isPointLeader: false,
          categoryIds: [],
          pointLeaderCategoryIds: [],
        },
      ],
    });
    // Never the pickable-users read the web page does.
    expect(state.admin.queries.some((q) => q.table === "users")).toBe(false);
  });

  it("Leadership Team may view any ministry but not manage it", async () => {
    as(LEADERSHIP);
    const body = await (await call()).json();
    expect(body.canManage).toBe(false);
    expect(body.roster).toHaveLength(2);
  });

  it("admin may view and manage any ministry", async () => {
    as(ADMIN);
    expect((await (await call(OTHER)).json()).canManage).toBe(true);
  });

  it("404 when the ministry doesn't exist (for someone who could view it)", async () => {
    as(ADMIN, { missing: true });
    const res = await call();
    expect(res.status).toBe(404);
  });

  it("500 JSON on a read error", async () => {
    as(ADMIN, { adminError: "boom" });
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "server_error" });
  });
});
