import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  hasModuleAccess,
  requireModuleAccess,
  requireAnyModuleAccess,
} from "@/lib/require-permission";
import {
  createFakeSupabase,
  measure,
  permissionWorldResolver,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

const NOBODY: PermissionWorld = { roles: [], direct: [] };
const SUPER: PermissionWorld = { roles: [{ id: "r-sa", name: "super_admin" }], direct: [] };
const ADMIN: PermissionWorld = { roles: [{ id: "r-a", name: "admin" }], direct: [] };
const DIRECT: PermissionWorld = {
  roles: [{ id: "r-s", name: "staff" }],
  direct: [{ module: "finance", key: "finance.view" }],
};
const BUNDLE: PermissionWorld = {
  roles: [{ id: "r-s", name: "staff" }],
  direct: [],
  bundles: { "r-s": [{ module: "finance", key: "finance.view" }] },
};

function client(world: PermissionWorld, latencyMs = 0) {
  return createFakeSupabase({
    user: { id: "u1" },
    resolve: (q) => permissionWorldResolver(world)(q) ?? { data: [] },
    latencyMs,
  });
}

describe("hasModuleAccess", () => {
  it.each([
    ["nobody", NOBODY, "finance", false],
    ["super_admin", SUPER, "finance", true],
    ["admin", ADMIN, "finance", true],
    ["direct grant", DIRECT, "finance", true],
    ["direct grant, other module", DIRECT, "events", false],
    ["role bundle", BUNDLE, "finance", true],
    ["role bundle, other module", BUNDLE, "events", false],
    // Records Library is carved out: admin alone is not enough…
    ["admin on records-library", ADMIN, "records-library", false],
    // …but super_admin is.
    ["super_admin on records-library", SUPER, "records-library", true],
  ])("%s", async (_label, world, module, expected) => {
    expect(await hasModuleAccess(client(world).client, "u1", module)).toBe(expected);
  });

  it("admin with an explicit records-library grant gets in", async () => {
    const world: PermissionWorld = {
      roles: [{ id: "r-a", name: "admin" }],
      direct: [{ module: "records-library", key: "records_library.manage" }],
    };
    expect(await hasModuleAccess(client(world).client, "u1", "records-library")).toBe(true);
  });

  it("a failed read never grants access", async () => {
    const f = createFakeSupabase({
      user: { id: "u1" },
      resolve: () => ({ data: null, error: { message: "boom" } }),
    });
    expect(await hasModuleAccess(f.client, "u1", "finance")).toBe(false);
  });

  it("takes at most two round trips", async () => {
    const f = client(BUNDLE, 20);
    const { result, roundTrips } = await measure(20, () =>
      hasModuleAccess(f.client, "u1", "finance")
    );
    expect(result).toBe(true);
    expect(roundTrips).toBeLessThanOrEqual(2);
  });
});

describe("requireModuleAccess", () => {
  it("passes silently when allowed", async () => {
    await expect(requireModuleAccess(client(DIRECT).client, "u1", "finance")).resolves.toBeUndefined();
  });

  it("redirects to the dashboard when not allowed", async () => {
    await expect(requireModuleAccess(client(NOBODY).client, "u1", "finance")).rejects.toThrow(
      "REDIRECT:/dashboard"
    );
  });

  it("keeps the records-library carve-out for admins", async () => {
    await expect(
      requireModuleAccess(client(ADMIN).client, "u1", "records-library")
    ).rejects.toThrow("REDIRECT:/dashboard");
  });
});

describe("requireAnyModuleAccess", () => {
  it("passes when any one module is reachable", async () => {
    const world: PermissionWorld = {
      roles: [{ id: "r-s", name: "staff" }],
      direct: [],
      bundles: { "r-s": [{ module: "vehicles", key: "vehicles.view" }] },
    };
    await expect(
      requireAnyModuleAccess(client(world).client, "u1", ["bookings", "vehicles"])
    ).resolves.toBeUndefined();
  });

  it("redirects when none are", async () => {
    await expect(
      requireAnyModuleAccess(client(DIRECT).client, "u1", ["bookings", "vehicles"])
    ).rejects.toThrow("REDIRECT:/dashboard");
  });
});
