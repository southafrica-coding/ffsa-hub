import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  userId: "staff",
  assignedTo: "staff" as string | null,
  isStaff: true,
  canManage: false,
  canRead: true,
  wrote: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: h.userId } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [{ application_response_id: "a1", author_id: h.userId }], error: null }),
          }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: "a1", program_id: "p1", assigned_staff_id: h.assignedTo },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/auth/application-expiry", () => ({
  APPLICATIONS_EXPIRED_MESSAGE: "archived",
  userCanReadApplication: async () => h.canRead,
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageProgram: async () => h.canManage,
}));
vi.mock("@/lib/schools/program-staff-access", () => ({
  userIsProgramStaff: async () => h.isStaff,
  resolveProgramViewer: async () => ({
    canManage: h.canManage,
    isStaff: h.isStaff,
    hasSchoolsGrant: false,
  }),
}));

const route = await import("./route");

beforeEach(() => {
  h.userId = "staff";
  h.assignedTo = "staff";
  h.isStaff = true;
  h.canManage = false;
  h.canRead = true;
  h.wrote = [];
});

function put(body: unknown) {
  return route.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }));
}

describe("staff reviews", () => {
  it("rejects an outcome from someone who is not the assigned staff member", async () => {
    h.assignedTo = "someone-else";
    const res = await put({ response_id: "a1", notes: "Hi", interview_outcome: "recommend" });
    expect(res.status).toBe(403);
  });

  it("rejects a leader writing the staff review for an applicant they are not assigned", async () => {
    h.userId = "leader";
    h.assignedTo = "staff";
    h.isStaff = false;
    h.canManage = true;
    const res = await put({ response_id: "a1", notes: "Hi", interview_outcome: "decline" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/assigned staff/);
  });

  it("rejects a bad outcome", async () => {
    const res = await put({ response_id: "a1", notes: "Hi", interview_outcome: "accepted" });
    expect(res.status).toBe(400);
  });
});
