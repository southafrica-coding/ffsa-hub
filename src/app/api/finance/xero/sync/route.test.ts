import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  permissionWorldResolver,
  type FakeQuery,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("@/lib/testing/fake-supabase").createFakeSupabase>,
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.fake.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock("@/lib/finance/xero-mirror-sync", async (orig) => ({
  ...(await orig<typeof import("@/lib/finance/xero-mirror-sync")>()),
  syncXeroMirror: async (db: unknown, opts: Record<string, unknown>) => {
    state.calls.push({ db, ...opts });
    return [
      { region: "za", status: "succeeded", counts: { accounts: { inserted: 9 } } },
      { region: "us", status: "skipped", error: "This organisation is not connected to Xero." },
    ];
  },
}));

import { POST } from "./route";

function world(access: PermissionWorld, perms: string[] = [], user: { id: string } | null = { id: "me" }) {
  state.fake = createFakeSupabase({
    user,
    resolve: (q: FakeQuery) => {
      if (q.rpc?.name === "has_permission") {
        return { data: perms.includes((q.rpc.args as { required_permission: string }).required_permission) };
      }
      return permissionWorldResolver(access)(q) ?? { data: [] };
    },
  });
}

const call = (body?: unknown) =>
  POST(new Request("http://x/api/finance/xero/sync", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }));

const NO_ROLES: PermissionWorld = { roles: [], direct: [] };
const EVENTS_ADMIN: PermissionWorld = { roles: [{ id: "r", name: "events_admin" }], direct: [] };
const FINANCE_ADMIN: PermissionWorld = { roles: [{ id: "r", name: "finance_admin" }], direct: [] };

describe("POST /api/finance/xero/sync", () => {
  beforeEach(() => {
    state.calls = [];
    world(NO_ROLES, ["finance.view"]);
  });

  it("401 when not signed in", async () => {
    world(NO_ROLES, [], null);
    expect((await call()).status).toBe(401);
    expect(state.calls).toEqual([]);
  });

  it("403 for someone without finance access, e.g. an events admin", async () => {
    world(EVENTS_ADMIN);
    const res = await call();
    expect(res.status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it("finance.view may ask for the automatic refresh: only stale regions, as the service role", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(state.calls).toEqual([
      { db: { admin: true }, regions: ["za", "us"], trigger: "view", startedBy: "me", maxAgeMs: 5 * 60 * 1000 },
    ]);
    // Outcomes only: no counts or Xero data in the response.
    expect(await res.json()).toEqual({
      results: [
        { region: "za", status: "succeeded", error: null },
        { region: "us", status: "skipped", error: "This organisation is not connected to Xero." },
      ],
    });
  });

  it("finance.view may not force a sync right now", async () => {
    expect((await call({ mode: "now" })).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it.each([
    ["finance_admin", FINANCE_ADMIN, []],
    ["admin", { roles: [{ id: "r", name: "admin" }], direct: [] }, []],
    ["finance.edit", NO_ROLES, ["finance.edit"]],
  ] as const)("%s may sync now, without the 5-minute wait", async (_l, access, perms) => {
    world(access as PermissionWorld, [...perms]);
    expect((await call({ mode: "now", region: "us" })).status).toBe(200);
    expect(state.calls[0]).toMatchObject({ regions: ["us"], trigger: "manual", maxAgeMs: undefined });
  });

  it("400 on a bad mode, region or body", async () => {
    world(FINANCE_ADMIN);
    expect((await call({ mode: "push" })).status).toBe(400);
    expect((await call({ region: "uk" })).status).toBe(400);
    expect((await POST(new Request("http://x", { method: "POST", body: "{nope" }))).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
});
