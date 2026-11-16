import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/lib/testing/fake-supabase";
import { SELF_REFEREE_MESSAGE } from "@/lib/references/self-referee";

const sendReferenceInvite = vi.hoisted(() => vi.fn());

vi.mock("@/lib/email/send-reference-invite", () => ({
  sendReferenceInvite: (...args: unknown[]) => sendReferenceInvite(...args),
}));

const state = vi.hoisted(() => ({
  client: null as ReturnType<typeof createFakeSupabase>["client"] | null,
  authEmail: "auth@example.com",
}));

function admin() {
  const fake = createFakeSupabase({
    resolve: (q: FakeQuery) => {
      if (q.table === "application_responses" && q.action === "select") {
        return {
          data: {
            id: "app-1",
            applicant_email: "applicant@example.com",
            applicant_info: { email: "info@example.com", first_name: "Ada", last_name: "Lovelace" },
            user_id: "user-1",
            users: { email: "user@example.com" },
          },
        };
      }
      if (q.table === "reference_requests" && q.action === "select" && q.columns === "application_id") {
        return { data: { application_id: "app-1" } };
      }
      if (q.table === "reference_requests" && q.action === "select") {
        return {
          data: {
            id: "ref-1",
            application_id: "app-1",
            status: "pending",
            token: "old-token",
            referee_name: "Pastor",
            referee_email: "old@example.com",
            reference_slots: { label: "Pastoral Reference" },
            application_responses: {
              status_token: "status-1",
              program_id: "prog-1",
              applicant_info: { first_name: "Ada", last_name: "Lovelace" },
              programs: { name: "DTS" },
              users: { first_name: "Ada", last_name: "Lovelace" },
            },
          },
        };
      }
      if (q.action === "update") return { data: { id: "ref-1" } };
      return { data: null };
    },
  });
  fake.client.auth.admin = {
    getUserById: async () => ({
      data: { user: { email: state.authEmail } },
      error: null,
    }),
  };
  state.client = fake.client;
  return fake;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.client,
}));

import { PATCH } from "./route";

function edit(email: string) {
  return PATCH(
    new Request("http://localhost/api/public/references", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status_token: "status-1",
        reference_request_id: "ref-1",
        referee_name: "Pastor",
        referee_email: email,
      }),
    })
  );
}

describe("PATCH /api/public/references self-referee", () => {
  beforeEach(() => {
    state.authEmail = "auth@example.com";
    admin();
    sendReferenceInvite.mockReset();
    sendReferenceInvite.mockResolvedValue({ ok: true, id: "re_1" });
  });

  it.each([
    "applicant@example.com",
    "info@example.com",
    "user@example.com",
    "AUTH@example.com",
  ])("rejects %s before update or a resend", async (email) => {
    const fake = admin();
    state.client = fake.client;
    const res = await edit(email);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(SELF_REFEREE_MESSAGE);
    expect(sendReferenceInvite).not.toHaveBeenCalled();
    expect(fake.queries.filter((q) => q.action === "update")).toEqual([]);
  });

  it("still saves and resends a different email", async () => {
    const fake = admin();
    state.client = fake.client;
    const res = await edit("pastor@example.com");
    expect(res.status).toBe(200);
    expect(sendReferenceInvite).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: "pastor@example.com" })
    );
    expect(fake.queries.some((q) => q.action === "update" && q.table === "reference_requests")).toBe(
      true
    );
  });
});
