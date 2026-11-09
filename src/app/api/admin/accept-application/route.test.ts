import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  email: "Ada_Smith@Example.com",
  filters: [] as Array<{ table: string; op: string; column: string; value: unknown }>,
}));

function builder(table: string) {
  const b: Record<string, unknown> = {};
  const self = () => b;
  b.select = self;
  b.insert = self;
  b.update = self;
  b.delete = self;
  b.eq = (column: string, value: unknown) => {
    h.filters.push({ table, op: "eq", column, value });
    return b;
  };
  b.ilike = (column: string, value: unknown) => {
    h.filters.push({ table, op: "ilike", column, value });
    return b;
  };
  b.single = async () => {
    if (table === "application_responses") {
      return {
        data: {
          id: "app1",
          user_id: null,
          status: "submitted",
          program_id: "p1",
          applicant_email: h.email,
          applicant_info: { first_name: "Ada", last_name: "Smith" },
          programs: {
            id: "p1",
            name: "Test",
            code: "T",
            acceptance_email_subject: null,
            acceptance_email_body: null,
          },
        },
        error: null,
      };
    }
    if (table === "enrollments") return { data: { id: "enr-1" }, error: null };
    return { data: null, error: null };
  };
  b.maybeSingle = async () => {
    if (table === "users") return { data: { id: "user-1", first_name: "Ada" }, error: null };
    return { data: null, error: null };
  };
  b.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
}));
vi.mock("@/lib/auth/check-schools-access", () => ({ userCanManageProgram: async () => true }));
vi.mock("@/lib/auth/application-expiry", () => ({
  userCanReadApplication: async () => true,
  APPLICATIONS_EXPIRED_MESSAGE: "expired",
}));
vi.mock("@/lib/auth/membership-roles", () => ({ ensureStudentRole: async () => {} }));
vi.mock("@/lib/auth/onboarding-invite", () => ({ createOnboardingInvite: async () => ({}) }));
vi.mock("@/lib/schools/setup-invite-schedule", () => ({
  resolveSetupInviteDueDate: async () => null,
  formatInviteDate: () => "",
}));
vi.mock("@/services/billing-generation", () => ({
  setupProgramBillingOnAcceptance: async () => ({ ok: true }),
}));
vi.mock("@/lib/email/send-transactional", () => ({
  sendTransactional: async () => ({ ok: true, id: "msg" }),
}));

import { POST } from "./route";

function post() {
  return POST(
    new Request("https://hub.test/api/admin/accept-application", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_id: "app1" }),
    })
  );
}

describe("POST /api/admin/accept-application email match", () => {
  beforeEach(() => {
    h.email = "Ada_Smith@Example.com";
    h.filters = [];
  });

  it("matches an existing user with an escaped case-insensitive email", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.filters).toContainEqual({
      table: "users",
      op: "ilike",
      column: "email",
      value: "ada\\_smith@example.com",
    });
    expect(h.filters.some((f) => f.table === "users" && f.op === "eq" && f.column === "email")).toBe(false);
  });

  it("rejects * before the user lookup and does not accept the application", async () => {
    h.email = "a*@gmail.com";
    const res = await post();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This applicant's email can't be matched safely." });
    expect(h.filters.some((f) => f.table === "users")).toBe(false);
    expect(h.filters.some((f) => f.op === "ilike")).toBe(false);
  });
});
