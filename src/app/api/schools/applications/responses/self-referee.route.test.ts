import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/lib/testing/fake-supabase";
import { SELF_REFEREE_MESSAGE } from "@/lib/references/self-referee";

const h = vi.hoisted(() => ({
  createResponse: vi.fn(),
  createReferenceRequest: vi.fn(),
  sendReferenceInvite: vi.fn(),
  userEmail: "auth@example.com",
  accountEmail: "account@example.com",
}));

const state = vi.hoisted(() => ({
  user: null as ReturnType<typeof createFakeSupabase>["client"] | null,
}));

function signedIn() {
  state.user = createFakeSupabase({
    user: { id: "user-1", email: h.userEmail },
    resolve: (q: FakeQuery) => {
      if (q.table === "users") return { data: { email: h.accountEmail } };
      return { data: [] };
    },
  }).client;
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.user }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createFakeSupabase({
      resolve: () => ({ data: null }),
    }).client,
}));
vi.mock("@/services/schools", () => ({
  createResponse: (...args: unknown[]) => h.createResponse(...args),
  updateResponseStatus: vi.fn(),
  getReferenceSlotsByProgram: async () => ({
    data: [
      { id: "slot-1", label: "Pastoral Reference", is_required: true },
      { id: "slot-2", label: "Friend", is_required: false },
    ],
  }),
  getQuestionsByProgram: async () => ({ data: [] }),
  createReferenceRequest: (...args: unknown[]) => h.createReferenceRequest(...args),
  setResponseRemoved: vi.fn(),
  removeEnrollmentForApplicant: vi.fn(),
  ensureEnrollmentForApplicant: vi.fn(),
  setEnrollmentRemoved: vi.fn(),
}));
vi.mock("@/lib/auth/membership-roles", () => ({
  ensureStudentRole: vi.fn(async () => {}),
  deactivateMembershipProfile: vi.fn(),
}));
vi.mock("@/lib/email/send-transactional", () => ({ sendTransactional: vi.fn() }));
vi.mock("@/lib/email/render-program-email", () => ({ resolveProgramEmail: vi.fn() }));
vi.mock("@/lib/email/send-reference-invite", () => ({
  sendReferenceInvite: (...args: unknown[]) => h.sendReferenceInvite(...args),
}));
vi.mock("@/lib/email/send-reference-reminder", () => ({ sendReferenceReminder: vi.fn() }));
vi.mock("@/lib/email/reference-email", () => ({ referenceSendConfirmed: () => false }));
vi.mock("@/lib/references/reminder-claim", () => ({ claimThenSendReferenceReminder: vi.fn() }));
vi.mock("@/lib/preview-writes", () => ({ previewWriteRefusal: vi.fn(() => null) }));
vi.mock("@/lib/applications/sync-contact", () => ({ syncApplicantToContact: async () => {} }));
vi.mock("@/lib/email/templates/application-rejected", () => ({ applicationRejectedEmailHtml: vi.fn() }));
vi.mock("@/lib/email/templates/application-waitlisted", () => ({ applicationWaitlistedEmailHtml: vi.fn() }));
vi.mock("@/lib/email/templates/interview-scheduled", () => ({ interviewScheduledEmailHtml: vi.fn() }));
vi.mock("@/lib/schools/acceptance-email", () => ({ sendAcceptanceToLinkedAccount: vi.fn() }));

import { POST } from "./route";

function submit(references: Array<Record<string, string>>) {
  return POST(
    new Request("http://localhost/api/schools/applications/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        program_id: "prog-1",
        answers: [],
        references,
      }),
    })
  );
}

describe("POST /api/schools/applications/responses self-referee", () => {
  beforeEach(() => {
    h.userEmail = "auth@example.com";
    h.accountEmail = "account@example.com";
    signedIn();
    h.createResponse.mockReset();
    h.createResponse.mockResolvedValue({
      data: { id: "app-1", status_token: "tok" },
      error: null,
    });
    h.createReferenceRequest.mockReset();
    h.createReferenceRequest.mockResolvedValue({
      data: { id: "ref-1", token: "invite" },
      error: null,
    });
    h.sendReferenceInvite.mockReset();
  });

  it("rejects the signed-in auth email before the application or any referee email", async () => {
    const res = await submit([
      { slot_id: "slot-1", referee_name: "Me", referee_email: " Auth@Example.com " },
    ]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(SELF_REFEREE_MESSAGE);
    expect(h.createResponse).not.toHaveBeenCalled();
    expect(h.createReferenceRequest).not.toHaveBeenCalled();
    expect(h.sendReferenceInvite).not.toHaveBeenCalled();
  });

  it("rejects the users-table email and names the entry in a multi-referee submit", async () => {
    const res = await submit([
      { slot_id: "slot-1", referee_name: "Pastor", referee_email: "pastor@example.com" },
      { slot_id: "slot-2", referee_name: "Me", referee_email: "account@example.com" },
    ]);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Friend");
    expect(body.error).toContain(SELF_REFEREE_MESSAGE);
    expect(h.createResponse).not.toHaveBeenCalled();
    expect(h.createReferenceRequest).not.toHaveBeenCalled();
    expect(h.sendReferenceInvite).not.toHaveBeenCalled();
  });

  it("still accepts a different email, including a plus-tag", async () => {
    const res = await submit([
      { slot_id: "slot-1", referee_name: "Pastor", referee_email: "auth+ref@example.com" },
    ]);
    expect(res.status).toBe(200);
    expect(h.createResponse).toHaveBeenCalledOnce();
    expect(h.createReferenceRequest).toHaveBeenCalledOnce();
    expect(h.sendReferenceInvite).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: "auth+ref@example.com" })
    );
  });
});
