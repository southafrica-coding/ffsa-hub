import { beforeEach, describe, expect, it, vi } from "vitest";

// A notes-only save must persist the text and leave the application status
// untouched. The route reads status, then the service upserts
// application_admin_notes. Nothing updates application_responses.

const h = vi.hoisted(() => ({
  userId: "leader" as string | null,
  canManage: true,
  status: "interview_scheduled",
  ops: [] as Array<{ op: string; table: string; payload?: unknown }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: h.userId ? { id: h.userId } : null },
      }),
    },
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => {
                  h.ops.push({ op: "select", table });
                  return {
                    data: { id: "app1", program_id: "p1", status: h.status },
                    error: null,
                  };
                },
              };
            },
          };
        },
        update(payload: unknown) {
          h.ops.push({ op: "update", table, payload });
          return {
            eq() {
              return { select: () => ({ single: async () => ({ data: null, error: null }) }) };
            },
          };
        },
        upsert(payload: unknown) {
          h.ops.push({ op: "upsert", table, payload });
          return Promise.resolve({ error: null });
        },
      };
    },
  }),
}));

vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageProgram: async () => h.canManage,
}));

const route = await import("./route");

beforeEach(() => {
  h.userId = "leader";
  h.canManage = true;
  h.status = "interview_scheduled";
  h.ops = [];
});

function put(body: unknown) {
  return route.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }));
}

describe("internal note save", () => {
  it("persists the note and does not change the application status", async () => {
    const res = await put({ id: "app1", admin_notes: "  Spoke on Tuesday.  " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      status: "interview_scheduled",
      admin_notes: "Spoke on Tuesday.",
    });

    expect(h.ops.map((op) => `${op.op}:${op.table}`)).toEqual([
      "select:application_responses",
      "upsert:application_admin_notes",
    ]);
    expect(h.ops[1]?.payload).toMatchObject({
      application_response_id: "app1",
      program_id: "p1",
      notes: "Spoke on Tuesday.",
      updated_by: "leader",
    });
    expect(h.ops.some((op) => op.op === "update")).toBe(false);
  });

  it("refuses someone who cannot manage the school, and writes nothing", async () => {
    h.canManage = false;
    const res = await put({ id: "app1", admin_notes: "no" });
    expect(res.status).toBe(403);
    expect(h.ops.map((op) => op.op)).toEqual(["select"]);
  });

  it("refuses a signed-out caller", async () => {
    h.userId = null;
    expect((await put({ id: "app1", admin_notes: "no" })).status).toBe(401);
    expect(h.ops).toEqual([]);
  });
});
