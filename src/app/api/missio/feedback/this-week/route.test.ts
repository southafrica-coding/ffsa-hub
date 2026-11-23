import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

// Pastors: every house. Coaches: the houses they coach. Leaders: 403.

const h = vi.hoisted(() => ({ access: null as unknown, scopes: [] as unknown[] }));

vi.mock("@/lib/missio/house-churches", () => ({ houseReadAccess: async () => h.access }));
vi.mock("@/lib/missio/feedback-this-week", () => ({
  feedbackThisWeek: async (_db: unknown, _org: string, scope: unknown) => {
    h.scopes.push(scope);
    return { ok: true, data: { sunday: "2026-11-22", total: 1, sentCount: 0, missing: [{ id: "h1", number: 1, name: null }] } };
  },
}));

import { GET } from "./route";

const access = (roles: string[], coached: string[], led: string[] = []) => ({
  auth: { roles, supabase: {}, orgId: "org" },
  scope: roles.includes("pastor") ? { mode: "all" } : { mode: "houses", ids: [...coached, ...led] },
  editScope: roles.includes("pastor") ? { mode: "all" } : { mode: "houses", ids: coached },
});

beforeEach(() => {
  h.scopes = [];
});

describe("GET /api/missio/feedback/this-week", () => {
  it("gives a pastor every house", async () => {
    h.access = access(["pastor"], []);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(h.scopes).toEqual([{ mode: "all" }]);
    expect(await res.json()).toMatchObject({ missing: [{ id: "h1", number: 1, name: null }] });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("gives a coach only the houses they coach, not ones they lead", async () => {
    h.access = access(["coach", "house_church_leader"], ["h1"], ["h9"]);
    expect((await GET()).status).toBe(200);
    expect(h.scopes).toEqual([{ mode: "houses", ids: ["h1"] }]);
  });

  it("says 403 to a leader", async () => {
    h.access = access(["house_church_leader"], [], ["h9"]);
    expect((await GET()).status).toBe(403);
    expect(h.scopes).toEqual([]);
  });

  it("passes on 401 from the access check", async () => {
    h.access = { response: NextResponse.json({ error: "no" }, { status: 401 }) };
    expect((await GET()).status).toBe(401);
  });
});
