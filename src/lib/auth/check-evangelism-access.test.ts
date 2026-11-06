import { describe, expect, it } from "vitest";
import { createFakeSupabase, permissionWorldResolver, type PermissionWorld } from "@/lib/testing/fake-supabase";
import { getEvangelismAccess } from "./check-evangelism-access";

async function access(world: PermissionWorld) {
  const fake = createFakeSupabase({
    user: { id: "u" },
    resolve: (query) => permissionWorldResolver(world)(query) ?? { data: [] },
  });
  return getEvangelismAccess(fake.client, "u");
}

describe("getEvangelismAccess", () => {
  it("lets super admins and admins through before any evangelism key exists", async () => {
    expect(await access({ roles: [{ id: "a", name: "admin" }], direct: [] })).toEqual({
      view: true,
      submit: true,
      publish: true,
    });
    expect((await access({ roles: [{ id: "s", name: "super_admin" }], direct: [] })).publish).toBe(true);
  });

  it("treats submit as view, and publish as both", async () => {
    expect(
      await access({
        roles: [{ id: "staff", name: "staff" }],
        direct: [{ module: "evangelism", key: "evangelism.submit" }],
      })
    ).toEqual({ view: true, submit: true, publish: false });

    expect(
      await access({
        roles: [],
        direct: [{ module: "evangelism", key: "evangelism.publish" }],
      })
    ).toEqual({ view: true, submit: true, publish: true });
  });

  it("reads a role bundle when the user has no direct grant", async () => {
    expect(
      await access({
        roles: [{ id: "display", name: "staff" }],
        direct: [],
        bundles: { display: [{ module: "evangelism", key: "evangelism.view" }] },
      })
    ).toEqual({ view: true, submit: false, publish: false });
  });

  it("denies someone with no role and no grant", async () => {
    expect(await access({ roles: [], direct: [] })).toEqual({
      view: false,
      submit: false,
      publish: false,
    });
  });
});
