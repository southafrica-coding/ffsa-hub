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
  canRead: true as boolean | "throw",
  expiry: {
    endDate: null as string | null,
    expiresOn: null as string | null,
    expired: false,
    canAccess: false,
    lookupFailed: false,
  },
  archived:
    "Applications for this school have been archived. Contact the Training team for access.",
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
  userCanReadApplication: async () => {
    if (h.canRead === "throw") throw new Error("read failed");
    return h.canRead;
  },
  APPLICATIONS_EXPIRED_MESSAGE: h.archived,
  getApplicationExpiry: async () => h.expiry,
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

type RoleSeed = {
  id?: string;
  name: string;
  scope_type: string | null;
  scope_id: string | null;
};
type PermSeed = { key: string; scope_type: string | null; scope_id: string | null };
type BundleSeed = { role_id: string; key: string };

function filterArg(q: FakeQuery, op: string, column: string): unknown {
  return q.filters.find((f) => f.op === op && f.args[0] === column)?.args[1];
}

function signIn(seed: {
  roles?: RoleSeed[];
  perms?: PermSeed[];
  leaderOf?: string[];
  bundles?: BundleSeed[];
  /** undefined counts as active (is_active IS NOT FALSE). */
  active?: boolean | null;
}) {
  h.userClient = createFakeSupabase({
    user: { id: USER },
    resolve: (q) => {
      if (q.table === "user_roles") {
        return {
          data: (seed.roles ?? []).map((role) => ({
            role_id: role.id ?? "role",
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
        return {
          data: rows.map((perm) => ({
            scope_type: perm.scope_type,
            scope_id: perm.scope_id,
            permissions: { key: perm.key },
          })),
        };
      }
      if (q.table === "role_permissions") {
        let rows = seed.bundles ?? [];
        const roleIds = filterArg(q, "in", "role_id");
        const keys = filterArg(q, "in", "permissions.key");
        if (Array.isArray(roleIds)) rows = rows.filter((row) => roleIds.includes(row.role_id));
        if (Array.isArray(keys)) rows = rows.filter((row) => keys.includes(row.key));
        return { data: rows.map((row) => ({ permissions: { key: row.key } })) };
      }
      if (q.table === "users") {
        return { data: [{ id: USER, is_active: seed.active === undefined ? true : seed.active }] };
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
  h.canRead = true;
  h.expiry = {
    endDate: null,
    expiresOn: null,
    expired: false,
    canAccess: false,
    lookupFailed: false,
  };
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

const leaderBundle = [{ role_id: "r-pl", key: "schools.manage" }];

function programLeader(scopeType: string | null, scopeId: string | null): RoleSeed {
  return { id: "r-pl", name: "program_leader", scope_type: scopeType, scope_id: scopeId };
}

describe("archive stays on the program check; delete follows the DELETE policy", () => {
  it("lets a program_leaders row archive, and refuses the permanent delete", async () => {
    signIn({ leaderOf: [PROGRAM_A] });
    expect((await archive()).status).toBe(200);
    expect(h.removed).toBe(1);
    expect((await remove()).status).toBe(403);
    expect(h.deleted).toBe(0);
  });

  it("lets a grant delete only when the read check says this application is in reach", async () => {
    const grants: PermSeed[] = [
      { key: "schools.manage", scope_type: null, scope_id: null },
      { key: "schools.approve_applications", scope_type: null, scope_id: null },
      { key: "schools.manage", scope_type: "program", scope_id: PROGRAM_A },
      { key: "schools.approve_applications", scope_type: "program", scope_id: PROGRAM_A },
      { key: "schools.manage", scope_type: "team", scope_id: "team-1" },
      { key: "schools.approve_applications", scope_type: "event", scope_id: "event-1" },
    ];
    for (const perm of grants) {
      h.removed = 0;
      h.deleted = 0;
      signIn({ perms: [perm] });
      const label = `${perm.key} ${perm.scope_type ?? "null"}`;
      const inThisSchool = perm.scope_type == null || perm.scope_id === PROGRAM_A;
      h.canRead = true;
      expect((await archive()).status, label).toBe(inThisSchool ? 200 : 403);
      const deleted = await remove();
      expect(deleted.status, label).toBe(inThisSchool ? 200 : 403);
      if (!inThisSchool) {
        expect(await deleted.json(), label).toEqual({ error: "Forbidden" });
      }
      expect(h.deleted, label).toBe(inThisSchool ? 1 : 0);
    }
  });

  it("denies a team- or event-scoped role bundle even when the read check passes", async () => {
    h.canRead = true;
    for (const key of ["schools.manage", "schools.approve_applications"] as const) {
      for (const scopeType of ["team", "event"] as const) {
        h.deleted = 0;
        signIn({
          roles: [{ id: "r-scope", name: "staff", scope_type: scopeType, scope_id: `${scopeType}-1` }],
          bundles: [{ role_id: "r-scope", key }],
        });
        const res = await remove();
        expect(res.status, `${scopeType} ${key}`).toBe(403);
        expect(await res.json(), `${scopeType} ${key}`).toEqual({ error: "Forbidden" });
        expect(h.deleted, `${scopeType} ${key}`).toBe(0);
      }
    }
  });

  it("lets an unscoped admin or super_admin delete", async () => {
    for (const name of ["admin", "super_admin"]) {
      h.deleted = 0;
      signIn({ roles: [{ name, scope_type: null, scope_id: null }] });
      expect((await remove()).status, name).toBe(200);
      expect(h.deleted, name).toBe(1);
    }
  });

  it("lets a program_leader delete only the school the read check can see", async () => {
    const scopes: Array<[string | null, string | null]> = [
      [null, null],
      ["program", PROGRAM_A],
      ["program", PROGRAM_B],
      ["team", "team-1"],
      ["event", "event-1"],
    ];
    for (const [scopeType, scopeId] of scopes) {
      h.removed = 0;
      h.deleted = 0;
      const inThisSchool = scopeType == null || scopeId === PROGRAM_A;
      h.canRead = true;
      signIn({ roles: [programLeader(scopeType, scopeId)], bundles: leaderBundle });
      const label = `${scopeType ?? "null"}:${scopeId ?? "null"}`;
      expect((await archive()).status, label).toBe(inThisSchool ? 200 : 403);
      const deleted = await remove();
      expect(deleted.status, label).toBe(inThisSchool ? 200 : 403);
      if (!inThisSchool) {
        expect(await deleted.json(), label).toEqual({ error: "Forbidden" });
      }
      expect(h.deleted, label).toBe(inThisSchool ? 1 : 0);
    }
  });

  it("does not delete when the read check is false or throws", async () => {
    signIn({ roles: [{ name: "admin", scope_type: null, scope_id: null }] });
    h.canRead = false;
    const missed = await remove();
    expect(missed.status).toBe(403);
    expect(await missed.json()).toEqual({ error: "Forbidden" });
    expect(h.deleted).toBe(0);

    h.canRead = "throw";
    const thrown = await remove();
    expect(thrown.status).toBe(403);
    expect(await thrown.json()).toEqual({ error: "Forbidden" });
    expect(h.deleted).toBe(0);
  });

  it("refuses a school-A grant deleting a school-B application when the read check fails", async () => {
    h.programId = PROGRAM_B;
    h.canRead = false;
    for (const key of ["schools.manage", "schools.approve_applications"] as const) {
      h.deleted = 0;
      signIn({ perms: [{ key, scope_type: "program", scope_id: PROGRAM_A }] });
      const res = await remove();
      expect(res.status, key).toBe(403);
      expect(await res.json(), key).toEqual({ error: "Forbidden" });
      expect(h.deleted, key).toBe(0);
    }
  });

  it("denies a school-A grant on a school-B application even when the caller is the applicant", async () => {
    h.programId = PROGRAM_B;
    h.canRead = true;
    for (const key of ["schools.manage", "schools.approve_applications"] as const) {
      h.deleted = 0;
      signIn({ perms: [{ key, scope_type: "program", scope_id: PROGRAM_A }] });
      const direct = await remove();
      expect(direct.status, key).toBe(403);
      expect(await direct.json(), key).toEqual({ error: "Forbidden" });
      expect(h.deleted, key).toBe(0);

      h.deleted = 0;
      signIn({
        roles: [{ id: "r-a", name: "staff", scope_type: "program", scope_id: PROGRAM_A }],
        bundles: [{ role_id: "r-a", key }],
      });
      const viaRole = await remove();
      expect(viaRole.status, `role ${key}`).toBe(403);
      expect(h.deleted, `role ${key}`).toBe(0);
    }
  });

  it("lets a school-B grant delete a school-B application", async () => {
    h.programId = PROGRAM_B;
    h.canRead = true;
    for (const key of ["schools.manage", "schools.approve_applications"] as const) {
      h.deleted = 0;
      signIn({ perms: [{ key, scope_type: "program", scope_id: PROGRAM_B }] });
      expect((await remove()).status, key).toBe(200);
      expect(h.deleted, key).toBe(1);

      h.deleted = 0;
      signIn({
        roles: [{ id: "r-b", name: "staff", scope_type: "program", scope_id: PROGRAM_B }],
        bundles: [{ role_id: "r-b", key }],
      });
      expect((await remove()).status, `role ${key}`).toBe(200);
      expect(h.deleted, `role ${key}`).toBe(1);
    }
  });

  it("denies a deactivated user even with an unscoped schools.manage grant", async () => {
    h.canRead = true;
    signIn({
      active: false,
      perms: [{ key: "schools.manage", scope_type: null, scope_id: null }],
    });
    const res = await remove();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(h.deleted).toBe(0);
  });

  it("denies with Forbidden when the expiry lookup fails", async () => {
    signIn({ perms: [{ key: "schools.manage", scope_type: null, scope_id: null }] });
    h.canRead = true;
    h.expiry = {
      endDate: null,
      expiresOn: null,
      expired: false,
      canAccess: false,
      lookupFailed: true,
    };
    const res = await remove();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(h.deleted).toBe(0);
  });

  it("returns the archived-applications message when the school is expired", async () => {
    signIn({ perms: [{ key: "schools.manage", scope_type: null, scope_id: null }] });
    h.canRead = true;
    h.expiry = {
      endDate: "2020-01-01",
      expiresOn: "2020-07-01",
      expired: true,
      canAccess: false,
      lookupFailed: false,
    };
    const res = await remove();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: h.archived });
    expect(h.deleted).toBe(0);
  });

  it("refuses delete for grants and roles the DELETE policy does not name", async () => {
    signIn({ perms: [{ key: "schools.manage_enrollments", scope_type: null, scope_id: null }] });
    expect((await archive()).status).toBe(200);
    expect((await remove()).status).toBe(403);
    expect(h.deleted).toBe(0);

    h.removed = 0;
    signIn({
      perms: [{ key: "schools.manage_enrollments", scope_type: "program", scope_id: PROGRAM_A }],
    });
    expect((await archive()).status).toBe(200);
    expect((await remove()).status).toBe(403);

    h.deleted = 0;
    signIn({ roles: [{ name: "admin", scope_type: "program", scope_id: PROGRAM_A }] });
    expect((await remove()).status).toBe(403);
    expect(h.deleted).toBe(0);

    signIn({ roles: [programLeader("program", PROGRAM_B)] });
    expect((await archive()).status).toBe(403);
    expect((await remove()).status).toBe(403);
    expect(h.deleted).toBe(0);
  });
});
