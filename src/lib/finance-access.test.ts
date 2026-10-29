import { describe, it, expect } from "vitest";
import { getFinanceHubAccess } from "@/lib/finance-access";
import { canManageFinance } from "@/lib/api-auth";
import {
  createFakeSupabase,
  measure,
  permissionWorldResolver,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

// has_permission('finance.view') is answered by the database; model it as
// "holds finance.view directly or through a bundle", like migration 089.
function client(world: PermissionWorld, latencyMs = 0) {
  return createFakeSupabase({
    user: { id: "u1" },
    latencyMs,
    resolve: (q) => {
      if (q.rpc?.name === "has_permission") {
        const key = (q.rpc.args as { required_permission: string }).required_permission;
        const viaBundle = world.roles.some((r) => world.bundles?.[r.id]?.some((p) => p.key === key));
        return { data: world.direct.some((p) => p.key === key) || viaBundle };
      }
      return permissionWorldResolver(world)(q) ?? { data: [] };
    },
  });
}

describe("getFinanceHubAccess", () => {
  it.each<[string, PermissionWorld, { fullFinance: boolean; financeOffice: boolean }]>([
    ["nobody", { roles: [], direct: [] }, { fullFinance: false, financeOffice: false }],
    ["admin", { roles: [{ id: "r", name: "admin" }], direct: [] }, { fullFinance: true, financeOffice: false }],
    ["finance_admin", { roles: [{ id: "r", name: "finance_admin" }], direct: [] }, { fullFinance: true, financeOffice: false }],
    ["finance.view grant", { roles: [], direct: [{ module: "finance", key: "finance.view" }] }, { fullFinance: true, financeOffice: false }],
    ["finance.write grant", { roles: [], direct: [{ module: "finance", key: "finance.write" }] }, { fullFinance: true, financeOffice: false }],
    [
      "Finance Office (a finance-module grant that is neither view nor manage)",
      {
        roles: [{ id: "fo", name: "finance_office" }],
        direct: [],
        bundles: { fo: [{ module: "finance", key: "finance.donor_statements" }] },
      },
      { fullFinance: false, financeOffice: true },
    ],
  ])("%s", async (_label, world, expected) => {
    expect(await getFinanceHubAccess(client(world).client, "u1")).toEqual(expected);
  });

  it("runs its checks together", async () => {
    const f = client({ roles: [], direct: [] }, 20);
    const { roundTrips } = await measure(20, () => getFinanceHubAccess(f.client, "u1"));
    expect(roundTrips).toBeLessThanOrEqual(2);
  });
});

describe("canManageFinance", () => {
  it.each<[string, PermissionWorld, boolean]>([
    ["nobody", { roles: [], direct: [] }, false],
    ["super_admin", { roles: [{ id: "r", name: "super_admin" }], direct: [] }, true],
    ["finance_admin", { roles: [{ id: "r", name: "finance_admin" }], direct: [] }, true],
    ["finance.manage", { roles: [], direct: [{ module: "finance", key: "finance.manage" }] }, true],
    ["finance.view only", { roles: [], direct: [{ module: "finance", key: "finance.view" }] }, false],
  ])("%s", async (_label, world, expected) => {
    expect(await canManageFinance(client(world).client, "u1")).toBe(expected);
  });
});
