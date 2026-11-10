import { describe, expect, it } from "vitest";
import {
  createFakeSupabase,
  permissionWorldResolver,
  type FakeQuery,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";
import { canManageApplicationTemplates } from "./application-template-access";

type Active = boolean | null;

function withAccount(
  isActive: Active,
  resolve: (q: FakeQuery) => { data?: unknown; error?: unknown }
) {
  return (q: FakeQuery) => {
    if (q.table === "users") return { data: { is_active: isActive } };
    return resolve(q);
  };
}

async function allowed(world: PermissionWorld, isActive: Active = true) {
  const fake = createFakeSupabase({
    resolve: withAccount(isActive, (q) => permissionWorldResolver(world)(q) ?? { data: [] }),
  });
  return canManageApplicationTemplates(fake.client, "u");
}

describe("canManageApplicationTemplates", () => {
  it("allows an unscoped admin or super_admin, matching is_admin()", async () => {
    expect(await allowed({ roles: [{ id: "a", name: "admin" }], direct: [] })).toBe(true);
    expect(await allowed({ roles: [{ id: "s", name: "super_admin" }], direct: [] })).toBe(true);
  });

  it("treats a NULL is_active as active", async () => {
    expect(await allowed({ roles: [{ id: "a", name: "admin" }], direct: [] }, null)).toBe(true);
  });

  it("refuses a deactivated admin", async () => {
    expect(await allowed({ roles: [{ id: "a", name: "admin" }], direct: [] }, false)).toBe(false);
  });

  it("ignores a program-scoped admin role", async () => {
    const fake = createFakeSupabase({
      resolve: withAccount(true, (q) =>
        q.table === "user_roles"
          ? { data: [{ role_id: "a", scope_type: "program", roles: { name: "admin" } }] }
          : { data: [] }
      ),
    });
    expect(await canManageApplicationTemplates(fake.client, "u")).toBe(false);
  });

  it("allows a direct unscoped schools.manage grant", async () => {
    expect(
      await allowed({
        roles: [],
        direct: [{ module: "schools", key: "schools.manage" }],
      })
    ).toBe(true);
  });

  it("refuses a deactivated holder of unscoped schools.manage", async () => {
    expect(
      await allowed(
        { roles: [], direct: [{ module: "schools", key: "schools.manage" }] },
        false
      )
    ).toBe(false);
  });

  it("refuses a schools.manage grant that is only scoped to a program", async () => {
    const fake = createFakeSupabase({
      resolve: withAccount(true, (q) => {
        if (q.table === "user_roles") return { data: [] };
        if (q.table === "user_permissions") {
          const row = {
            scope_type: "program",
            scope_id: "program-a",
            permissions: { key: "schools.manage" },
          };
          const demandsUnscoped = q.filters.some(
            (f) => f.op === "is" && f.args[0] === "scope_type" && f.args[1] === null
          );
          return { data: demandsUnscoped ? [] : [row] };
        }
        return { data: [] };
      }),
    });
    expect(await canManageApplicationTemplates(fake.client, "u")).toBe(false);
  });

  it("allows a direct unscoped schools.templates.manage grant", async () => {
    expect(
      await allowed({
        roles: [],
        direct: [{ module: "schools", key: "schools.templates.manage" }],
      })
    ).toBe(true);
  });

  it("allows schools.templates.manage carried by an unscoped role bundle", async () => {
    expect(
      await allowed({
        roles: [{ id: "r1", name: "staff" }],
        direct: [],
        bundles: { r1: [{ module: "schools", key: "schools.templates.manage" }] },
      })
    ).toBe(true);
  });

  it("refuses a schools.templates.manage grant that is only scoped to a program", async () => {
    const fake = createFakeSupabase({
      resolve: withAccount(true, (q) => {
        if (q.table === "user_roles") return { data: [] };
        if (q.table === "user_permissions") {
          const row = {
            scope_type: "program",
            scope_id: "program-a",
            permissions: { key: "schools.templates.manage" },
          };
          const demandsUnscoped = q.filters.some(
            (f) => f.op === "is" && f.args[0] === "scope_type" && f.args[1] === null
          );
          return { data: demandsUnscoped ? [] : [row] };
        }
        return { data: [] };
      }),
    });
    expect(await canManageApplicationTemplates(fake.client, "u")).toBe(false);
  });

  it("refuses a deactivated holder of unscoped schools.templates.manage", async () => {
    expect(
      await allowed(
        { roles: [], direct: [{ module: "schools", key: "schools.templates.manage" }] },
        false
      )
    ).toBe(false);
  });

  it("does not treat other schools keys as template management", async () => {
    expect(
      await allowed({
        roles: [{ id: "r", name: "staff" }],
        direct: [
          { module: "schools", key: "schools.approve_applications" },
          { module: "schools", key: "schools.manage_enrollments" },
          { module: "schools", key: "schools.view_applications" },
        ],
      })
    ).toBe(false);
  });

  it("does not treat the program_leader role name as admin", async () => {
    const fake = createFakeSupabase({
      resolve: withAccount(true, (q) => {
        if (q.table === "user_roles") {
          return { data: [{ role_id: "pl", scope_type: null, roles: { name: "program_leader" } }] };
        }
        return { data: [] };
      }),
    });
    expect(await canManageApplicationTemplates(fake.client, "u")).toBe(false);
  });

  it("allows schools.manage carried by an unscoped role bundle", async () => {
    expect(
      await allowed({
        roles: [{ id: "pl", name: "program_leader" }],
        direct: [],
        bundles: { pl: [{ module: "schools", key: "schools.manage" }] },
      })
    ).toBe(true);
  });

  it("ignores schools.manage on a program-scoped role", async () => {
    const fake = createFakeSupabase({
      resolve: withAccount(true, (q) => {
        if (q.table === "user_roles") {
          return {
            data: [{ role_id: "pl", scope_type: "program", scope_id: "program-a", roles: { name: "program_leader" } }],
          };
        }
        if (q.table === "role_permissions") {
          return { data: [{ permissions: { key: "schools.manage" } }] };
        }
        return { data: [] };
      }),
    });
    expect(await canManageApplicationTemplates(fake.client, "u")).toBe(false);
  });

  it("reads a permissions join that comes back as an array", async () => {
    const fake = createFakeSupabase({
      resolve: withAccount(true, (q) => {
        if (q.table === "user_roles") return { data: [{ role_id: "a", scope_type: null, roles: [{ name: "admin" }] }] };
        return { data: [] };
      }),
    });
    expect(await canManageApplicationTemplates(fake.client, "u")).toBe(true);
  });
});
