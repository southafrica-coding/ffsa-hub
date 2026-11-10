import { beforeEach, describe, expect, it, vi } from "vitest";

const HOUR = 60 * 60 * 1000;

const h = vi.hoisted(() => ({
  canManage: true,
  canRead: true,
  preview: false,
  sent: 0,
  stamps: 0,
  status: "pending",
  reminderSentAt: null as string | null,
  checkedProgram: null as string | null,
  readId: null as string | null,
  list: null as Array<Record<string, unknown>> | null,
}));

function refRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ref1",
    status: h.status,
    reminder_sent_at: h.reminderSentAt,
    referee_email: "ref@example.com",
    referee_name: "Pat",
    token: "tok",
    application_id: "app1",
    reference_slots: { label: "Pastor" },
    application_responses: {
      id: "app1",
      program_id: "p1",
      applicant_info: { first_name: "Ada", last_name: "Lovelace" },
      programs: { name: "SBI" },
    },
    ...overrides,
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "application_responses") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: "app1",
                  program_id: "p1",
                  applicant_email: null,
                  applicant_info: { first_name: "Ada", last_name: "Lovelace" },
                  users: null,
                  programs: { name: "SBI" },
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => {
            const listed = { data: h.list ?? [refRow()], error: null };
            return {
              single: async () => ({
                data: h.status === "missing" ? null : refRow(),
                error: null,
              }),
              then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
                Promise.resolve(listed).then(resolve, reject),
            };
          },
        }),
        update: () => ({
          eq: async () => {
            h.stamps += 1;
            return { error: null };
          },
        }),
      };
    },
  }),
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageApplications: async () => h.canManage,
  userCanManageProgram: async (_supabase: unknown, _userId: string, programId: string) => {
    h.checkedProgram = programId;
    return h.canManage;
  },
}));
vi.mock("@/lib/auth/application-expiry", () => ({
  userCanReadApplication: async (_supabase: unknown, id: string) => {
    h.readId = id;
    return h.canRead;
  },
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
    return { ok: true, id: "email-1" };
  },
}));
vi.mock("@/lib/email/reference-email", () => ({
  referenceSendConfirmed: (result: { ok?: boolean; id?: string | null }) =>
    result?.ok === true && typeof result.id === "string" && result.id.length > 0,
}));
vi.mock("@/lib/applications/sync-contact", () => ({ syncApplicantToContact: async () => {} }));
vi.mock("@/lib/email/templates/application-rejected", () => ({ applicationRejectedEmailHtml: () => "" }));
vi.mock("@/lib/email/templates/application-waitlisted", () => ({ applicationWaitlistedEmailHtml: () => "" }));
vi.mock("@/lib/email/templates/interview-scheduled", () => ({ interviewScheduledEmailHtml: () => "" }));
vi.mock("@/lib/preview-writes", () => ({
  previewWritesDisabled: () => h.preview,
}));

const route = await import("./route");

beforeEach(() => {
  h.canManage = true;
  h.canRead = true;
  h.preview = false;
  h.sent = 0;
  h.stamps = 0;
  h.status = "pending";
  h.reminderSentAt = null;
  h.checkedProgram = null;
  h.readId = null;
  h.list = null;
});

function patch(body: Record<string, unknown>) {
  return route.PATCH(
    new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  );
}

function remindOne() {
  return patch({ action: "send_reference_reminder", reference_request_id: "ref1" });
}

describe("reference reminder", () => {
  it("lets a manager send it once", async () => {
    const res = await remindOne();
    expect(res.status).toBe(200);
    expect(h.sent).toBe(1);
    expect(h.stamps).toBe(1);
    expect(h.checkedProgram).toBe("p1");
    expect(h.readId).toBe("app1");
  });

  it("rejects a user without this school's scope", async () => {
    h.canManage = false;
    expect((await remindOne()).status).toBe(403);
    expect(h.sent).toBe(0);
    expect(h.stamps).toBe(0);
  });

  it("rejects a user who cannot read the application", async () => {
    h.canRead = false;
    expect((await remindOne()).status).toBe(403);
    expect(h.sent).toBe(0);
    expect(h.stamps).toBe(0);
  });

  it("rejects a submitted reference", async () => {
    h.status = "submitted";
    const res = await remindOne();
    expect(res.status).toBe(409);
    expect(h.sent).toBe(0);
    expect(h.stamps).toBe(0);
  });

  it("rejects a reminder inside the 24 hour window", async () => {
    h.reminderSentAt = new Date(Date.now() - HOUR).toISOString();
    const res = await remindOne();
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.error).toMatch(/23 hours/);
    expect(body.retry_after_seconds).toBeGreaterThan(0);
    expect(h.sent).toBe(0);
    expect(h.stamps).toBe(0);
  });

  it("allows another reminder once 24 hours have passed", async () => {
    h.reminderSentAt = new Date(Date.now() - 24 * HOUR).toISOString();
    expect((await remindOne()).status).toBe(200);
    expect(h.sent).toBe(1);
  });

  it("refuses preview mode without sending or stamping", async () => {
    h.preview = true;
    const res = await remindOne();
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(String(body.error).toLowerCase()).toMatch(/preview/);
    expect(h.sent).toBe(0);
    expect(h.stamps).toBe(0);
  });

  it("returns 429 for remind-all when the only outstanding reference is cooling down", async () => {
    h.list = [
      refRow({
        id: "ref-open",
        status: "pending",
        reminder_sent_at: new Date(Date.now() - HOUR).toISOString(),
      }),
    ];
    const res = await patch({
      action: "send_outstanding_reference_reminders",
      application_id: "app1",
    });
    expect(res.status).toBe(429);
    expect(h.sent).toBe(0);
    expect(h.stamps).toBe(0);
  });

  it("reminds every outstanding reference once and skips one already submitted", async () => {
    h.list = [
      refRow({ id: "ref-open", status: "pending" }),
      refRow({ id: "ref-done", status: "submitted" }),
    ];
    const res = await patch({
      action: "send_outstanding_reference_reminders",
      application_id: "app1",
    });
    expect(res.status).toBe(200);
    expect(h.sent).toBe(1);
    expect(h.stamps).toBe(1);
    expect(h.checkedProgram).toBe("p1");
  });
});
