import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  permissionWorldResolver,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { requireModuleAccess } from "@/lib/require-permission";
import {
  canSeeSchoolFeesFinanceLinks,
  schoolFeesFinanceLinks,
} from "@/lib/finance/school-fees-links";

// The Schools → Fees panel's three "into Finance" links: shown to exactly the
// people the destination pages' finance gate lets in, hidden for everyone else.

const SCHOOLS_STAFF: PermissionWorld = {
  roles: [{ id: "r-staff", name: "staff" }],
  direct: [],
  bundles: { "r-staff": [{ module: "schools", key: "schools.view" }] },
};
const FINANCE_VIEW_ONLY: PermissionWorld = {
  roles: [{ id: "r-staff", name: "staff" }],
  direct: [{ module: "finance", key: "finance.view" }],
};
const FINANCE_BUNDLE: PermissionWorld = {
  // A custom role, not the seeded finance_office (which bundles only
  // finance.donor_statements, migration 248).
  roles: [{ id: "r-fin", name: "finance_team" }],
  direct: [],
  bundles: { "r-fin": [{ module: "finance", key: "finance.manage" }] },
};
const ADMIN: PermissionWorld = { roles: [{ id: "r-a", name: "admin" }], direct: [] };

const client = (world: PermissionWorld) =>
  createFakeSupabase({
    user: { id: "u1" },
    resolve: (q) => permissionWorldResolver(world)(q) ?? { data: [] },
  }).client;

describe("canSeeSchoolFeesFinanceLinks", () => {
  it.each([
    ["Schools staff without finance", SCHOOLS_STAFF, false],
    ["finance.view only (can open, can't edit)", FINANCE_VIEW_ONLY, true],
    ["finance.manage via a role bundle", FINANCE_BUNDLE, true],
    ["admin", ADMIN, true],
  ])("%s → %s", async (_label: string, world: PermissionWorld, expected: boolean) => {
    expect(await canSeeSchoolFeesFinanceLinks(client(world), "u1")).toBe(expected);
  });

  it("signed out → hidden", async () => {
    expect(await canSeeSchoolFeesFinanceLinks(client(ADMIN), null)).toBe(false);
  });

  it.each([SCHOOLS_STAFF, FINANCE_VIEW_ONLY, FINANCE_BUNDLE, ADMIN])(
    "agrees with the destination gate (world %#)",
    async (world: PermissionWorld) => {
      const shown = await canSeeSchoolFeesFinanceLinks(client(world), "u1");
      const gate = requireModuleAccess(client(world), "u1", "finance");
      if (shown) await expect(gate).resolves.toBeUndefined();
      else await expect(gate).rejects.toThrow("REDIRECT:/dashboard");
    }
  );
});

describe("schoolFeesFinanceLinks", () => {
  const ADMIN_APP = path.resolve(__dirname, "../../app/(admin)");

  it("every link lands on a page gated on the finance module", () => {
    const links = schoolFeesFinanceLinks("PROGRAM");
    expect(links.map((l) => l.label)).toEqual([
      "Student billing in Finance",
      "Invoice run",
      "All fee settings in Finance",
    ]);
    for (const l of links) {
      const file = path.join(ADMIN_APP, l.href.replace("PROGRAM", "[programId]"), "page.tsx");
      expect(readFileSync(file, "utf8")).toContain(
        'requireModuleAccess(supabase, user.id, "finance")'
      );
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
