import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/lib/testing/fake-supabase";

// Archive, restore, and DELETE write with the service-role client, so the
// gate has to be the whole program check (312): named leaders and a
// program-scoped schools.* grant, not only the global role check.

const PROGRAM_A = "11111111-1111-4111-8111-111111111111";
const PROGRAM_B = "22222222-2222-4222-8222-222222222222";
const USER = "me";

const h = vi.hoisted(() => ({
  userClient: null as unknown,
  programId: "11111111-1111-4111-8111-111111111111",
  removed: 0,
  deleted: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => h.userClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      delete: () => {
        h.deleted += 1;
        return chain;
      },
      insert: async () => ({ error: null }),
      maybeSingle: async () => ({ data: { program_id: h.programId }, error: null }),
      single: async () => ({
        data: {
          id: "app1",
          status: "submitted",
          program_id: h.programId,
          applicant_email: "a@example.com",
          user_id: "student-1",
        },
        error: null,
      }),
      then: (onFulfilled: (v: { data: null; error: null }) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(onFulfilled),
    };
    return { from: () => chain };
  },
}));
vi.mock("@/services/schools", () => ({
  updateResponseStatus: async () => ({ data: null, error: null }),
  createResponse: async () => ({ data: null, error: null }),
  getReferenceSlotsByProgram: async () => ({ data: [] }),
  getQuestionsByProgram: async () => ({ data: [] }),
  createReferenceRequest: async () => ({ error: null }),
  setResponseRemoved: async () => {
    h.removed += 1;
    return { data: { id: "app1" }, error: null };
  },
  removeEnrollmentForApplicant: async () => {},
  ensureEnrollmentForApplicant: async () => ({ outcome: "enrolled" }),
}));
vi.mock("@/lib/auth/application-expiry", () => ({
  userCanReadApplication: async () => true,
  APPLICATIONS_EXPIRED_MESSAGE: "archived",
}));
vi.mock("@/lib/schools/demographics", () => ({ normaliseGender: () => null }));
vi.mock("@/lib/auth/membership-roles", () => ({
  ensureStudentRole: async () => {},
  deactivateMembershipProfile: async () => {},
}));
vi.mock("@/lib/email/send-transactional", () => ({ sendTransactional: async () => {} }));
vi.mock("@/lib/email/render-program-email", () => ({ resolveProgramEmail: async () => null }));
vi.mock("@/lib/email/send-reference-invite", () => ({ sendReferenceInvite: async () => {} }));
vi.mock("@/lib/email/send-reference-reminder", () => ({ sendReferenceReminder: async () => {} }));
vi.mock("@/lib/email/reference-email", () => ({ referenceSendConfirmed: () => false }));
vi.mock("@/lib/applications/sync-contact", () => ({ syncApplicantToContact: async () => {} }));
vi.mock("@/lib/email/templates/application-rejected", () => ({ applicationRejectedEmailHtml: () => "" }));
vi.mock("@/lib/email/templates/application-waitlisted", () => ({ applicationWaitlistedEmailHtml: () => "" }));
vi.mock("@/lib/email/templates/interview-scheduled", () => ({ interviewScheduledEmailHtml: () => "" }));

const route = await import("./route");

type RoleSeed = { name: string; scope_type: string | null; scope_id: string | null };
type PermSeed = { key: string; scope_type: string | null; scope_id: string | null };

function filterArg(q: FakeQuery, op: string, column: string): unknown {
  return q.filters.find((f) => f.op === op && f.args[0] === column)?.args[1];
}

function signIn(seed: { roles?: RoleSeed[]; perms?: PermSeed[]; leaderOf?: string[] }) {
  h.userClient = createFakeSupabase({
    user: { id: USER },
    resolve: (q) => {
      if (q.table === "user_roles") {
        return {
          data: (seed.roles ?? []).map((role) => ({
            scope_type: role.scope_type,
            scope_id: role.scope_id,
            roles: { name: role.name },
          })),
        };
      }
      if (q.table === "user_permissions") {
        let rows = seed.perms ?? [];
        if (q.filters.some((f) => f.op === "is" && f.args[0] === "scope_type" && f.args[1] === null)) {
          rows = rows.filter((perm) => perm.scope_type == null);
        }
        const scopeType = filterArg(q, "eq", "scope_type");
        if (typeof scopeType === "string") rows = rows.filter((perm) => perm.scope_type === scopeType);
        const scopeId = filterArg(q, "eq", "scope_id");
        if (typeof scopeId === "string") rows = rows.filter((perm) => perm.scope_id === scopeId);
        const keys = filterArg(q, "in", "permissions.key");
        if (Array.isArray(keys)) rows = rows.filter((perm) => keys.includes(perm.key));
        return { data: rows.map((perm) => ({ permissions: { key: perm.key } })) };
      }
      if (q.table === "program_leaders") {
        const programId = filterArg(q, "eq", "program_id");
        const hit = (seed.leaderOf ?? []).filter((id) => id === programId);
        return { data: hit.map((id) => ({ id })) };
      }
      return { data: [] };
    },
  }).client;
}

beforeEach(() => {
  h.programId = PROGRAM_A;
  h.removed = 0;
  h.deleted = 0;
  h.userClient = null;
});

function archive() {
  return route.PATCH(
    new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ action: "archive", id: "app1" }),
    })
  );
}

function remove() {
  return route.DELETE(
    new Request("http://x", { method: "DELETE", body: JSON.stringify({ id: "app1" }) })
  );
}

describe("archive and delete follow the whole program check", () => {
  it("lets a program_leaders row archive and delete that school's application", async () => {
    signIn({ leaderOf: [PROGRAM_A] });
    expect((await archive()).status).toBe(200);
    expect(h.removed).toBe(1);
    expect((await remove()).status).toBe(200);
    expect(h.deleted).toBe(1);
  });

  it("lets a program-scoped schools.* grant archive and delete", async () => {
    for (const key of ["schools.manage", "schools.approve_applications", "schools.manage_enrollments"]) {
      h.removed = 0;
      h.deleted = 0;
      signIn({ perms: [{ key, scope_type: "program", scope_id: PROGRAM_A }] });
      expect((await archive()).status, key).toBe(200);
      expect(h.removed, key).toBe(1);
      expect((await remove()).status, key).toBe(200);
      expect(h.deleted, key).toBe(1);
    }
  });

  it("refuses a program_leader scoped to another school", async () => {
    signIn({
      roles: [{ name: "program_leader", scope_type: "program", scope_id: PROGRAM_B }],
    });
    expect((await archive()).status).toBe(403);
    expect(h.removed).toBe(0);
    expect((await remove()).status).toBe(403);
    expect(h.deleted).toBe(0);
  });
});
