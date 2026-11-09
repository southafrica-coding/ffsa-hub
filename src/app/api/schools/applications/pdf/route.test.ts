import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ canManage: true, notes: "Leader only" }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    from: (table: string) => {
      if (table === "application_responses") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: "app1",
                  program_id: "p1",
                  status: "submitted",
                  submitted_at: "2026-01-01T00:00:00Z",
                  answers: [],
                  applicant_info: { first_name: "Ada", last_name: "Lovelace" },
                  applicant_email: "ada@example.com",
                  user_id: null,
                  admin_notes: "should not be trusted from the row",
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "programs") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { name: "SBI", code: "SBI" }, error: null }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: [], error: null }),
            single: async () => ({ data: null, error: null }),
          }),
        }),
      };
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
  }),
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageProgram: async () => h.canManage,
}));
vi.mock("@/lib/schools/admin-notes", () => ({
  adminNotesByResponse: async () => new Map(h.canManage ? [["app1", h.notes]] : []),
}));

const route = await import("./route");

beforeEach(() => {
  h.canManage = true;
});

function getPdf() {
  return route.GET(new Request("http://x/api/schools/applications/pdf?response_id=app1"));
}

describe("application PDF", () => {
  it("includes leader notes for a manager", async () => {
    const res = await getPdf();
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Leader only");
  });

  it("leaves leader notes out for program staff", async () => {
    h.canManage = false;
    const res = await getPdf();
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("Leader only");
    expect(html).not.toContain("should not be trusted");
    expect(html).not.toContain("Admin Notes");
  });
});