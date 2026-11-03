import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  filterValue,
  permissionWorldResolver,
  type FakeQuery,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

// GET /api/mobile/check-in-events: same gate as the staff door endpoint
// (canManageEvents with events.manage_attendance).

const state = vi.hoisted(() => ({
  user: null as unknown as { client: unknown },
  admin: null as unknown as { client: unknown; queries: FakeQuery[] },
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.user.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.admin.client }));

import { GET } from "./route";

function as(world: PermissionWorld | null, adminError?: string) {
  state.user = createFakeSupabase({
    user: world ? { id: "u1" } : null,
    resolve: (q) => (world ? permissionWorldResolver(world)(q) : null) ?? { data: [] },
  });
  state.admin = createFakeSupabase({
    user: null,
    resolve: (q) =>
      adminError
        ? { error: { message: adminError } }
        : q.table === "events"
          ? {
              data: [
                {
                  id: "e1",
                  title: "Send Night",
                  start_date: "2026-11-03",
                  start_time: "18:00:00",
                  end_date: null,
                  end_time: null,
                  location: "Cape Town",
                },
              ],
            }
          : { data: [] },
  });
}

const DOOR: PermissionWorld = {
  roles: [{ id: "r-staff", name: "staff" }],
  direct: [{ module: "events", key: "events.manage_attendance" }],
};

describe("GET /api/mobile/check-in-events", () => {
  beforeEach(() => as(DOOR));

  it("401 when not signed in", async () => {
    as(null);
    expect((await GET()).status).toBe(401);
  });

  it("403 without a managing role or events.manage_attendance", async () => {
    as({ roles: [{ id: "r-staff", name: "staff" }], direct: [{ module: "events", key: "events.view" }] });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(state.admin.queries).toHaveLength(0);
  });

  it("allows events_admin by role", async () => {
    as({ roles: [{ id: "r-ev", name: "events_admin" }], direct: [] });
    expect((await GET()).status).toBe(200);
  });

  it("lists ticketed, published, not-yet-finished events, camelCased, no-store", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      events: [
        {
          id: "e1",
          title: "Send Night",
          startDate: "2026-11-03",
          startTime: "18:00:00",
          endDate: null,
          endTime: null,
          location: "Cape Town",
        },
      ],
    });
    const q = state.admin.queries.find((x) => x.table === "events")!;
    expect(filterValue(q, "eq", "ticketing_enabled")).toBe(true);
    expect(filterValue(q, "eq", "status")).toBe("published");
    expect(q.columns).not.toContain("*");
  });

  it("500 JSON on a read error", async () => {
    as(DOOR, "boom");
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "server_error" });
  });
});
