import { describe, expect, it } from "vitest";
import { createFakeSupabase, permissionWorldResolver, type PermissionWorld } from "@/lib/testing/fake-supabase";
import { canManageApplicationTemplates } from "./application-template-access";

async function allowed(world: PermissionWorld) {
  const fake = createFakeSupabase({
    resolve: (q) => permissionWorldResolver(world)(q) ?? { data: [] },
  });
  return canManageApplicationTemplates(fake.client, "u");
}

describe("canManageApplicationTemplates", () => {
  it("allows an unscoped admin or super_admin, matching is_admin()", async () => {
    expect(await allowed({ roles: [{ id: "a", name: "admin" }], direct: [] })).toBe(true);
    expect(await allowed({ roles: [{ id: "s", name: "super_admin" }], direct: [] })).toBe(true);
  });

  it("ignores a program-scoped admin role", async () => {
    const fake = createFakeSupabase({
      resolve: (q) =>
        q.table === "user_roles"
          ? { data: [{ role_id: "a", scope_type: "program", roles: { name: "admin" } }] }
          : { data: [] },
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

  it("refuses a schools.manage grant that is only scoped to a program", async () => {
    const fake = createFakeSupabase({
      resolve: (q) => {
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
      },
    });
    expect(await canManageApplicationTemplates(fake.client, "u")).toBe(false);
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
      resolve: (q) => {
        if (q.table === "user_roles") {
          return { data: [{ role_id: "pl", scope_type: null, roles: { name: "program_leader" } }] };
        }
        return { data: [] };
      },
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
      resolve: (q) => {
        if (q.table === "user_roles") {
          return {
            data: [{ role_id: "pl", scope_type: "program", scope_id: "program-a", roles: { name: "program_leader" } }],
          };
        }
        if (q.table === "role_permissions") {
          return { data: [{ permissions: { key: "schools.manage" } }] };
        }
        return { data: [] };
      },
    });
    expect(await canManageApplicationTemplates(fake.client, "u")).toBe(false);
  });

  it("reads a permissions join that comes back as an array", async () => {
    const fake = createFakeSupabase({
      resolve: (q) => {
        if (q.table === "user_roles") return { data: [{ role_id: "a", scope_type: null, roles: [{ name: "admin" }] }] };
        return { data: [] };
      },
    });
    expect(await canManageApplicationTemplates(fake.client, "u")).toBe(true);
  });
});
