import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/lib/testing/fake-supabase";
import { STAFF_SELF_REFEREE_MESSAGE } from "@/lib/references/self-referee";

const sendReferenceInvite = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.user,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.admin,
}));
vi.mock("@/lib/api-auth", () => ({
  SCHOOLS_MANAGE_PERMS: ["schools.manage"],
  canManageSchools: async () => true,
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageProgram: async () => false,
}));
vi.mock("@/lib/auth/application-expiry", () => ({
  userCanReadApplication: async () => true,
  APPLICATIONS_EXPIRED_MESSAGE: "This school's applications are closed.",
}));
vi.mock("@/lib/email/send-reference-invite", () => ({
  sendReferenceInvite: (...args: unknown[]) => sendReferenceInvite(...args),
}));

const state = vi.hoisted(() => ({
  user: null as ReturnType<typeof createFakeSupabase>["client"] | null,
  admin: null as ReturnType<typeof createFakeSupabase>["client"] | null,
  queries: [] as FakeQuery[],
}));

function useAdmin() {
  const user = createFakeSupabase({ user: { id: "staff-1", email: "staff@example.com" } });
  const admin = createFakeSupabase({
    resolve: (q: FakeQuery) => {
      if (q.table === "reference_requests" && q.action === "select" && q.columns === "application_id") {
        return { data: { application_id: "app-1" } };
      }
      if (
        q.table === "reference_requests" &&
        q.action === "select" &&
        q.columns === "application_id, application_responses(program_id)"
      ) {
        return {
          data: { application_id: "app-1", application_responses: { program_id: "prog-1" } },
        };
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
              program_id: "prog-1",
              applicant_info: { first_name: "Ada", last_name: "Lovelace" },
              programs: { name: "DTS" },
              users: { first_name: "Ada", last_name: "Lovelace" },
            },
          },
        };
      }
      if (q.table === "application_responses" && q.action === "select") {
        return {
          data: {
            applicant_email: "applicant@example.com",
            applicant_info: { email: "info@example.com" },
            user_id: "user-1",
            users: { email: "user@example.com" },
          },
        };
      }
      if (q.action === "update") return { data: { id: "ref-1" } };
      return { data: null };
    },
  });
  admin.client.auth.admin = {
    getUserById: async () => ({
      data: { user: { email: "auth@example.com" } },
      error: null,
    }),
  };
  state.user = user.client;
  state.admin = admin.client;
  state.queries = admin.queries;
  return admin;
}

import { PATCH } from "./route";

function edit(email: string) {
  return PATCH(
    new Request("http://localhost/api/schools/applications/references", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reference_request_id: "ref-1",
        referee_name: "Pastor",
        referee_email: email,
      }),
    })
  );
}

describe("PATCH /api/schools/applications/references self-referee", () => {
  beforeEach(() => {
    useAdmin();
    sendReferenceInvite.mockReset();
    sendReferenceInvite.mockResolvedValue({ ok: true, id: "re_1" });
  });

  it.each([
    "applicant@example.com",
    "info@example.com",
    "user@example.com",
    "AUTH@example.com",
  ])("rejects %s with the staff wording and does not write or email", async (email) => {
    const admin = useAdmin();
    const res = await edit(email);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(STAFF_SELF_REFEREE_MESSAGE);
    expect(body.error).not.toMatch(/your own email/i);
    expect(sendReferenceInvite).not.toHaveBeenCalled();
    expect(admin.queries.filter((q) => q.action === "update")).toEqual([]);
  });

  it("still saves and resends a different email", async () => {
    const admin = useAdmin();
    const res = await edit("pastor@example.com");
    expect(res.status).toBe(200);
    expect(sendReferenceInvite).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: "pastor@example.com" })
    );
    expect(admin.queries.some((q) => q.action === "update" && q.table === "reference_requests")).toBe(
      true
    );
  });
});
