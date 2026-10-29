import { describe, it, expect, vi } from "vitest";
import {
  createFakeSupabase,
  filterValue,
  permissionWorldResolver,
  type FakeQuery,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

// Cross-user providers read through the service-role client; point it at an
// empty fake so they contribute nothing here.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeSupabase({}).client,
}));

import { getNotifications } from "@/services/notifications";

const now = Date.now();
const PENDING = [
  { id: "a", first_name: "Ann", last_name: "A", email: "a@x", created_at: new Date(now - 60_000).toISOString() },
  { id: "b", first_name: "Ben", last_name: "B", email: "b@x", created_at: new Date(now - 120_000).toISOString() },
];

function client(world: PermissionWorld, readKeys: string[]) {
  return createFakeSupabase({
    user: { id: "me" },
    resolve: (q: FakeQuery) => {
      const perm = permissionWorldResolver(world)(q);
      if (perm) return perm;
      if (q.table === "users" && filterValue(q, "eq", "status") === "pending_approval") return { data: PENDING };
      if (q.table === "notification_reads") return { data: readKeys.map((k) => ({ notification_key: k })) };
      return { data: [] };
    },
  });
}

describe("getNotifications", () => {
  it("marks read items and sorts unread first, newest first", async () => {
    const f = client({ roles: [{ id: "r", name: "super_admin" }], direct: [] }, ["user:a"]);
    const { notifications, unreadCount } = await getNotifications(f.client, "me");
    const staff = notifications.filter((n) => n.kind === "user" && n.title === "Staff awaiting approval");
    expect(staff.map((n) => [n.key, n.read])).toEqual([
      ["user:b", false],
      ["user:a", true],
    ]);
    expect(unreadCount).toBe(notifications.filter((n) => !n.read).length);
  });

  it("staff approvals stay admin-only", async () => {
    const f = client({ roles: [{ id: "r", name: "staff" }], direct: [] }, []);
    const { notifications } = await getNotifications(f.client, "me");
    expect(notifications.some((n) => n.key.startsWith("user:"))).toBe(false);
  });

  it("nothing to show → empty, whatever the read state", async () => {
    const f = client({ roles: [], direct: [] }, ["user:a"]);
    expect(await getNotifications(f.client, "me")).toEqual({ notifications: [], unreadCount: 0 });
  });
});
