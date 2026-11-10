import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  canRead: true,
  canManage: true,
  sent: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          const result =
            table === "application_responses"
              ? {
                  data: {
                    id: "app1",
                    program_id: "p1",
                    status: "submitted",
                    status_token: "tok",
                    applicant_email: "a@example.com",
                    applicant_info: { first_name: "Ada" },
                    programs: { name: "SBI" },
                  },
                  error: null,
                }
              : { data: [], error: null };
          return Object.assign(Promise.resolve(result), {
            single: async () => result,
          });
        },
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));
vi.mock("@/lib/auth/application-expiry", () => ({
  userCanReadApplication: async () => h.canRead,
  passesApplicationExpiry: async () => true,
  APPLICATIONS_EXPIRED_MESSAGE: "archived",
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageProgram: async () => h.canManage,
}));
vi.mock("@/services/schools", () => ({
  getReferenceSlotsByProgram: async () => ({
    data: [{ id: "slot", label: "Pastor", is_required: true }],
  }),
}));
vi.mock("@/lib/email/send-applicant-reference-request", () => ({
  sendApplicantReferenceRequest: async () => {
    h.sent += 1;
  },
}));

const route = await import("./route");

beforeEach(() => {
  h.canRead = true;
  h.canManage = true;
  h.sent = 0;
});

function post() {
  return route.POST(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ application_id: "app1" }),
    })
  );
}

describe("request references for one application", () => {
  it("lets a manager send the email", async () => {
    expect((await post()).status).toBe(200);
    expect(h.sent).toBe(1);
  });

  it("refuses program staff before any email is sent", async () => {
    h.canManage = false;
    expect((await post()).status).toBe(403);
    expect(h.sent).toBe(0);
  });
});
