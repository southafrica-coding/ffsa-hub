import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  filterValue,
  permissionWorldResolver,
  type FakeQuery,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

// GET /api/mobile/okrs: the wall, open to any signed-in person. The gap list
// ("not started") only for admin / leadership team / ministry leaders, as on
// the web; never the service-role client.

const state = vi.hoisted(() => ({
  user: null as unknown as { client: unknown; queries: FakeQuery[] },
  adminCalls: 0,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.user.client }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    state.adminCalls++;
    throw new Error("the wall must not use the service role");
  },
}));

import { GET } from "./route";

const CYCLES = [
  { id: "c26", name: "2026", slug: "2026", starts_on: "2026-01-01", ends_on: "2026-12-31", is_current: true },
  { id: "c25", name: "2025", slug: "2025", starts_on: "2025-01-01", ends_on: "2025-12-31", is_current: false },
];

const MINISTRIES = [
  { id: "m-dts", name: "DTS", slug: "dts", is_active: true, ministry_type: "main" },
  { id: "m-worship", name: "Worship", slug: "worship", is_active: true, ministry_type: "main" },
];

const OBJECTIVES = [
  {
    id: "o1",
    cycle_id: "c26",
    scope: "ministry",
    staff_ministry_id: "m-dts",
    okr_team_id: null,
    position: 1,
    title: "Grow",
    okr_key_results: [{ id: "kr1", current_status: "stuck" }],
  },
];

type World = PermissionWorld & { led?: string[]; cycles?: unknown[]; cycleError?: string };

function as(world: World | null) {
  state.adminCalls = 0;
  state.user = createFakeSupabase({
    user: world ? { id: "u1" } : null,
    resolve: (q) => {
      if (!world) return { data: [] };
      const perm = permissionWorldResolver(world)(q);
      if (perm) return perm;
      if (q.table === "okr_cycles") return world.cycleError ? { error: { message: world.cycleError } } : { data: world.cycles ?? CYCLES };
      if (q.table === "okr_objectives") return { data: filterValue(q, "eq", "cycle_id") === "c26" ? OBJECTIVES : [] };
      if (q.table === "staff_ministries") return { data: MINISTRIES };
      if (q.table === "staff_ministry_members") return { data: (world.led ?? []).map((id) => ({ staff_ministry_id: id })) };
      return { data: [] };
    },
  });
}

const STAFF: World = { roles: [{ id: "r-staff", name: "staff" }], direct: [] };
const req = (qs = "") => new Request(`https://hub.test/api/mobile/okrs${qs}`);

describe("GET /api/mobile/okrs", () => {
  beforeEach(() => as(STAFF));

  it("401 when not signed in", async () => {
    as(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("any signed-in person reads the wall, no gap list, no cycles link", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.cycle.slug).toBe("2026");
    expect(body.seesGaps).toBe(false);
    expect(body.canManageCycles).toBe(false);
    expect(body.totals).toMatchObject({ groups: 2, groupsStarted: 1, objectives: 1, keyResults: 1, stuck: 1 });
    expect(body.sections[0].started.map((o: { name: string }) => o.name)).toEqual(["DTS"]);
    expect(body.sections[0].notStarted).toEqual([]);
    expect(state.adminCalls).toBe(0);
  });

  it("only reads ministry-scope objectives for the chosen cycle", async () => {
    await GET(req("?cycle=2025"));
    const q = state.user.queries.find((x) => x.table === "okr_objectives")!;
    expect(filterValue(q, "eq", "cycle_id")).toBe("c25");
    expect(filterValue(q, "eq", "scope")).toBe("ministry");
  });

  it("a ministry leader sees the not-started list", async () => {
    as({ ...STAFF, led: ["m-worship"] });
    const body = await (await GET(req())).json();
    expect(body.seesGaps).toBe(true);
    expect(body.canManageCycles).toBe(false);
    expect(body.sections[0].notStarted.map((o: { name: string }) => o.name)).toEqual(["Worship"]);
  });

  it("leadership team sees gaps and may manage cycles", async () => {
    as({ roles: [{ id: "r-lt", name: "leadership_team" }], direct: [] });
    const body = await (await GET(req())).json();
    expect(body.seesGaps).toBe(true);
    expect(body.canManageCycles).toBe(true);
  });

  it("admin sees gaps and may manage cycles", async () => {
    as({ roles: [{ id: "r-a", name: "admin" }], direct: [] });
    const body = await (await GET(req())).json();
    expect(body.seesGaps).toBe(true);
    expect(body.canManageCycles).toBe(true);
  });

  it("no gap list on a closed cycle", async () => {
    as({ ...STAFF, led: ["m-worship"] });
    const body = await (await GET(req("?cycle=2025"))).json();
    expect(body.cycle.isCurrent).toBe(false);
    expect(body.sections).toEqual([]);
  });

  it("no cycle yet: an empty wall, not an error", async () => {
    as({ ...STAFF, cycles: [] });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cycle: null, cycles: [], sections: [] });
  });

  it("400 on an oversized cycle slug", async () => {
    expect((await GET(req(`?cycle=${"x".repeat(200)}`))).status).toBe(400);
  });

  it("500 when the cycles read fails", async () => {
    as({ ...STAFF, cycleError: "boom" });
    expect((await GET(req())).status).toBe(500);
  });
});
