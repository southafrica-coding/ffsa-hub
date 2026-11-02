import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  permissionWorldResolver,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";
import { getFinanceHubAccess } from "@/lib/finance-access";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import {
  canSeeSchoolFeesFinanceLinks,
  requireSchoolFeesAccess,
  schoolFeesFinanceLinks,
} from "@/lib/finance/school-fees-links";

// The School Fees pages and the Schools → Fees panel's three "into Finance"
// links use the Finance hub's full-finance check (Jack, 2026-11-01):
// finance.view, or a finance-manage role/grant. Finance Office's
// donor-statements grant is not enough.

const SCHOOLS_STAFF: PermissionWorld = {
  roles: [{ id: "r-staff", name: "staff" }],
  direct: [],
  bundles: { "r-staff": [{ module: "schools", key: "schools.view" }] },
};
const FINANCE_VIEW_ONLY: PermissionWorld = {
  roles: [{ id: "r-staff", name: "staff" }],
  direct: [{ module: "finance", key: "finance.view" }],
};
const FINANCE_ADMIN_ROLE: PermissionWorld = {
  roles: [{ id: "r-fa", name: "finance_admin" }],
  direct: [],
};
const FINANCE_BUNDLE: PermissionWorld = {
  // A custom role bundling finance.manage.
  roles: [{ id: "r-fin", name: "finance_team" }],
  direct: [],
  bundles: { "r-fin": [{ module: "finance", key: "finance.manage" }] },
};
const FINANCE_OFFICE: PermissionWorld = {
  // The seeded finance_office role: finance.donor_statements only (migration 248).
  roles: [{ id: "r-fo", name: "finance_office" }],
  direct: [],
  bundles: { "r-fo": [{ module: "finance", key: "finance.donor_statements" }] },
};
const ADMIN: PermissionWorld = { roles: [{ id: "r-a", name: "admin" }], direct: [] };
const SUPER_ADMIN: PermissionWorld = { roles: [{ id: "r-s", name: "super_admin" }], direct: [] };

// has_permission is answered by the database; model migration 089: the key
// directly or through a role bundle.
const client = (world: PermissionWorld) =>
  createFakeSupabase({
    user: { id: "u1" },
    resolve: (q) => {
      if (q.rpc?.name === "has_permission") {
        const key = (q.rpc.args as { required_permission: string }).required_permission;
        const viaBundle = world.roles.some((r) => world.bundles?.[r.id]?.some((p) => p.key === key));
        return { data: world.direct.some((p) => p.key === key) || viaBundle };
      }
      return permissionWorldResolver(world)(q) ?? { data: [] };
    },
  }).client;

const WORLDS: Array<[string, PermissionWorld, boolean]> = [
  ["finance.view only", FINANCE_VIEW_ONLY, true],
  ["finance_admin role, no permissions", FINANCE_ADMIN_ROLE, true],
  ["finance.manage via a role bundle", FINANCE_BUNDLE, true],
  ["admin", ADMIN, true],
  ["super_admin", SUPER_ADMIN, true],
  ["Finance Office (finance.donor_statements only)", FINANCE_OFFICE, false],
  ["Schools staff without finance", SCHOOLS_STAFF, false],
];

describe("canSeeSchoolFeesFinanceLinks", () => {
  it.each(WORLDS)("%s → %s", async (_label: string, world: PermissionWorld, expected: boolean) => {
    expect(await canSeeSchoolFeesFinanceLinks(client(world), "u1")).toBe(expected);
  });

  it("signed out → hidden", async () => {
    expect(await canSeeSchoolFeesFinanceLinks(client(ADMIN), null)).toBe(false);
  });

  it.each(WORLDS)(
    "agrees with the page gate and the Finance hub: %s",
    async (_label: string, world: PermissionWorld, expected: boolean) => {
      const shown = await canSeeSchoolFeesFinanceLinks(client(world), "u1");
      const hub = await getFinanceHubAccess(client(world), "u1");
      expect(shown).toBe(hub.fullFinance);
      const gate = requireSchoolFeesAccess(client(world), "u1");
      if (expected) await expect(gate).resolves.toBeUndefined();
      else await expect(gate).rejects.toThrow("REDIRECT:/dashboard");
    }
  );
});

describe("schoolFeesFinanceLinks", () => {
  const ADMIN_APP = path.resolve(__dirname, "../../app/(admin)");

  it("every link lands on a page behind the full-finance gate", () => {
    const links = schoolFeesFinanceLinks("PROGRAM");
    expect(links.map((l) => l.label)).toEqual([
      "Student billing in Finance",
      "Invoice run",
      "All fee settings in Finance",
    ]);
    for (const l of links) {
      const file = path.join(ADMIN_APP, l.href.replace("PROGRAM", "[programId]"), "page.tsx");
      expect(readFileSync(file, "utf8")).toContain("requireSchoolFeesAccess(supabase, user.id)");
    }
  });

  it("the Fees panel renders them only behind canSeeSchoolFeesFinanceLinks", () => {
    const panel = readFileSync(
      path.resolve(__dirname, "../../components/finance/school-fees-panel.tsx"),
      "utf8"
    );
    expect(panel).toContain("canSeeSchoolFeesFinanceLinks(supabase, user?.id)");
    expect(panel).toMatch(/\{canOpenFinance && \(/);
    expect(panel).not.toMatch(/href=\{?["`]\/finance\//);
  });
});
