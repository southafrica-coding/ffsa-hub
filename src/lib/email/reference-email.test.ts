import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  referenceInviteSubject,
  referenceReminderEmailText,
  referenceRequestEmailText,
  referenceSendConfirmed,
  resolveReferenceReplyTo,
  usableReplyTo,
} from "./reference-email";
import { resolveProgramEmail } from "./render-program-email";

describe("referenceInviteSubject", () => {
  it("names the applicant and the program", () => {
    expect(referenceInviteSubject("Sam Lee", "DTS")).toBe(
      "Sam Lee asked you to give a reference for DTS"
    );
  });

  it("handles a missing or generic name", () => {
    expect(referenceInviteSubject("", "DTS")).toBe(
      "You've been asked to give a reference for DTS"
    );
    expect(referenceInviteSubject("   ", "SBI")).toBe(
      "You've been asked to give a reference for SBI"
    );
    expect(referenceInviteSubject("the applicant", "SBI")).toBe(
      "You've been asked to give a reference for SBI"
    );
    expect(referenceInviteSubject("An applicant", null)).toBe(
      "You've been asked to give a reference for the program"
    );
  });
});

describe("reference plain text", () => {
  const url = "https://ffsahub.com/reference/tok-1";

  it("mirrors the invite: who asked, the program, the link, and what a reference is", () => {
    const text = referenceRequestEmailText({
      refereeName: "Ada",
      applicantName: "Sam Lee",
      programName: "DTS",
      slotLabel: "Pastor",
      referenceUrl: url,
    });
    expect(text).toContain("Sam Lee");
    expect(text).toContain("DTS");
    expect(text).toContain("Pastor");
    expect(text).toContain(url);
    expect(text.toLowerCase()).toContain("reference");
    expect(text.toLowerCase()).toMatch(/how you know them|recommend/);
  });

  it("gives the reminder the same facts", () => {
    const text = referenceReminderEmailText({
      refereeName: "Ada",
      applicantName: "Sam Lee",
      programName: "DTS",
      slotLabel: "Pastor",
      referenceUrl: url,
    });
    expect(text).toContain("Reminder");
    expect(text).toContain("Sam Lee");
    expect(text).toContain("DTS");
    expect(text).toContain(url);
    expect(text.toLowerCase()).toMatch(/how you know them|recommend/);
  });
});

describe("reply-to", () => {
  const prev = process.env.REFERENCE_REPLY_TO;

  beforeEach(() => {
    delete process.env.REFERENCE_REPLY_TO;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.REFERENCE_REPLY_TO;
    else process.env.REFERENCE_REPLY_TO = prev;
  });

  function admin(replyTo: string | null | undefined, found = true) {
    return {
      from() {
        const b = {
          select: () => b,
          eq: () => b,
          maybeSingle: async () => ({
            data: found ? { reply_to: replyTo ?? null } : null,
          }),
        };
        return b;
      },
    };
  }

  it("uses the training identity reply-to", async () => {
    const reply = await resolveReferenceReplyTo(admin("training@ffsahub.com"));
    expect(reply).toBe("training@ffsahub.com");
  });

  it("skips noreply and uses REFERENCE_REPLY_TO", async () => {
    process.env.REFERENCE_REPLY_TO = "schools@ffsouthafrica.com";
    const reply = await resolveReferenceReplyTo(admin("noreply@ffsahub.com"));
    expect(reply).toBe("schools@ffsouthafrica.com");
  });

  it("uses the env var when the identity has no reply-to", async () => {
    process.env.REFERENCE_REPLY_TO = "training-office@ffsouthafrica.com";
    expect(await resolveReferenceReplyTo(admin(null, false))).toBe(
      "training-office@ffsouthafrica.com"
    );
  });

  it("sends no reply-to rather than noreply@", async () => {
    process.env.REFERENCE_REPLY_TO = "noreply@ffsahub.com";
    expect(await resolveReferenceReplyTo(admin(null, false))).toBeNull();
    expect(usableReplyTo("noreply@ffsahub.com")).toBeNull();
    expect(await resolveReferenceReplyTo(admin("  ", false))).toBeNull();
  });
});

describe("referenceSendConfirmed", () => {
  it("requires a provider message id", () => {
    expect(referenceSendConfirmed({ ok: true, id: "re_123" })).toBe(true);
    expect(referenceSendConfirmed({ ok: true, id: null })).toBe(false);
    expect(referenceSendConfirmed({ ok: true, id: "" })).toBe(false);
    expect(referenceSendConfirmed({ ok: false, id: "re_123" })).toBe(false);
  });
});

describe("resolveProgramEmail subject", () => {
  function client(row: { enabled: boolean; subject: string | null; body: string | null } | null) {
    return {
      from() {
        const b = {
          select: () => b,
          eq: () => b,
          maybeSingle: async () => ({ data: row }),
        };
        return b;
      },
    };
  }

  const defaults = {
    subject: "Sam Lee asked you to give a reference for DTS",
    html: "<p>default</p>",
  };

  it("keeps a program's custom subject", async () => {
    const resolved = await resolveProgramEmail(
      client({ enabled: true, subject: "Please write for {{applicant_name}}", body: "Custom body" }),
      "prog-1",
      "reference_request",
      defaults,
      { values: { applicant_name: "Sam Lee", program_name: "DTS" } }
    );
    expect(resolved).toMatchObject({
      skip: false,
      subject: "Please write for Sam Lee",
    });
  });

  it("keeps the caller subject when only the body is customized", async () => {
    const resolved = await resolveProgramEmail(
      client({ enabled: true, subject: null, body: "Just the body" }),
      "prog-1",
      "reference_request",
      defaults,
      { values: { applicant_name: "Sam Lee", program_name: "DTS" } }
    );
    expect(resolved).toMatchObject({ skip: false, subject: defaults.subject });
  });
});
