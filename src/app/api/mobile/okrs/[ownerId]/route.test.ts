import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  filterValue,
  permissionWorldResolver,
  type FakeQuery,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

// GET /api/mobile/okrs/[ownerId]: one group's OKRs. canEdit is the web
// page's rule: admin or an active leader of that ministry (a team is
// admin-only), and only on the current cycle.

const state = vi.hoisted(() => ({
  user: null as unknown as { client: unknown; queries: FakeQuery[] },
  adminCalls: 0,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.user.client }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    state.adminCalls++;
    throw new Error("the owner page must not use the service role");
  },
}));

import { GET } from "./route";

const DTS = "11111111-1111-4111-8111-111111111111";
const TEAM = "22222222-2222-4222-8222-222222222222";
const MISSING = "33333333-3333-4333-8333-333333333333";

const CYCLES = [
  { id: "c26", name: "2026", slug: "2026", starts_on: "2026-01-01", ends_on: "2026-12-31", is_current: true },
  { id: "c25", name: "2025", slug: "2025", starts_on: "2025-01-01", ends_on: "2025-12-31", is_current: false },
];

const KR = {
  id: "kr1",
  objective_id: "o1",
  position: 1,
  label: "KR1",
  description: "Reach 180 people",
  notes: null,
  timeline: "Q4",
  owner_note: null,
  metric_unit: "people",
  metric_start: 0,
  metric_target: 180,
  current_status: "moving_forward",
  current_value: 90,
  last_checkin_at: "2026-10-01T10:00:00Z",
};

type World = PermissionWorld & { led?: string[] };

function as(world: World | null) {
  state.adminCalls = 0;
  state.user = createFakeSupabase({
    user: world ? { id: "u1" } : null,
    resolve: (q) => {
      if (!world) return { data: [] };
      const perm = permissionWorldResolver(world)(q);
      if (perm) return perm;
      const id = filterValue(q, "eq", "id");
      if (q.table === "staff_ministries") return { data: id === DTS ? [{ id: DTS, name: "DTS", slug: "dts" }] : [] };
      if (q.table === "okr_teams") return { data: id === TEAM ? [{ id: TEAM, name: "The Watchmen", slug: "watchmen" }] : [] };
      if (q.table === "okr_cycles") return { data: CYCLES };
      if (q.table === "okr_objectives") {
        return {
          data: [
            {
              id: "o1",
              cycle_id: filterValue(q, "eq", "cycle_id"),
              scope: "ministry",
              staff_ministry_id: filterValue(q, "eq", "staff_ministry_id") ?? null,
              okr_team_id: filterValue(q, "eq", "okr_team_id") ?? null,
              position: 1,
              title: "Grow the school",
              description: "Why it matters",
              notes: null,
              owner_note: null,
              timeline: null,
              okr_key_results: [KR],
            },
          ],
        };
      }
      if (q.table === "staff_ministry_members") return { data: (world.led ?? []).map((m) => ({ staff_ministry_id: m })) };
      return { data: [] };
    },
  });
}

const STAFF: World = { roles: [{ id: "r-staff", name: "staff" }], direct: [] };
const LEADER: World = { ...STAFF, led: [DTS] };
const ADMIN: World = { roles: [{ id: "r-a", name: "admin" }], direct: [] };

const call = (ownerId: string, qs = "") =>
  GET(new Request(`https://hub.test/api/mobile/okrs/${ownerId}${qs}`), { params: Promise.resolve({ ownerId }) });

describe("GET /api/mobile/okrs/[ownerId]", () => {
  beforeEach(() => as(STAFF));

  it("401 when not signed in", async () => {
    as(null);
    expect((await call(DTS)).status).toBe(401);
  });

  it("404 for a bad id or a group that isn't there", async () => {
    expect((await call("not-a-uuid")).status).toBe(404);
    expect((await call(MISSING)).status).toBe(404);
  });

  it("anyone signed in reads a ministry's OKRs, read-only", async () => {
    const res = await call(DTS);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.owner).toEqual({ id: DTS, name: "DTS", kind: "ministry" });
    expect(body.canEdit).toBe(false);
    expect(body.readOnly).toBe("read_access");
    expect(body.objectives[0].keyResults[0]).toMatchObject({
      label: "KR1",
      status: "moving_forward",
      hasMetric: true,
      progressPct: 50,
      caption: "90 / 180 people",
    });
    expect(body.totals).toEqual({ objectives: 1, keyResults: 1, complete: 0, stuck: 0 });
    expect(state.adminCalls).toBe(0);
  });

  it("filters objectives to this ministry, ministry scope", async () => {
    await call(DTS);
    const q = state.user.queries.find((x) => x.table === "okr_objectives")!;
    expect(filterValue(q, "eq", "staff_ministry_id")).toBe(DTS);
    expect(filterValue(q, "eq", "scope")).toBe("ministry");
  });

  it("a leader of this ministry can check in on the current cycle", async () => {
    as(LEADER);
    const body = await (await call(DTS)).json();
    expect(body.canEdit).toBe(true);
    expect(body.readOnly).toBeNull();
  });

  it("a leader of a different ministry cannot", async () => {
    as({ ...STAFF, led: ["some-other-ministry"] });
    expect((await (await call(DTS)).json()).canEdit).toBe(false);
  });

  it("leadership team reads but does not edit (migration 271)", async () => {
    as({ roles: [{ id: "r-lt", name: "leadership_team" }], direct: [] });
    expect((await (await call(DTS)).json()).canEdit).toBe(false);
  });

  it("closed cycles are read-only even for a leader", async () => {
    as(LEADER);
    const body = await (await call(DTS, "?cycle=2025")).json();
    expect(body.cycle.slug).toBe("2025");
    expect(body.canEdit).toBe(false);
    expect(body.readOnly).toBe("closed");
  });

  it("an OKR team: admin edits, a ministry leader does not", async () => {
    as(LEADER);
    const asLeader = await (await call(TEAM)).json();
    expect(asLeader.owner.kind).toBe("team");
    expect(asLeader.canEdit).toBe(false);

    as(ADMIN);
    expect((await (await call(TEAM)).json()).canEdit).toBe(true);
    const q = state.user.queries.find((x) => x.table === "okr_objectives")!;
    expect(filterValue(q, "eq", "okr_team_id")).toBe(TEAM);
  });

  it("400 on an oversized cycle slug", async () => {
    expect((await call(DTS, `?cycle=${"x".repeat(200)}`)).status).toBe(400);
  });
});
