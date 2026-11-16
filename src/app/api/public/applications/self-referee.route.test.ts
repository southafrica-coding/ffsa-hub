import { beforeEach, describe, expect, it, vi } from "vitest";
import { SELF_REFEREE_MESSAGE } from "@/lib/references/self-referee";

const h = vi.hoisted(() => ({
  slots: [] as Array<Record<string, unknown>>,
  createPublicResponse: vi.fn(),
  createReferenceRequest: vi.fn(),
  sendReferenceInvite: vi.fn(),
  sendTransactional: vi.fn(),
}));

function chain(result: { data: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.ilike = () => builder;
  builder.in = () => builder;
  builder.is = () => builder;
  builder.order = () => builder;
  builder.maybeSingle = async () => result;
  builder.single = async () => result;
  builder.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: result.data, error: result.error ?? null }).then(onFulfilled, onRejected);
  return builder;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => chain({ data: null }),
  }),
}));

vi.mock("@/services/schools", () => ({
  getProgramPublicInfo: async () => ({
    data: { id: "p1", name: "Test school", code: "TEST", status: "active", application_open: true },
  }),
  getQuestionsByProgram: async () => ({
    data: [
      { id: "nat", label: "Nationality", type: "country", is_required: true, system_key: "nationality" },
      { id: "home", label: "Home Country", type: "country", is_required: true, system_key: "home_country" },
    ],
  }),
  getResponseByEmailAndProgram: async () => ({ data: null }),
  getReferenceSlotsByProgram: async () => ({ data: h.slots }),
  createPublicResponse: (...args: unknown[]) => h.createPublicResponse(...args),
  createReferenceRequest: (...args: unknown[]) => h.createReferenceRequest(...args),
}));

vi.mock("@/services/consent", () => ({
  getCurrentConsentAgreement: async () => ({ data: { version: "v1" } }),
  recordConsent: async () => ({ data: null, error: null }),
}));

vi.mock("@/lib/slack/notify", () => ({ notifyApplicationSubmitted: async () => {} }));
vi.mock("@/lib/applications/sync-contact", () => ({ syncApplicantToContact: async () => {} }));
vi.mock("@/lib/email/send-transactional", () => ({
  sendTransactional: (...args: unknown[]) => h.sendTransactional(...args),
}));
vi.mock("@/lib/email/render-program-email", () => ({
  resolveProgramEmail: async (_s: unknown, _p: unknown, _k: unknown, defaults: { subject: string; html: string }) =>
    ({ skip: false as const, subject: defaults.subject, html: defaults.html }),
}));
vi.mock("@/lib/email/templates/application-confirmation", () => ({
  applicationConfirmationEmailHtml: () => "<p>received</p>",
  applicationReferenceNotice: () => "",
}));
vi.mock("@/lib/email/send-reference-invite", () => ({
  sendReferenceInvite: (...args: unknown[]) => h.sendReferenceInvite(...args),
}));
vi.mock("@/lib/email/reference-email", () => ({ referenceSendConfirmed: () => false }));

import { POST } from "./route";

const slots = [
  { id: "slot-1", label: "Pastoral Reference", is_required: true },
  { id: "slot-2", label: "Friend", is_required: false },
];

function submit(references: Array<Record<string, string>>) {
  return POST(
    new Request("https://hub.test/api/public/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        program_id: "0f7bf38e-ada3-4daa-8b22-69380934a1f7",
        answers: [],
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        nationality: "South Africa",
        home_country: "South Africa",
        consent_version: "v1",
        references,
      }),
    })
  );
}

describe("POST /api/public/applications self-referee", () => {
  beforeEach(() => {
    h.slots = slots;
    h.createPublicResponse.mockReset();
    h.createPublicResponse.mockResolvedValue({
      data: { id: "app1", status_token: "tok", applicant_email: "ada@example.com" },
      error: null,
    });
    h.createReferenceRequest.mockReset();
    h.createReferenceRequest.mockResolvedValue({
      data: { id: "ref-1", token: "invite-token" },
      error: null,
    });
    h.sendReferenceInvite.mockReset();
    h.sendTransactional.mockReset();
    h.sendTransactional.mockResolvedValue({ ok: true, id: "msg" });
  });

  it("rejects a self referee before the application, the reference row, or any email", async () => {
    const res = await submit([
      { slot_id: "slot-1", referee_name: "Ada", referee_email: " Ada@Example.com " },
    ]);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(SELF_REFEREE_MESSAGE);
    expect(h.createPublicResponse).not.toHaveBeenCalled();
    expect(h.createReferenceRequest).not.toHaveBeenCalled();
    expect(h.sendReferenceInvite).not.toHaveBeenCalled();
    expect(h.sendTransactional).not.toHaveBeenCalled();
  });

  it("names the referee entry when more than one is submitted", async () => {
    const res = await submit([
      { slot_id: "slot-1", referee_name: "Pastor", referee_email: "pastor@example.com" },
      { slot_id: "slot-2", referee_name: "Ada", referee_email: "ada@example.com" },
    ]);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Friend");
    expect(body.error).toContain(SELF_REFEREE_MESSAGE);
    expect(body.error).not.toContain("Pastoral Reference");
    expect(h.createPublicResponse).not.toHaveBeenCalled();
    expect(h.createReferenceRequest).not.toHaveBeenCalled();
    expect(h.sendReferenceInvite).not.toHaveBeenCalled();
  });

  it("still accepts a different email, including a plus-tag", async () => {
    const res = await submit([
      { slot_id: "slot-1", referee_name: "Pastor", referee_email: "pastor@example.com" },
      { slot_id: "slot-2", referee_name: "Ada", referee_email: "ada+ref@example.com" },
    ]);
    expect(res.status).toBe(200);
    expect(h.createPublicResponse).toHaveBeenCalledOnce();
    expect(h.createReferenceRequest).toHaveBeenCalledTimes(2);
    expect(h.sendReferenceInvite).toHaveBeenCalled();
  });
});
