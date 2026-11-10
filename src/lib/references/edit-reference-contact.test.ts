import { beforeEach, describe, expect, it, vi } from "vitest";
import { editReferenceContact } from "./edit-reference-contact";

const sendReferenceInvite = vi.hoisted(() => vi.fn());

vi.mock("@/lib/email/send-reference-invite", () => ({
  sendReferenceInvite: (...args: unknown[]) => sendReferenceInvite(...args),
}));

function ref() {
  return {
    id: "ref-1",
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

function admin() {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    client: {
      from() {
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
});
