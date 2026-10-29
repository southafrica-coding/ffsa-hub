import { describe, it, expect } from "vitest";
import { getSidebarAccess } from "@/lib/sidebar-access";
import {
  createFakeSupabase,
  measure,
  permissionWorldResolver,
  type FakeQuery,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

function client(world: PermissionWorld, opts: { latencyMs?: number; fail?: (q: FakeQuery) => boolean } = {}) {
  return createFakeSupabase({
    user: { id: "u1" },
    latencyMs: opts.latencyMs,
    resolve: (q) =>
      opts.fail?.(q)
        ? { data: null, error: { message: "boom" } }
        : permissionWorldResolver(world)(q) ?? { data: [] },
  });
}

const sorted = (s: Set<string>) => [...s].sort();

describe("getSidebarAccess", () => {
  it("returns an empty menu for a signed-out visitor", async () => {
    const f = createFakeSupabase({ user: null });
    const access = await getSidebarAccess(f.client);
    expect(access).toEqual({ userRoles: [], permittedModules: new Set(), menuLoadFailed: false });
    expect(f.queries).toHaveLength(0);
  });

  it("super_admin: roles only, no permission lookups", async () => {
    const f = client({ roles: [{ id: "r1", name: "super_admin" }], direct: [] });
    const access = await getSidebarAccess(f.client);
    expect(access.userRoles).toEqual(["super_admin"]);
    expect(access.permittedModules.size).toBe(0);
    expect(f.queries.map((q) => q.table)).toEqual(["user_roles"]);
  });

  it("unions direct grants and role-bundle grants, with the bookings/users aliases", async () => {
    const f = client({
      roles: [
        { id: "r1", name: "staff" },
        { id: "r2", name: "events_admin" },
      ],
      direct: [
        { module: "events", key: "events.view" },
        { module: "schools", key: "schools.manage" },
      ],
      bundles: {
        r1: [{ module: "vehicles", key: "vehicles.view" }],
        r2: [{ module: "equipment", key: "equipment.view" }, { module: "contacts", key: "contacts.read" }],
      },
    });
    const access = await getSidebarAccess(f.client);
    expect(access.userRoles).toEqual(["staff", "events_admin"]);
    expect(sorted(access.permittedModules)).toEqual(
      ["bookings", "contacts", "equipment", "events", "schools", "users", "vehicles"].sort()
    );
    expect(access.menuLoadFailed).toBe(false);
  });

  it("a role bundle's schools.manage also lights up Users", async () => {
    const f = client({
      roles: [{ id: "r1", name: "program_leader" }],
      direct: [],
      bundles: { r1: [{ module: "schools", key: "schools.manage" }] },
    });
    expect(sorted((await getSidebarAccess(f.client)).permittedModules)).toEqual(["schools", "users"]);
  });

  it("flags menuLoadFailed (after a retry) when the roles read fails", async () => {
    const f = client({ roles: [], direct: [] }, { fail: (q) => q.table === "user_roles" });
    const access = await getSidebarAccess(f.client);
    expect(access.menuLoadFailed).toBe(true);
    expect(f.queries.filter((q) => q.table === "user_roles")).toHaveLength(2);
  });

  it("flags menuLoadFailed when the direct-permissions read fails", async () => {
    const f = client(
      { roles: [{ id: "r1", name: "staff" }], direct: [] },
      { fail: (q) => q.table === "user_permissions" }
    );
    expect((await getSidebarAccess(f.client)).menuLoadFailed).toBe(true);
  });

  it("a failed role-bundle read is best-effort: direct grants still show", async () => {
    const f = client(
      { roles: [{ id: "r1", name: "staff" }], direct: [{ module: "events", key: "events.view" }] },
      { fail: (q) => q.table === "role_permissions" }
    );
    const access = await getSidebarAccess(f.client);
    expect(access.menuLoadFailed).toBe(false);
    expect(sorted(access.permittedModules)).toEqual(["events"]);
  });

  it("takes three round trips: auth, roles, then both grant reads together", async () => {
    const f = client(
      { roles: [{ id: "r1", name: "staff" }], direct: [], bundles: { r1: [{ module: "events", key: "events.view" }] } },
      { latencyMs: 20 }
    );
    const { roundTrips } = await measure(20, () => getSidebarAccess(f.client));
    expect(roundTrips).toBeLessThanOrEqual(3);
  });
});
