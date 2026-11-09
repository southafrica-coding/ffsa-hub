import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  questions: [] as Array<Record<string, unknown>>,
  createPublicResponse: vi.fn(),
  sendTransactional: vi.fn(),
  skipEmail: false,
  lookups: [] as Array<{ table: string; op: string; column: string; value: unknown }>,
  byEmail: vi.fn(),
}));

function chain(table: string, result: { data: unknown; error?: unknown }) {
  const builder: Record<string, unknown> = {};
  const note = (op: string) => (column: string, value?: unknown) => {
    h.lookups.push({ table, op, column, value });
    return builder;
  };
  builder.select = () => builder;
  builder.eq = note("eq");
  builder.ilike = note("ilike");
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
    from: (table: string) => chain(table, { data: null }),
  }),
}));

vi.mock("@/services/schools", () => ({
  getProgramPublicInfo: async () => ({
    data: { id: "p1", name: "Test school", code: "TEST", status: "active", application_open: true },
  }),
  getQuestionsByProgram: async () => ({ data: h.questions }),
  getResponseByEmailAndProgram: (email: string, programId: string) => h.byEmail(email, programId),
  getReferenceSlotsByProgram: async () => ({ data: [] }),
  createPublicResponse: (...args: unknown[]) => h.createPublicResponse(...args),
  createReferenceRequest: async () => ({ data: null }),
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
  resolveProgramEmail: async (_supabase: unknown, _programId: unknown, _key: unknown, defaults: { subject: string; html: string }) =>
    h.skipEmail ? { skip: true as const } : { skip: false as const, subject: defaults.subject, html: defaults.html },
}));
vi.mock("@/lib/email/templates/application-confirmation", () => ({
  applicationConfirmationEmailHtml: () => "<p>received</p>",
  applicationReferenceNotice: () => "",
}));
vi.mock("@/lib/email/send-reference-invite", () => ({ sendReferenceInvite: async () => ({ ok: false }) }));
vi.mock("@/lib/email/reference-email", () => ({ referenceSendConfirmed: () => false }));

import { POST } from "./route";

const systemOnly = [
  { id: "nat", label: "Nationality", type: "country", is_required: true, system_key: "nationality" },
  { id: "home", label: "Home Country", type: "country", is_required: true, system_key: "home_country" },
];

function submit(extra: Record<string, unknown> = {}) {
  return POST(
    new Request("https://hub.test/api/public/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        program_id: "0f7bf38e-ada3-4daa-8b22-69380934a1f7",
        answers: [],
        nationality: "South Africa",
        home_country: "South Africa",
        consent_version: "v1",
        ...extra,
      }),
    })
  );
}

describe("POST /api/public/applications identity", () => {
  beforeEach(() => {
    h.questions = systemOnly;
    h.skipEmail = false;
    h.createPublicResponse.mockReset();
    h.createPublicResponse.mockResolvedValue({
      data: { id: "app1", status_token: "tok", applicant_email: "ada@example.com" },
      error: null,
    });
    h.sendTransactional.mockReset();
    h.sendTransactional.mockResolvedValue({ ok: false, error: "resend down", suppressed: false });
    h.lookups = [];
    h.byEmail.mockClear();
    h.byEmail.mockResolvedValue({ data: null });
  });

  it("returns 400 and writes nothing when the school form has no name or email", async () => {
    const res = await submit();
    expect(res.status).toBe(400);
    expect(h.createPublicResponse).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toMatch(/first name/i);
    expect(JSON.stringify(body)).not.toContain("unknown@applicant.local");
  });

  it("returns 400 for a blank name, the word undefined, an invalid email, and the placeholder", async () => {
    expect((await submit({ first_name: "  ", last_name: "Lovelace", email: "ada@example.com" })).status).toBe(400);
    expect((await submit({ first_name: "undefined", last_name: "undefined", email: "ada@example.com" })).status).toBe(400);
    expect((await submit({ first_name: "Ada", last_name: "Lovelace", email: "not-an-email" })).status).toBe(400);
    expect((await submit({ first_name: "Ada", last_name: "Lovelace", email: "unknown@applicant.local" })).status).toBe(400);
    expect(h.createPublicResponse).not.toHaveBeenCalled();
  });

  it("saves the real name and email, and does not claim a confirmation that failed", async () => {
    const res = await submit({ first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confirmationEmailed).toBe(false);
    expect(body.confirmationStatus).toBe("failed");
    expect(h.sendTransactional).toHaveBeenCalledOnce();

    const payload = h.createPublicResponse.mock.calls[0][1] as {
      applicant_email: string;
      applicant_info: { first_name: string; last_name: string; email: string };
    };
    expect(payload.applicant_email).toBe("ada@example.com");
    expect(payload.applicant_info.first_name).toBe("Ada");
    expect(payload.applicant_info.last_name).toBe("Lovelace");
    expect(payload.applicant_info.email).toBe("ada@example.com");
    expect(JSON.stringify(payload)).not.toContain("unknown@applicant.local");
    expect(JSON.stringify(payload)).not.toMatch(/undefined/);
  });

  it("reports confirmationEmailed only when the send succeeds", async () => {
    h.sendTransactional.mockResolvedValue({ ok: true, id: "msg1" });
    const res = await submit({ first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" });
    const body = await res.json();
    expect(body.confirmationEmailed).toBe(true);
    expect(body.confirmationStatus).toBe("sent");
  });

  it("rejects * before either duplicate lookup, so the address cannot probe other rows", async () => {
    const res = await submit({ first_name: "Ada", last_name: "Lovelace", email: "a*@gmail.com" });
    expect(res.status).toBe(400);
    expect(h.createPublicResponse).not.toHaveBeenCalled();
    expect(h.byEmail).not.toHaveBeenCalled();
    expect(h.lookups.filter((lookup) => lookup.op === "ilike")).toEqual([]);
  });

  it("stores a lowercased email and looks up an existing user without LIKE wildcards", async () => {
    const res = await submit({ first_name: "Ada", last_name: "Lovelace", email: "Ada_Smith@Example.com" });
    expect(res.status).toBe(200);
    const payload = h.createPublicResponse.mock.calls[0][1] as { applicant_email: string };
    expect(payload.applicant_email).toBe("ada_smith@example.com");
    expect(h.lookups).toContainEqual({
      table: "users",
      op: "ilike",
      column: "email",
      value: "ada\\_smith@example.com",
    });
  });

  it("does not claim a confirmation when the school template is skipped", async () => {
    h.skipEmail = true;
    const res = await submit({ first_name: "Ada", last_name: "Lovelace", email: "ada@example.com" });
    const body = await res.json();
    expect(body.confirmationEmailed).toBe(false);
    expect(body.confirmationStatus).toBe("skipped");
    expect(h.sendTransactional).not.toHaveBeenCalled();
  });

  it("keeps a school's own name and email questions and does not require the built-in fields", async () => {
    h.questions = [
      ...systemOnly,
      { id: "q1", label: "First Name", type: "short_answer", is_required: true, system_key: null },
      { id: "q2", label: "Surname", type: "short_answer", is_required: true, system_key: null },
      { id: "q3", label: "Email address", type: "email", is_required: true, system_key: null },
    ];
    const res = await submit({
      answers: [
        { question_id: "q1", question_label: "First Name", answer: "Grace" },
        { question_id: "q2", question_label: "Surname", answer: "Hopper" },
        { question_id: "q3", question_label: "Email address", answer: "grace@example.com" },
      ],
    });
    expect(res.status).toBe(200);
    const payload = h.createPublicResponse.mock.calls[0][1] as { applicant_email: string; applicant_info: { first_name: string } };
    expect(payload.applicant_email).toBe("grace@example.com");
    expect(payload.applicant_info.first_name).toBe("Grace");
  });
});
