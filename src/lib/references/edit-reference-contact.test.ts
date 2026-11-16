import { beforeEach, describe, expect, it, vi } from "vitest";
import { editReferenceContact } from "./edit-reference-contact";
import { SELF_REFEREE_MESSAGE } from "./self-referee";

const sendReferenceInvite = vi.hoisted(() => vi.fn());

vi.mock("@/lib/email/send-reference-invite", () => ({
  sendReferenceInvite: (...args: unknown[]) => sendReferenceInvite(...args),
}));

function ref() {
  return {
    id: "ref-1",
    application_id: "app-1",
    status: "pending",
    token: "old-token",
    referee_name: "Ada",
    referee_email: "old@example.com",
    reference_slots: { label: "Pastor" },
    application_responses: {
      program_id: "prog-1",
      status_token: "status-1",
      programs: { name: "DTS" },
      applicant_info: { first_name: "Sam", last_name: "Lee" },
      users: null,
    },
  };
}

function admin(opts?: { applicantEmail?: string | null; authEmail?: string | null }) {
  const applicantEmail = opts?.applicantEmail ?? null;
  const authEmail = opts?.authEmail ?? null;
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    client: {
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: authEmail } },
            error: null,
          }),
        },
      },
      from(table: string) {
        const state: { patch: Record<string, unknown> | null } = { patch: null };
        const b: Record<string, unknown> = {
          update(patch: Record<string, unknown>) {
            state.patch = patch;
            return b;
          },
          eq() {
            return b;
          },
          select() {
            return b;
          },
          maybeSingle: async () => {
            if (table === "reference_requests") {
              return { data: { application_id: "app-1" }, error: null };
            }
            if (table === "application_responses") {
              return {
                data: {
                  applicant_email: applicantEmail,
                  applicant_info: null,
                  user_id: authEmail ? "user-1" : null,
                  users: null,
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
          single: async () => {
            updates.push(state.patch ?? {});
            return { data: { id: "ref-1", ...(state.patch ?? {}) }, error: null };
          },
          then(resolve: (v: unknown) => void) {
            updates.push(state.patch ?? {});
            resolve({ data: null, error: null });
          },
        };
        return b;
      },
    },
  };
}

describe("editReferenceContact", () => {
  beforeEach(() => {
    sendReferenceInvite.mockReset();
  });

  it("passes programId and only marks emailed when the provider returns an id", async () => {
    sendReferenceInvite.mockResolvedValue({ ok: true, id: "re_123" });
    const db = admin();
    const result = await editReferenceContact(db.client, ref(), {
      referee_name: "Ada",
      referee_email: "fixed@example.com",
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.emailed).toBe(true);
    expect(sendReferenceInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        programId: "prog-1",
        referenceRequestId: "ref-1",
        toEmail: "fixed@example.com",
        programName: "DTS",
      })
    );
    expect(db.updates.some((u) => typeof u.email_sent_at === "string" && u.email_sent_at.length > 0)).toBe(
      true
    );
  });

  it("does not mark emailed when the send reports success without an id", async () => {
    sendReferenceInvite.mockResolvedValue({ ok: true, id: null });
    const db = admin();
    const result = await editReferenceContact(db.client, ref(), {
      referee_email: "fixed@example.com",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.emailed).toBe(false);
      expect(result.emailChanged).toBe(true);
    }
    expect(db.updates.some((u) => u.email_sent_at)).toBe(false);
  });

  it("does not throw when the send reports failure", async () => {
    sendReferenceInvite.mockResolvedValue({
      ok: false,
      error: "Recipient is on the suppression list (hard_bounce)",
      suppressed: true,
    });
    const db = admin();
    const result = await editReferenceContact(db.client, ref(), {
      referee_email: "fixed@example.com",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.emailed).toBe(false);
    expect(db.updates.some((u) => u.email_sent_at)).toBe(false);
  });

  it("does not throw when the send throws", async () => {
    sendReferenceInvite.mockRejectedValue(new Error("network"));
    const db = admin();
    const result = await editReferenceContact(db.client, ref(), {
      referee_email: "fixed@example.com",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.emailed).toBe(false);
  });

  it("rejects the applicant's own email before updating or resending the invite", async () => {
    const db = admin({ applicantEmail: "ada@example.com" });
    const result = await editReferenceContact(db.client, ref(), {
      referee_name: "Ada",
      referee_email: " Ada@Example.com ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe(SELF_REFEREE_MESSAGE);
    }
    expect(sendReferenceInvite).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it("rejects the linked account email before updating or resending the invite", async () => {
    const db = admin({ authEmail: "auth@example.com" });
    const result = await editReferenceContact(db.client, ref(), {
      referee_email: "AUTH@example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(sendReferenceInvite).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it("still updates and emails a referee address that is not the applicant's", async () => {
    sendReferenceInvite.mockResolvedValue({ ok: true, id: "re_ok" });
    const db = admin({ applicantEmail: "ada@example.com", authEmail: "auth@example.com" });
    const result = await editReferenceContact(db.client, ref(), {
      referee_email: "pastor@example.com",
    });
    expect(result.ok).toBe(true);
    expect(sendReferenceInvite).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: "pastor@example.com" })
    );
    expect(db.updates.some((u) => u.referee_email === "pastor@example.com")).toBe(true);
  });
});
