import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/lib/testing/fake-supabase";
import { REFEREE_CHECK_FAILED, SELF_REFEREE_MESSAGE } from "@/lib/references/self-referee";

const h = vi.hoisted(() => ({
  createReferenceRequest: vi.fn(),
  sendReferenceInvite: vi.fn(),
  authEmail: "auth@example.com",
  lookupError: null as string | null,
}));

const state = vi.hoisted(() => ({
  client: null as ReturnType<typeof createFakeSupabase>["client"] | null,
}));

function admin() {
  const fake = createFakeSupabase({
    resolve: (q: FakeQuery) => {
      if (q.table === "application_responses") {
        if (h.lookupError && (q.columns ?? "").includes("users!")) {
          return { data: null, error: { message: h.lookupError } };
        }
        return {
          data: {
            id: "app-1",
            program_id: "prog-1",
            status_token: "status-1",
            applicant_email: "applicant@example.com",
            applicant_info: { email: "info@example.com", first_name: "Ada", last_name: "Lovelace" },
            user_id: "user-1",
            users: { email: "user@example.com" },
            programs: { name: "DTS" },
          },
        };
      }
      if (q.table === "reference_slots") {
        return { data: { id: "slot-1", label: "Pastoral Reference", program_id: "prog-1" } };
      }
      if (q.table === "reference_requests") return { data: null };
      return { data: null };
    },
  });
  fake.client.auth.admin = {
    getUserById: async () => ({
      data: { user: { email: h.authEmail } },
      error: null,
    }),
  };
  state.client = fake.client;
  return fake;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.client,
}));
vi.mock("@/services/schools", () => ({
  createReferenceRequest: (...args: unknown[]) => h.createReferenceRequest(...args),
}));
vi.mock("@/lib/email/send-reference-invite", () => ({
  sendReferenceInvite: (...args: unknown[]) => h.sendReferenceInvite(...args),
}));
vi.mock("@/lib/email/reference-email", () => ({
  referenceSendConfirmed: (sent: { ok?: boolean; id?: string | null }) => sent?.ok === true && !!sent.id,
}));

import { POST } from "./route";

function add(email: string) {
  return POST(
    new Request("http://localhost/api/public/references/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status_token: "status-1",
        slot_id: "slot-1",
        referee_name: "Referee",
        referee_email: email,
      }),
    })
  );
}

describe("POST /api/public/references/add self-referee", () => {
  beforeEach(() => {
    h.authEmail = "auth@example.com";
    h.lookupError = null;
    admin();
    h.createReferenceRequest.mockReset();
    h.createReferenceRequest.mockResolvedValue({
      data: { id: "ref-1", token: "invite", status: "pending" },
      error: null,
    });
    h.sendReferenceInvite.mockReset();
    h.sendReferenceInvite.mockResolvedValue({ ok: true, id: "re_1" });
  });

  it.each([
    ["applicant@example.com", "applicant_email"],
    [" Info@Example.com ", "applicant_info.email"],
    ["user@example.com", "users.email"],
    ["auth@example.com", "auth email"],
  ])("rejects %s (%s) before insert or invite", async (email) => {
    const res = await add(email);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(SELF_REFEREE_MESSAGE);
    expect(h.createReferenceRequest).not.toHaveBeenCalled();
    expect(h.sendReferenceInvite).not.toHaveBeenCalled();
  });

  it("still saves and emails a different address", async () => {
    const res = await add("ada+ref@example.com");
    expect(res.status).toBe(200);
    expect(h.createReferenceRequest).toHaveBeenCalledOnce();
    expect(h.sendReferenceInvite).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: "ada+ref@example.com" })
    );
  });

  it("hides a database error from the applicant email lookup", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.lookupError = "permission denied for table application_responses";
    const res = await add("pastor@example.com");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe(REFEREE_CHECK_FAILED);
    expect(JSON.stringify(body)).not.toContain("permission denied");
    expect(h.createReferenceRequest).not.toHaveBeenCalled();
    expect(h.sendReferenceInvite).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "[references/add] applicant email lookup failed",
      "permission denied for table application_responses"
    );
    errorSpy.mockRestore();
  });
});
