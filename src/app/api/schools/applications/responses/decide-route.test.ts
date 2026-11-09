import { beforeEach, describe, expect, it, vi } from "vitest";

// Status changes stay with program managers. Program staff are not managers,
// so this route refuses them before it updates the application or sends mail.

const h = vi.hoisted(() => ({
  canManage: true,
  updates: 0,
  notesError: null as string | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [{ id: "app1", program_id: "p1" }], error: null }),
        eq: () => ({
          single: async () => ({ data: { status: "submitted" }, error: null }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageApplications: async () => h.canManage,
  userCanManageProgram: async () => h.canManage,
}));
vi.mock("@/services/schools", () => ({
  updateResponseStatus: async () => {
    h.updates += 1;
    if (h.notesError) {
      return {
        data: { id: "app1", program_id: "p1", user_id: null },
        error: { message: h.notesError },
      };
    }
    return { data: { id: "app1", program_id: "p1", user_id: null }, error: null };
  },
  createResponse: async () => ({ data: null, error: null }),
  getReferenceSlotsByProgram: async () => ({ data: [] }),
  getQuestionsByProgram: async () => ({ data: [] }),
  createReferenceRequest: async () => ({ error: null }),
  setResponseRemoved: async () => ({ error: null }),
  removeEnrollmentForApplicant: async () => {},
  ensureEnrollmentForApplicant: async () => ({ outcome: "enrolled" }),
}));
vi.mock("@/lib/auth/application-expiry", () => ({
  userCanReadApplication: async () => true,
  APPLICATIONS_EXPIRED_MESSAGE: "archived",
}));
vi.mock("@/lib/schools/demographics", () => ({ normaliseGender: () => null }));
vi.mock("@/lib/auth/membership-roles", () => ({
  ensureStudentRole: async () => {},
  deactivateMembershipProfile: async () => {},
}));
vi.mock("@/lib/email/send-transactional", () => ({ sendTransactional: async () => {} }));
vi.mock("@/lib/email/render-program-email", () => ({ resolveProgramEmail: async () => null }));
vi.mock("@/lib/email/send-reference-invite", () => ({ sendReferenceInvite: async () => {} }));
vi.mock("@/lib/email/send-reference-reminder", () => ({ sendReferenceReminder: async () => {} }));
vi.mock("@/lib/email/reference-email", () => ({ referenceSendConfirmed: () => false }));
vi.mock("@/lib/applications/sync-contact", () => ({ syncApplicantToContact: async () => {} }));
vi.mock("@/lib/email/templates/application-rejected", () => ({ applicationRejectedEmailHtml: () => "" }));
vi.mock("@/lib/email/templates/application-waitlisted", () => ({ applicationWaitlistedEmailHtml: () => "" }));
vi.mock("@/lib/email/templates/interview-scheduled", () => ({ interviewScheduledEmailHtml: () => "" }));

const route = await import("./route");

beforeEach(() => {
  h.canManage = true;
  h.updates = 0;
  h.notesError = null;
});

function put(body: unknown) {
  return route.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }));
}

describe("application status changes", () => {
  it("lets a leader record an outcome", async () => {
    expect((await put({ id: "app1", status: "interview_scheduled" })).status).toBe(200);
    expect(h.updates).toBe(1);
  });

  it("refuses program staff before the application is updated", async () => {
    h.canManage = false;
    expect((await put({ id: "app1", status: "accepted", admin_notes: "no" })).status).toBe(403);
    expect(h.updates).toBe(0);
  });

  it("returns a failed notes write instead of success", async () => {
    h.notesError = "new row violates row-level security policy";
    const res = await put({ id: "app1", status: "interview_scheduled", admin_notes: "kept" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "new row violates row-level security policy",
    });
  });

  it("returns a failed notes write on a bulk update", async () => {
    h.notesError = "new row violates row-level security policy";
    const res = await put({
      ids: ["app1"],
      status: "interview_scheduled",
      admin_notes: "kept",
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("new row violates row-level security policy");
  });
});
