import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  permissionWorldResolver,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

// The access gates added by "close access gaps" (PR #441), checked for two
// accounts side by side: a Schools staff member with no finance grant, and a
// finance user who holds finance.manage only through a role bundle. Plus an
// admin, for the admin-only Google Calendar routes.

const SCHOOLS_STAFF: PermissionWorld = {
  roles: [{ id: "r-staff", name: "staff" }],
  direct: [],
  bundles: { "r-staff": [{ module: "schools", key: "schools.view" }] },
};
const FINANCE_BUNDLE: PermissionWorld = {
  // A custom role, not the seeded finance_office (which bundles only
  // finance.donor_statements, migration 248).
  roles: [{ id: "r-fin", name: "finance_team" }],
  direct: [],
  bundles: { "r-fin": [{ module: "finance", key: "finance.manage" }] },
};
const ADMIN: PermissionWorld = { roles: [{ id: "r-a", name: "admin" }], direct: [] };

const state = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: null as any,
  deletes: [] as string[],
}));

function signIn(world: PermissionWorld | null) {
  state.client = createFakeSupabase({
    user: world ? { id: "u1" } : null,
    resolve: (q) => (world ? permissionWorldResolver(world)(q) : null) ?? { data: [] },
  }).client;
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));
vi.mock("@/services/xero", () => ({
  xeroRedirectUri: () => "http://localhost:3000/api/integrations/xero/callback",
  deleteTokens: vi.fn(async () => {
    state.deletes.push("xero");
    return { error: null };
  }),
}));
vi.mock("@/lib/google/calendar", () => ({
  googleCalendarRedirectUri: () => "http://localhost:3000/api/integrations/google-calendar/callback",
  saveCalendarTokens: vi.fn(),
  deleteCalendarTokens: vi.fn(async () => {
    state.deletes.push("gcal");
    return { error: null };
  }),
}));

import { canManageFinance, hasAnyPermission } from "@/lib/api-auth";
import { requireModuleAccess } from "@/lib/require-permission";
import { GET as xeroConnect } from "./xero/connect/route";
import { POST as xeroDisconnect } from "./xero/disconnect/route";
import { GET as gcalConnect } from "./google-calendar/connect/route";
import { POST as gcalDisconnect } from "./google-calendar/disconnect/route";
import { POST as importComplete } from "../records-library/imports/[id]/complete/route";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  process.env.XERO_CLIENT_ID = "xero-client";
  process.env.GOOGLE_OAUTH_CLIENT_ID = "google-client";
  state.deletes = [];
});

const post = (body: unknown = {}) =>
  new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });

describe("hasAnyPermission counts role-bundle grants", () => {
  it("finance.manage through a role bundle counts", async () => {
    signIn(FINANCE_BUNDLE);
    expect(await hasAnyPermission(state.client, "u1", ["finance.manage"])).toBe(true);
    expect(await canManageFinance(state.client, "u1")).toBe(true);
  });

  it("a Schools-only bundle does not", async () => {
    signIn(SCHOOLS_STAFF);
    expect(await hasAnyPermission(state.client, "u1", ["finance.manage"])).toBe(false);
    expect(await canManageFinance(state.client, "u1")).toBe(false);
  });
});

describe("finance page gate: requireModuleAccess(…, 'finance')", () => {
  it("sends Schools staff to /dashboard", async () => {
    signIn(SCHOOLS_STAFF);
    await expect(requireModuleAccess(state.client, "u1", "finance")).rejects.toThrow(
      "REDIRECT:/dashboard"
    );
  });

  it("lets the finance user through", async () => {
    signIn(FINANCE_BUNDLE);
    await expect(requireModuleAccess(state.client, "u1", "finance")).resolves.toBeUndefined();
  });
});

describe("Xero connect / disconnect", () => {
  it("connect: signed out goes to /login", async () => {
    signIn(null);
    const res = await xeroConnect(new Request("http://localhost/x"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("connect: Schools staff get 403", async () => {
    signIn(SCHOOLS_STAFF);
    expect((await xeroConnect(new Request("http://localhost/x"))).status).toBe(403);
  });

  it("connect: finance user goes to Xero with main's write scope", async () => {
    signIn(FINANCE_BUNDLE);
    const res = await xeroConnect(new Request("http://localhost/x?region=za"));
    const location = new URL(res.headers.get("location")!);
    expect(location.host).toBe("login.xero.com");
    const scopes = location.searchParams.get("scope")!.split(" ");
    expect(scopes).toContain("accounting.settings");
    expect(scopes).not.toContain("accounting.settings.read");
  });

  it("disconnect: 401 signed out, 403 Schools staff, 200 finance", async () => {
    signIn(null);
    expect((await xeroDisconnect(post())).status).toBe(401);
    signIn(SCHOOLS_STAFF);
    expect((await xeroDisconnect(post())).status).toBe(403);
    expect(state.deletes).toEqual([]);
    signIn(FINANCE_BUNDLE);
    expect((await xeroDisconnect(post())).status).toBe(200);
    expect(state.deletes).toEqual(["xero"]);
  });
});

describe("Google Calendar connect / disconnect are admin-only", () => {
  it("connect: 403 for a finance (non-admin) user, Google consent for admin", async () => {
    signIn(FINANCE_BUNDLE);
    expect((await gcalConnect()).status).toBe(403);
    signIn(ADMIN);
    const res = await gcalConnect();
    expect(new URL(res.headers.get("location")!).host).toBe("accounts.google.com");
  });

  it("disconnect: 403 for Schools staff, 200 for admin", async () => {
    signIn(SCHOOLS_STAFF);
    expect((await gcalDisconnect()).status).toBe(403);
    expect(state.deletes).toEqual([]);
    signIn(ADMIN);
    expect((await gcalDisconnect()).status).toBe(200);
    expect(state.deletes).toEqual(["gcal"]);
  });
});

describe("Records Library import complete", () => {
  const ctx = { params: Promise.resolve({ id: "imp-1" }) };

  it("401 signed out", async () => {
    signIn(null);
    expect((await importComplete(post(), ctx)).status).toBe(401);
  });

  it("403 for Schools staff and for a plain admin (super_admin carve-out)", async () => {
    signIn(SCHOOLS_STAFF);
    expect((await importComplete(post(), ctx)).status).toBe(403);
    signIn(ADMIN);
    expect((await importComplete(post(), ctx)).status).toBe(403);
  });
});

// Server pages are not rendered here; check the gate is in the source and runs
// before anything reads data with the service-role client.
describe("gated pages call requireModuleAccess before reading", () => {
  const ADMIN_APP = path.resolve(__dirname, "../../(admin)");
  const GATED: Array<[string, string]> = [
    ["finance/school-fees/page.tsx", "finance"],
    ["finance/school-fees/email-templates/page.tsx", "finance"],
    ["finance/school-fees/[programId]/page.tsx", "finance"],
    ["finance/school-fees/[programId]/billing/page.tsx", "finance"],
    ["finance/school-fees/[programId]/billing/[courseId]/page.tsx", "finance"],
    ["finance/school-fees/[programId]/match-xero/page.tsx", "finance"],
    ["finance/school-fees/[programId]/students/page.tsx", "finance"],
    ["finance/school-fees/[programId]/students/[enrollmentId]/page.tsx", "finance"],
    ["events/new/page.tsx", "events"],
    ["events/[id]/page.tsx", "events"],
    ["events/[id]/forms/[formId]/page.tsx", "events"],
    ["events/[id]/forms/[formId]/responses/page.tsx", "events"],
    ["events/[id]/feedback/[formId]/page.tsx", "events"],
    ["events/[id]/feedback/[formId]/responses/page.tsx", "events"],
    ["communications/campaigns/[id]/page.tsx", "communications"],
  ];

  it.each(GATED)("%s → %s", (file: string, module: string) => {
    const src = readFileSync(path.join(ADMIN_APP, file), "utf8");
    expect(src).toMatch(/if \(!user\) redirect\("\/login"\)/);
    const gate = src.indexOf(`requireModuleAccess(supabase, user.id, "${module}")`);
    expect(gate).toBeGreaterThan(-1);
    const adminRead = src.indexOf("createAdminClient()");
    if (adminRead > -1) expect(gate).toBeLessThan(adminRead);
  });

  // Main opened outreach finance to owners, co-leaders and group managers
  // (RLS + outreach-access decide what each sees), so these only require
  // sign-in — a finance-module gate would lock team leaders out.
  it.each(["finance/outreach/page.tsx", "finance/outreach/[teamId]/page.tsx"])(
    "%s requires sign-in but not the finance module",
    (file: string) => {
      const src = readFileSync(path.join(ADMIN_APP, file), "utf8");
      expect(src).toMatch(/if \(!user\) redirect\("\/login"\)/);
      expect(src).not.toMatch(/requireModuleAccess\([^)]*"finance"\)/);
    }
  );
});
