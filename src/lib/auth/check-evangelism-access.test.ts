import { describe, expect, it } from "vitest";
import { createFakeSupabase, permissionWorldResolver, type PermissionWorld } from "@/lib/testing/fake-supabase";
import { accessFromKeys, getEvangelismAccess } from "./check-evangelism-access";

async function access(world: PermissionWorld) {
  const fake = createFakeSupabase({
    user: { id: "u" },
    resolve: (q) => permissionWorldResolver(world)(q) ?? { data: [] },
  });
  return { result: await getEvangelismAccess(fake.client, "u"), queries: fake.queries };
}

const ALL = { view: true, submit: true, publish: true, moderate: false, unscopedAdmin: false };
const ADMIN = { view: true, submit: true, publish: true, moderate: true, unscopedAdmin: true };
const NONE = { view: false, submit: false, publish: false, moderate: false, unscopedAdmin: false };

describe("accessFromKeys", () => {
  it("expands publish ⇒ submit ⇒ view", () => {
    expect(accessFromKeys(["evangelism.publish"])).toEqual(ALL);
    expect(accessFromKeys(["evangelism.submit"])).toEqual({ view: true, submit: true, publish: false, moderate: false, unscopedAdmin: false });
    expect(accessFromKeys(["evangelism.view"])).toEqual({ view: true, submit: false, publish: false, moderate: false, unscopedAdmin: false });
    expect(accessFromKeys(["evangelism.moderate"])).toEqual({
      view: false,
      submit: false,
      publish: false,
      moderate: true,
      unscopedAdmin: false,
    });
    expect(accessFromKeys([])).toEqual(NONE);
  });

  it("ignores keys from other modules", () => {
    expect(accessFromKeys(["prayer_room.manage", "finance.view"])).toEqual(NONE);
  });
});

describe("getEvangelismAccess", () => {
  it("gives super_admin and admin everything without a key", async () => {
    expect((await access({ roles: [{ id: "a", name: "admin" }], direct: [] })).result).toEqual(ADMIN);
    expect((await access({ roles: [{ id: "s", name: "super_admin" }], direct: [] })).result).toEqual(ADMIN);
  });

  it("expands a direct grant down the hierarchy", async () => {
    expect(
      (await access({ roles: [{ id: "staff", name: "staff" }], direct: [{ module: "evangelism", key: "evangelism.submit" }] }))
        .result
    ).toEqual({ view: true, submit: true, publish: false, moderate: false, unscopedAdmin: false });
    expect((await access({ roles: [], direct: [{ module: "evangelism", key: "evangelism.publish" }] })).result).toEqual(ALL);
  });

  it("reads a role bundle", async () => {
    expect(
      (
        await access({
          roles: [{ id: "r1", name: "staff" }],
          direct: [],
          bundles: { r1: [{ module: "evangelism", key: "evangelism.view" }] },
        })
      ).result
    ).toEqual({ view: true, submit: false, publish: false, moderate: false, unscopedAdmin: false });
  });

  it("merges a direct key with a higher bundle key", async () => {
    expect(
      (
        await access({
          roles: [{ id: "r1", name: "staff" }],
          direct: [{ module: "evangelism", key: "evangelism.view" }],
          bundles: { r1: [{ module: "evangelism", key: "evangelism.publish" }] },
        })
      ).result
    ).toEqual(ALL);
  });

  it("denies a user with no role and no key, without a bundle lookup", async () => {
    const { result, queries } = await access({ roles: [], direct: [] });
    expect(result).toEqual(NONE);
    expect(queries.some((q) => q.table === "role_permissions")).toBe(false);
  });

  it("ignores a program-scoped admin role, like is_admin()", async () => {
    const fake = createFakeSupabase({
      user: { id: "u" },
      resolve: (q) =>
        q.table === "user_roles"
          ? { data: [{ role_id: "a", scope_type: "program", roles: { name: "admin" } }] }
          : { data: [] },
    });
    expect(await getEvangelismAccess(fake.client, "u")).toEqual(NONE);

    const unscoped = createFakeSupabase({
      user: { id: "u" },
      resolve: (q) =>
        q.table === "user_roles"
          ? { data: [{ role_id: "a", scope_type: null, roles: { name: "admin" } }] }
          : { data: [] },
    });
    expect(await getEvangelismAccess(unscoped.client, "u")).toEqual(ADMIN);
  });

  it("does not count another module's grant", async () => {
    expect(
      (await access({ roles: [{ id: "r", name: "staff" }], direct: [{ module: "finance", key: "finance.view" }] })).result
    ).toEqual(NONE);
  });
});
