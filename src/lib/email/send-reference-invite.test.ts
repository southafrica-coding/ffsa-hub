import { beforeEach, describe, expect, it, vi } from "vitest";

const sendTransactional = vi.hoisted(() => vi.fn());
const resolveProgramEmailMock = vi.hoisted(() => vi.fn());
const identity = vi.hoisted(() => ({ reply_to: "training@ffsahub.com" as string | null }));

vi.mock("./send-transactional", () => ({
  sendTransactional: (...args: unknown[]) => sendTransactional(...args),
}));
vi.mock("./render-program-email", () => ({
  resolveProgramEmail: (...args: unknown[]) => resolveProgramEmailMock(...args),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: { reply_to: identity.reply_to } }),
      };
      return b;
    },
  }),
}));

import { sendReferenceInvite } from "./send-reference-invite";
import { sendReferenceReminder } from "./send-reference-reminder";

describe("sendReferenceInvite", () => {
  beforeEach(() => {
    sendTransactional.mockReset();
    resolveProgramEmailMock.mockReset();
    identity.reply_to = "training@ffsahub.com";
    sendTransactional.mockResolvedValue({ ok: true, id: "re_abc" });
    resolveProgramEmailMock.mockImplementation(
      async (
        _admin: unknown,
        _id: unknown,
        _type: unknown,
        defaults: { subject: string; html: string }
      ) => ({
        skip: false,
        subject: defaults.subject,
        html: defaults.html,
      })
    );
  });

  it("sends a text part, the training reply-to, and the new subject", async () => {
    const result = await sendReferenceInvite({
      toEmail: "ada@example.com",
      refereeName: "Ada",
      applicantName: "Sam Lee",
      programName: "DTS",
      slotLabel: "Pastor",
      token: "tok-1",
      programId: "prog-1",
      referenceRequestId: "ref-1",
    });

    expect(result).toEqual({ ok: true, id: "re_abc" });
    expect(resolveProgramEmailMock).toHaveBeenCalledWith(
      expect.anything(),
      "prog-1",
      "reference_request",
      expect.objectContaining({
        subject: "Sam Lee asked you to give a reference for DTS",
      }),
      expect.anything()
    );
    const payload = sendTransactional.mock.calls[0][0];
    expect(payload.subject).toBe("Sam Lee asked you to give a reference for DTS");
    expect(payload.replyTo).toBe("training@ffsahub.com");
    expect(payload.text).toContain("Sam Lee");
    expect(payload.text).toContain("DTS");
    expect(payload.text).toContain("/reference/tok-1");
    expect(payload.text.toLowerCase()).toMatch(/how you know them/);
    expect(payload.html).toContain("/reference/tok-1");
    expect(payload.sourceId).toBe("ref-1");
    expect(payload.category).toBe("reference_request");
    expect(payload.fromEmail).toBeUndefined();
  });

  it("keeps a custom template subject", async () => {
    resolveProgramEmailMock.mockResolvedValue({
      skip: false,
      subject: "A note for Sam",
      html: "<p>custom</p>",
    });
    await sendReferenceInvite({
      toEmail: "ada@example.com",
      refereeName: "Ada",
      applicantName: "Sam Lee",
      programName: "DTS",
      slotLabel: "Pastor",
      token: "tok-1",
      programId: "prog-1",
    });
    expect(sendTransactional.mock.calls[0][0].subject).toBe("A note for Sam");
    expect(sendTransactional.mock.calls[0][0].text).toContain("/reference/tok-1");
  });

  it("sends the reminder with a text part and the same reply-to", async () => {
    await sendReferenceReminder({
      toEmail: "ada@example.com",
      refereeName: "Ada",
      applicantName: "Sam Lee",
      programName: "DTS",
      slotLabel: "Pastor",
      token: "tok-1",
      programId: "prog-1",
      referenceRequestId: "ref-1",
    });
    const payload = sendTransactional.mock.calls[0][0];
    expect(payload.category).toBe("reference_reminder");
    expect(payload.subject).toBe("Reference Reminder — DTS");
    expect(payload.replyTo).toBe("training@ffsahub.com");
    expect(payload.text).toContain("Sam Lee");
    expect(payload.text).toContain("DTS");
    expect(payload.text).toContain("/reference/tok-1");
    expect(payload.sourceId).toBe("ref-1");
  });
});
