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

const FINANCE_ADMIN: PermissionWorld = {
  roles: [{ id: "r-fa", name: "finance_admin" }],
  direct: [],
};
const MEMBER: PermissionWorld = {
  roles: [{ id: "r-m", name: "self_service" }],
  direct: [
    { module: "bookings", key: "bookings.view" },
    { module: "vehicles", key: "vehicles.view" },
  ],
};
const FINANCE_OFFICE: PermissionWorld = {
  roles: [{ id: "fo", name: "finance_office" }],
  direct: [],
  bundles: { fo: [{ module: "finance", key: "finance.donor_statements" }] },
};
const PROGRAM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("finance module access", () => {
  it("lets an active finance_admin with no extra permission open finance", async () => {
    const db = client(FINANCE_ADMIN).client;
    expect(await hasModuleAccess(db, "u1", "finance")).toBe(true);
    await expect(requireModuleAccess(db, "u1", "finance")).resolves.toBeUndefined();
  });

  it("still redirects a plain member", async () => {
    await expect(requireModuleAccess(client(MEMBER).client, "u1", "finance")).rejects.toThrow(
      "REDIRECT:/dashboard"
    );
  });

  it("does not give finance_admin any other module", async () => {
    const db = client(FINANCE_ADMIN).client;
    for (const moduleId of [
      "events",
      "bookings",
      "schools",
      "communications",
      "records-library",
      "staff-decisions",
      "brand-kit",
    ]) {
      expect(await hasModuleAccess(db, "u1", moduleId)).toBe(false);
      await expect(requireModuleAccess(db, "u1", moduleId)).rejects.toThrow("REDIRECT:/dashboard");
    }
    await expect(
      requireAnyModuleAccess(db, "u1", ["bookings", "vehicles"])
    ).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("denies an inactive finance_admin and treats null is_active as active", async () => {
    const inactive: PermissionWorld = { ...FINANCE_ADMIN, active: false };
    expect(await hasModuleAccess(client(inactive).client, "u1", "finance")).toBe(false);
    await expect(requireModuleAccess(client(inactive).client, "u1", "finance")).rejects.toThrow(
      "REDIRECT:/dashboard"
    );

    const nullActive: PermissionWorld = { ...FINANCE_ADMIN, active: null };
    expect(await hasModuleAccess(client(nullActive).client, "u1", "finance")).toBe(true);
  });

  it("fails closed when a lookup errors, even for a finance_admin", async () => {
    const permsDown = createFakeSupabase({
      resolve: (q) => {
        if (q.table === "users") return { data: { is_active: true } };
        if (q.table === "user_roles") {
          return {
            data: [
              { role_id: "r-fa", scope_type: null, scope_id: null, roles: { name: "finance_admin" } },
            ],
          };
        }
        return { data: null, error: { message: "boom" } };
      },
    });
    expect(await hasModuleAccess(permsDown.client, "u1", "finance")).toBe(false);
    await expect(requireModuleAccess(permsDown.client, "u1", "finance")).rejects.toThrow(
      "REDIRECT:/dashboard"
    );

    const bundleDown = createFakeSupabase({
      resolve: (q) =>
        q.table === "role_permissions"
          ? { data: null, error: { message: "bundle down" } }
          : permissionWorldResolver(FINANCE_ADMIN)(q) ?? { data: [] },
    });
    expect(await hasModuleAccess(bundleDown.client, "u1", "finance")).toBe(false);
  });

  it("keeps a finance_office donor-statements grant on finance only", async () => {
    const db = client(FINANCE_OFFICE).client;
    expect(await hasModuleAccess(db, "u1", "finance")).toBe(true);
    await expect(requireModuleAccess(db, "u1", "finance")).resolves.toBeUndefined();
    expect(await hasModuleAccess(db, "u1", "events")).toBe(false);
  });

  it("does not treat a program-scoped finance_admin as finance access", async () => {
    const world: PermissionWorld = {
      roles: [{ id: "r-fa", name: "finance_admin", scopeType: "program", scopeId: PROGRAM }],
      direct: [],
    };
    const db = client(world).client;
    expect(await hasModuleAccess(db, "u1", "finance")).toBe(false);
    expect(await hasModuleAccess(db, "u1", "finance", { programId: PROGRAM })).toBe(false);
  });

  it("still admits the permission keys canManageFinance already accepts", async () => {
    for (const key of ["finance.manage", "finance.write"] as const) {
      const world: PermissionWorld = { roles: [], direct: [{ module: "finance", key }] };
      expect(await hasModuleAccess(client(world).client, "u1", "finance")).toBe(true);
    }
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
