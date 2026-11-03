import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  filterValue,
  permissionWorldResolver,
  type FakeQuery,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

// GET /api/notifications runs the real feed service against a fake client:
// the same items the dashboard derives, reshaped for the phone app.

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("@/lib/testing/fake-supabase").createFakeSupabase>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.fake.client,
}));
// Cross-user providers read through the service-role client; point it at an
// empty fake so they contribute nothing here.
vi.mock("@/lib/supabase/admin", async () => {
  const { createFakeSupabase } = await import("@/lib/testing/fake-supabase");
  return { createAdminClient: () => createFakeSupabase({}).client };
});

import { GET } from "./route";

const now = Date.now();
const PENDING = [
  { id: "a", first_name: "Ann", last_name: "A", email: "a@x", created_at: new Date(now - 60_000).toISOString() },
  { id: "b", first_name: "Ben", last_name: "B", email: "b@x", created_at: new Date(now - 120_000).toISOString() },
];

const ADMIN: PermissionWorld = { roles: [{ id: "r", name: "super_admin" }], direct: [] };
const NOBODY: PermissionWorld = { roles: [], direct: [] };

function world(opts: { user?: { id: string } | null; perms?: PermissionWorld; readKeys?: string[] }) {
  state.fake = createFakeSupabase({
    user: opts.user === undefined ? { id: "me" } : opts.user,
    resolve: (q: FakeQuery) => {
      const perm = permissionWorldResolver(opts.perms ?? ADMIN)(q);
      if (perm) return perm;
      if (q.table === "users" && filterValue(q, "eq", "status") === "pending_approval") return { data: PENDING };
      if (q.table === "notification_reads") {
        return { data: (opts.readKeys ?? []).map((k) => ({ notification_key: k })) };
      }
      return { data: [] };
    },
  });
}

describe("GET /api/notifications", () => {
  beforeEach(() => world({}));

  it("401 JSON when not signed in", async () => {
    world({ user: null });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("returns the feed items with stable keys, read state and unread count", async () => {
    world({ readKeys: ["user:a"] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();

    const staff = body.items.filter((i: { key: string }) => i.key.startsWith("user:"));
    // Unread first, newest first — the dashboard's order.
    expect(staff.map((i: { key: string; read: boolean }) => [i.key, i.read])).toEqual([
      ["user:b", false],
      ["user:a", true],
    ]);
    expect(staff[0]).toEqual({
      key: "user:b",
      kind: "user",
      title: "Staff awaiting approval",
      body: "Ben B · b@x",
      href: "/users?filter=pending",
      read: false,
      createdAt: PENDING[1].created_at,
    });
    expect(body.unreadCount).toBe(body.items.filter((i: { read: boolean }) => !i.read).length);
    expect(body.unreadCount).toBeGreaterThan(0);
    // No server-formatted relative times leak into the contract.
    expect(Object.keys(staff[0]).sort()).toEqual(
      ["body", "createdAt", "href", "key", "kind", "read", "title"]
    );
  });

  it("is permission-gated exactly like the dashboard (no admin role → no staff approvals)", async () => {
    world({ perms: NOBODY });
    const res = await GET();
    expect(await res.json()).toEqual({ items: [], unreadCount: 0 });
  });

  it("reads the caller's own read state only", async () => {
    await GET();
    const reads = state.fake.queries.find((q) => q.table === "notification_reads");
    expect(reads && filterValue(reads, "eq", "user_id")).toBe("me");
  });
});
