import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// MOCKED authorization. The real requireModuleAccess / hasModuleAccess /
// canManageOrg functions run against a fake Supabase client. This is not a
// signed-in session, and has_org_chart_manage() SQL is not executed.
// Vitest cannot import page.tsx (tsconfig jsx is "preserve"), so the page's
// call order is locked by reading the source: the gate runs before loadOrgChart.

const h = vi.hoisted(() => {
  const state = {
    roles: [] as Array<{ role_id: string; roles: { name: string } | null }>,
    /** permission.module values. org.view and org.manage are both module "org-chart". */
    directModules: [] as string[],
    /** Fake return of rpc("has_org_chart_manage"). Not the database function. */
    manage: false,
    rpcError: false,
  };

  function query(data: () => unknown) {
    const row = () => ({ data: data(), error: null });
    const api: {
      select: () => typeof api;
      eq: () => typeof api;
      in: () => typeof api;
      limit: () => Promise<{ data: unknown; error: null }>;
      then: (a: (v: { data: unknown; error: null }) => unknown, b?: (e: unknown) => unknown) => Promise<unknown>;
    } = {
      select: () => api,
      eq: () => api,
      in: () => api,
      limit: () => Promise.resolve(row()),
      then: (a, b) => Promise.resolve(row()).then(a, b),
    };
    return api;
  }

  function supabase() {
    return {
      from(table: string) {
        if (table === "user_roles") return query(() => state.roles);
        if (table === "user_permissions") {
          return query(() =>
            state.directModules.includes("org-chart") ? [{ permissions: { module: "org-chart" } }] : []
          );
        }
        return query(() => []);
      },
      rpc: async (name: string) => {
        if (name !== "has_org_chart_manage") return { data: null, error: { message: "unexpected rpc " + name } };
        if (state.rpcError) return { data: null, error: { message: "rpc failed" } };
        return { data: state.manage, error: null };
      },
    };
  }

  return { state, supabase };
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error("REDIRECT:" + url);
  },
}));

import { hasModuleAccess, requireModuleAccess } from "@/lib/require-permission";
import { canManageOrg } from "@/services/org-import";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

beforeEach(() => {
  h.state.roles = [];
  h.state.directModules = [];
  h.state.manage = false;
  h.state.rpcError = false;
});

describe("org chart authorization (mocked supabase, real gate)", () => {
  it("keeps the page gate ahead of loading the chart", () => {
    const session = pageSource.indexOf("getSession");
    const gate = pageSource.indexOf('requireModuleAccess(supabase, user.id, "org-chart")');
    const load = pageSource.indexOf("loadOrgChart(createAdminClient()");
    const manage = pageSource.indexOf("canManageOrg(supabase)");
    expect(session).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(session);
    expect(load).toBeGreaterThan(gate);
    expect(manage).toBeGreaterThan(gate);
  });

  it("denies a signed-in viewer with no org-chart grant", async () => {
    const supabase = h.supabase();
    expect(await hasModuleAccess(supabase, "viewer", "org-chart")).toBe(false);
    await expect(requireModuleAccess(supabase, "viewer", "org-chart")).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("allows a read-only org.view holder onto the page, and canManageOrg stays false", async () => {
    h.state.roles = [{ role_id: "staff-role", roles: { name: "staff" } }];
    h.state.directModules = ["org-chart"];
    h.state.manage = false;
    const supabase = h.supabase();
    expect(await hasModuleAccess(supabase, "reader", "org-chart")).toBe(true);
    await expect(requireModuleAccess(supabase, "reader", "org-chart")).resolves.toBeUndefined();
    expect(await canManageOrg(supabase)).toBe(false);
  });

  it("treats an admin as a manager when the manage rpc says so", async () => {
    h.state.roles = [{ role_id: "admin-role", roles: { name: "admin" } }];
    h.state.manage = true;
    const supabase = h.supabase();
    expect(await hasModuleAccess(supabase, "manager", "org-chart")).toBe(true);
    expect(await canManageOrg(supabase)).toBe(true);
  });

  it("does not treat a failed manage rpc as permission to edit", async () => {
    h.state.roles = [{ role_id: "admin-role", roles: { name: "admin" } }];
    h.state.rpcError = true;
    expect(await canManageOrg(h.supabase())).toBe(false);
  });
});
