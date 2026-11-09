import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "me" } as { id: string } | null,
  canManage: true,
  inserted: null as Record<string, unknown> | null,
  insertError: null as { code?: string; message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageProgram: async () => h.canManage,
  userCanManageApplications: async () => h.canManage,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));
vi.mock("@/services/learning-courses", () => ({
  listLearningCourses: async () => ({ data: [{ id: "c1", code: "FFBX" }], error: null }),
  insertLearningCourse: async (_client: unknown, row: Record<string, unknown>) => {
    h.inserted = row;
    return { data: { id: "c1", ...row }, error: h.insertError };
  },
}));

import { GET, POST } from "./route";

const PROGRAM = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ programId: PROGRAM }) };

beforeEach(() => {
  h.user = { id: "me" };
  h.canManage = true;
  h.inserted = null;
  h.insertError = null;
});

describe("learning courses API", () => {
  it("lists courses for a school manager and refuses everyone else", async () => {
    const ok = await GET(new Request("http://x"), ctx);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ courses: [{ code: "FFBX" }] });

    h.canManage = false;
    expect((await GET(new Request("http://x"), ctx)).status).toBe(403);
    h.user = null;
    expect((await POST(new Request("http://x", { method: "POST", body: "{}" }), ctx)).status).toBe(401);
  });

  it("creates a billing course shell without fee fields", async () => {
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ code: "ffbx", name: "Bible school", credit_hours: 12, graded: true }),
      }),
      ctx
    );
    expect(res.status).toBe(201);
    expect(h.inserted).toMatchObject({
      program_id: PROGRAM,
      code: "FFBX",
      name: "Bible school",
      credit_hours: 12,
      graded: true,
      created_by: "me",
    });
    expect(h.inserted).not.toHaveProperty("fee");
  });

  it("rejects an end date before the start", async () => {
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ code: "FFBX", name: "Bible school", start_date: "2026-06-01", end_date: "2026-01-01" }),
      }),
      ctx
    );
    expect(res.status).toBe(400);
    expect(h.inserted).toBeNull();
  });

  it("rejects a bad school id and refuses preview writes", async () => {
    const bad = await GET(new Request("http://x"), { params: Promise.resolve({ programId: "not-a-school" }) });
    expect(bad.status).toBe(400);

    const previous = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "preview";
    try {
      const preview = await POST(
        new Request("http://x", { method: "POST", body: JSON.stringify({ code: "FFBX", name: "Bible school" }) }),
        ctx
      );
      expect(preview.status).toBe(403);
      expect(await preview.json()).toMatchObject({ error: "preview_writes_disabled" });
      expect(h.inserted).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = previous;
    }
  });
});
