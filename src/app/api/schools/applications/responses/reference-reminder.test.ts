import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ canManage: true, sent: 0 }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              id: "ref1",
              status: "pending",
              referee_email: "ref@example.com",
              referee_name: "Pat",
              token: "tok",
              reference_slots: { label: "Pastor" },
              application_responses: {
                id: "app1",
                program_id: "p1",
                applicant_info: { first_name: "Ada", last_name: "Lovelace" },
                programs: { name: "SBI" },
              },
            },
            error: null,
          }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageApplications: async () => h.canManage,
  userCanManageProgram: async () => h.canManage,
}));
vi.mock("@/lib/auth/application-expiry", () => ({
  userCanReadApplication: async () => true,
  APPLICATIONS_EXPIRED_MESSAGE: "archived",
}));
vi.mock("@/services/schools", () => ({
  updateResponseStatus: async () => ({ data: null, error: null }),
  createResponse: async () => ({ data: null, error: null }),
  getReferenceSlotsByProgram: async () => ({ data: [] }),
  getQuestionsByProgram: async () => ({ data: [] }),
  createReferenceRequest: async () => ({ error: null }),
  setResponseRemoved: async () => ({ error: null }),
  removeEnrollmentForApplicant: async () => {},
  ensureEnrollmentForApplicant: async () => ({ outcome: "enrolled" }),
}));
vi.mock("@/lib/schools/demographics", () => ({ normaliseGender: () => null }));
vi.mock("@/lib/auth/membership-roles", () => ({
  ensureStudentRole: async () => {},
  deactivateMembershipProfile: async () => {},
}));
vi.mock("@/lib/email/send-transactional", () => ({ sendTransactional: async () => {} }));
vi.mock("@/lib/email/render-program-email", () => ({ resolveProgramEmail: async () => null }));
vi.mock("@/lib/email/send-reference-invite", () => ({ sendReferenceInvite: async () => {} }));
vi.mock("@/lib/email/send-reference-reminder", () => ({
  sendReferenceReminder: async () => {
    h.sent += 1;
    return { ok: true };
  },
}));
vi.mock("@/lib/email/reference-email", () => ({ referenceSendConfirmed: () => true }));
vi.mock("@/lib/applications/sync-contact", () => ({ syncApplicantToContact: async () => {} }));
vi.mock("@/lib/email/templates/application-rejected", () => ({ applicationRejectedEmailHtml: () => "" }));
vi.mock("@/lib/email/templates/application-waitlisted", () => ({ applicationWaitlistedEmailHtml: () => "" }));
vi.mock("@/lib/email/templates/interview-scheduled", () => ({ interviewScheduledEmailHtml: () => "" }));

const route = await import("./route");

beforeEach(() => {
  h.canManage = true;
  h.sent = 0;
});

function patch() {
  return route.PATCH(
    new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ action: "send_reference_reminder", reference_request_id: "ref1" }),
    })
  );
}

describe("reference reminder", () => {
  it("lets a manager send it", async () => {
    expect((await patch()).status).toBe(200);
    expect(h.sent).toBe(1);
  });

  it("refuses program staff", async () => {
    h.canManage = false;
    expect((await patch()).status).toBe(403);
    expect(h.sent).toBe(0);
  });
});
