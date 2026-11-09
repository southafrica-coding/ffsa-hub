import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ canManage: true, wrote: 0 }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageProgram: async () => h.canManage,
}));
vi.mock("@/services/program-email-templates", () => ({
  listProgramEmailTemplates: async () => ({ data: [], error: null }),
  upsertProgramEmailTemplate: async () => {
    h.wrote += 1;
    return { data: null, error: null };
  },
}));

const route = await import("./route");
const ctx = { params: Promise.resolve({ programId: "p1" }) };

beforeEach(() => {
  h.canManage = true;
  h.wrote = 0;
});

describe("program email edits", () => {
  it("lets a leader read and save templates", async () => {
    expect((await route.GET(new Request("http://x"), ctx)).status).toBe(200);
    const res = await route.PUT(
      new Request("http://x", {
        method: "PUT",
        body: JSON.stringify({ emailType: "application_received", enabled: true, subject: "Hi", body: "Hello" }),
      }),
      ctx
    );
    expect(res.status).toBe(200);
    expect(h.wrote).toBe(1);
  });

  it("refuses program staff", async () => {
    h.canManage = false;
    expect((await route.GET(new Request("http://x"), ctx)).status).toBe(403);
    const res = await route.PUT(
      new Request("http://x", {
        method: "PUT",
        body: JSON.stringify({ emailType: "application_received", enabled: false }),
      }),
      ctx
    );
    expect(res.status).toBe(403);
    expect(h.wrote).toBe(0);
  });
});
