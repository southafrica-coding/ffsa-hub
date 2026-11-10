import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
import { hasAnyPermission, hasAnyRole } from "@/lib/api-auth";
import { hasModuleAccess, requireModuleAccess } from "@/lib/require-permission";
import { canOpenSchools } from "@/lib/schools/program-staff-access";
import {
  createFakeSupabase,
  permissionWorldResolver,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function client(world: PermissionWorld) {
  return createFakeSupabase({
    resolve: (q) => permissionWorldResolver(world)(q) ?? { data: [] },
  }).client;
}

const UNSCOPED_ADMIN: PermissionWorld = {
  roles: [{ id: "admin", name: "admin" }],
  direct: [],
};
const UNSCOPED_SCHOOLS: PermissionWorld = {
  roles: [],
  direct: [{ module: "schools", key: "schools.manage" }],
};
const SCOPED_SCHOOLS: PermissionWorld = {
  roles: [],
  direct: [{ module: "schools", key: "schools.manage", scopeType: "program", scopeId: A }],
};
const SCOPED_ROLE: PermissionWorld = {
  roles: [{ id: "pl", name: "program_leader", scopeType: "program", scopeId: A }],
  direct: [],
  bundles: { pl: [{ module: "schools", key: "schools.manage" }] },
};

describe("permission helpers match migrations 313 and 316", () => {
  it("denies a deactivated user even when they hold unscoped admin and finance grants", async () => {
    const world: PermissionWorld = {
      active: false,
      roles: [{ id: "sa", name: "super_admin" }],
      direct: [{ module: "finance", key: "finance.view" }],
    };
    const db = client(world);
    expect(await hasAnyRole(db, "u", ["super_admin"])).toBe(false);
    expect(await hasAnyPermission(db, "u", ["finance.view"])).toBe(false);
    expect(await hasModuleAccess(db, "u", "finance")).toBe(false);
  });

  it("treats is_active NULL as active", async () => {
    const fake = createFakeSupabase({
      resolve: (q) => {
        if (q.table === "users") return { data: { is_active: null } };
        if (q.table === "user_roles") {
          return { data: [{ role_id: "a", scope_type: null, scope_id: null, roles: { name: "admin" } }] };
        }
        return { data: [] };
      },
    });
    expect(await hasAnyRole(fake.client, "u", ["admin"])).toBe(true);
  });

  it("denies a scoped grant when the caller passes no scope", async () => {
    const db = client(SCOPED_SCHOOLS);
    expect(await hasAnyPermission(db, "u", ["schools.manage"])).toBe(false);
    expect(await hasModuleAccess(db, "u", "schools")).toBe(false);
    expect(await hasAnyRole(client(SCOPED_ROLE), "u", ["program_leader"])).toBe(false);
  });

  it("allows a scoped grant when the program scope matches", async () => {
    const db = client(SCOPED_SCHOOLS);
    expect(await hasAnyPermission(db, "u", ["schools.manage"], { programId: A })).toBe(true);
    expect(await hasModuleAccess(db, "u", "schools", { programId: A })).toBe(true);
    expect(await hasAnyRole(client(SCOPED_ROLE), "u", ["program_leader"], { programId: A })).toBe(true);
    expect(await hasModuleAccess(client(SCOPED_ROLE), "u", "schools", { programId: A })).toBe(true);
  });

  it("denies a scoped grant for a different program", async () => {
    const db = client(SCOPED_SCHOOLS);
    expect(await hasAnyPermission(db, "u", ["schools.manage"], { programId: B })).toBe(false);
    expect(await hasModuleAccess(db, "u", "schools", { programId: B })).toBe(false);
    expect(await hasAnyRole(client(SCOPED_ROLE), "u", ["program_leader"], { programId: B })).toBe(false);
  });

  it("never treats a team or event scope as a program scope", async () => {
    for (const scopeType of ["team", "event"] as const) {
      const direct: PermissionWorld = {
        roles: [],
        direct: [{ module: "schools", key: "schools.manage", scopeType, scopeId: A }],
      };
      const role: PermissionWorld = {
        roles: [{ id: "pl", name: "program_leader", scopeType, scopeId: A }],
        direct: [],
        bundles: { pl: [{ module: "schools", key: "schools.manage" }] },
      };
      expect(await hasAnyPermission(client(direct), "u", ["schools.manage"], { programId: A })).toBe(false);
      expect(await hasModuleAccess(client(role), "u", "schools", { programId: A })).toBe(false);
      expect(await hasAnyRole(client(role), "u", ["program_leader"], { programId: A })).toBe(false);
    }
  });

  it("denies a scoped finance.* grant even when the program matches", async () => {
    const world: PermissionWorld = {
      roles: [{ id: "fin", name: "finance_admin", scopeType: "program", scopeId: A }],
      direct: [{ module: "finance", key: "finance.edit", scopeType: "program", scopeId: A }],
      bundles: { fin: [{ module: "finance", key: "finance.view" }] },
    };
    const db = client(world);
    expect(await hasAnyPermission(db, "u", ["finance.edit"], { programId: A })).toBe(false);
    expect(
      await hasAnyPermission(db, "u", ["finance.view"], { programId: A, viaRoleBundle: true })
    ).toBe(false);
    expect(await hasModuleAccess(db, "u", "finance", { programId: A })).toBe(false);
  });

  it("allows an unscoped finance.* grant with or without a program scope", async () => {
    const world: PermissionWorld = {
      roles: [],
      direct: [{ module: "finance", key: "finance.edit" }],
    };
    const db = client(world);
    expect(await hasAnyPermission(db, "u", ["finance.edit"])).toBe(true);
    expect(await hasAnyPermission(db, "u", ["finance.edit"], { programId: A })).toBe(true);
    expect(await hasModuleAccess(db, "u", "finance")).toBe(true);
    expect(await hasModuleAccess(db, "u", "finance", { programId: A })).toBe(true);
  });

  it("allows an unscoped grant on a global check and on every program", async () => {
    const db = client(UNSCOPED_SCHOOLS);
    expect(await hasAnyPermission(db, "u", ["schools.manage"])).toBe(true);
    expect(await hasAnyPermission(db, "u", ["schools.manage"], { programId: A })).toBe(true);
    expect(await hasAnyPermission(db, "u", ["schools.manage"], { programId: B })).toBe(true);
    expect(await hasModuleAccess(db, "u", "schools")).toBe(true);
    expect(await hasAnyRole(client(UNSCOPED_ADMIN), "u", ["admin"])).toBe(true);
    expect(await hasAnyRole(client(UNSCOPED_ADMIN), "u", ["admin"], { programId: A })).toBe(true);
  });

  it("returns false when any lookup errors", async () => {
    const boom = createFakeSupabase({
      resolve: (q) =>
        q.table === "users"
          ? { data: { is_active: true } }
          : { data: null, error: { message: "boom" } },
    });
    expect(await hasAnyRole(boom.client, "u", ["admin"])).toBe(false);
    expect(await hasAnyPermission(boom.client, "u", ["schools.manage"])).toBe(false);
    expect(await hasModuleAccess(boom.client, "u", "schools")).toBe(false);

    const userDown = createFakeSupabase({
      resolve: () => ({ data: null, error: { message: "users down" } }),
    });
    expect(await hasModuleAccess(userDown.client, "u", "finance")).toBe(false);
  });

  it("counts schools.manage carried by an unscoped role bundle when asked", async () => {
    const world: PermissionWorld = {
      roles: [{ id: "pl", name: "program_leader" }],
      direct: [],
      bundles: { pl: [{ module: "schools", key: "schools.manage" }] },
    };
    const db = client(world);
    expect(await hasAnyPermission(db, "u", ["schools.manage"])).toBe(false);
    expect(await hasAnyPermission(db, "u", ["schools.manage"], { viaRoleBundle: true })).toBe(true);
    expect(await hasModuleAccess(db, "u", "schools")).toBe(true);
  });
});

describe("active unscoped callers keep what they already see", () => {
  it("requireModuleAccess still admits an active unscoped finance grant", async () => {
    const world: PermissionWorld = {
      roles: [{ id: "s", name: "staff" }],
      direct: [{ module: "finance", key: "finance.view" }],
    };
    await expect(requireModuleAccess(client(world), "u", "finance")).resolves.toBeUndefined();
  });

  it("canOpenSchools still opens Training for an active unscoped schools grant", async () => {
    const access = await canOpenSchools(client(UNSCOPED_SCHOOLS), "u");
    expect(access).toEqual({
      open: true,
      hasModuleAccess: true,
      staffProgramIds: [],
      grantProgramIds: [],
      schools: "all",
    });
  });

  it("opens Training home for a program-scoped leader without full module access", async () => {
    const db = client(SCOPED_SCHOOLS);
    const home = await canOpenSchools(db, "u");
    expect(home).toEqual({
      open: true,
      hasModuleAccess: false,
      staffProgramIds: [],
      grantProgramIds: [A],
      schools: [A],
    });
    expect(await canOpenSchools(db, "u", { programId: A })).toMatchObject({ open: true });
    expect(await canOpenSchools(db, "u", { programId: B })).toMatchObject({ open: false });
  });
});
