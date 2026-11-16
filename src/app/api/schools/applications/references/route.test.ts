import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, filterValue, type FakeQuery } from "@/lib/testing/fake-supabase";
import { REFERENCE_REQUEST_WITH_SLOT } from "@/lib/references/reference-request-columns";

const editReferenceContact = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, data: { id: "ref" }, emailed: false, emailChanged: false }))
);

const state = vi.hoisted(() => ({
  user: null as ReturnType<typeof createFakeSupabase>["client"] | null,
  admin: null as ReturnType<typeof createFakeSupabase>["client"] | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.user,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.admin,
}));
vi.mock("@/lib/references/edit-reference-contact", () => ({
  editReferenceContact,
  REFERENCE_EDIT_SELECT: "*",
}));
vi.mock("@/lib/references/reference-delivery", () => ({
  annotateReferenceDelivery: vi.fn(
    async (_admin: unknown, _applicationId: string, refs: unknown[]) =>
      (refs ?? []).map((ref) => ({ ...(ref as object), email_problem: null }))
  ),
}));

import { GET, PATCH } from "./route";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function use(opts: {
  scope: "unscoped" | "program-a" | "leader-a" | "error";
}) {
  state.user = createFakeSupabase({
    user: { id: "u" },
    resolve: (q: FakeQuery) => {
      if (q.table === "users") return { data: { is_active: true } };
      if (q.table === "application_responses") return { data: { id: "app" } };
      if (q.table === "user_roles") {
        if (opts.scope !== "leader-a") return { data: [] };
        return {
          data: [{ scope_type: "program", scope_id: A, roles: { name: "program_leader" } }],
        };
      }
      if (q.table === "program_leaders") return { data: [] };
      if (q.table === "user_permissions") {
        if (opts.scope === "leader-a") return { data: [] };
        const grant = {
          scope_type: opts.scope === "program-a" ? "program" : null,
          scope_id: opts.scope === "program-a" ? A : null,
          permissions: { key: "schools.manage", module: "schools" },
        };
        const wantsNullScope = q.filters.some(
          (f) => f.op === "is" && f.args[0] === "scope_type" && f.args[1] === null
        );
        const scopeType = q.filters.find((f) => f.op === "eq" && f.args[0] === "scope_type")?.args[1];
        const scopeId = q.filters.find((f) => f.op === "eq" && f.args[0] === "scope_id")?.args[1];
        if (wantsNullScope && grant.scope_type !== null) return { data: [] };
        if (scopeType !== undefined && grant.scope_type !== scopeType) return { data: [] };
        if (scopeId !== undefined && grant.scope_id !== scopeId) return { data: [] };
        return { data: [grant] };
      }
      return { data: [] };
    },
  }).client;

  state.admin = createFakeSupabase({
    resolve: (q: FakeQuery) => {
      if (q.table !== "reference_requests") return { data: null };
      if (opts.scope === "error") return { data: null, error: { message: "boom" } };
      const id = filterValue(q, "eq", "id");
      const programId = id === "ref-b" ? B : A;
      return {
        data: {
          id,
          application_id: "app",
          status: "pending",
          referee_name: "Ada",
          referee_email: "ada@example.com",
          application_responses: { program_id: programId },
        },
      };
    },
  }).client;
}

function patch(id: string) {
  return new Request("http://localhost/api/schools/applications/references", {
    method: "PATCH",
    body: JSON.stringify({
      reference_request_id: id,
      referee_name: "Ada",
      referee_email: "ada@example.com",
    }),
  });
}

describe("PATCH /api/schools/applications/references", () => {
  beforeEach(() => {
    editReferenceContact.mockClear();
  });

  it("lets an unscoped schools manager edit a reference", async () => {
    use({ scope: "unscoped" });
    const res = await PATCH(patch("ref-a"));
    expect(res.status).toBe(200);
    expect(editReferenceContact).toHaveBeenCalledOnce();
  });

  it("lets a leader scoped to the reference's program edit it", async () => {
    use({ scope: "program-a" });
    const res = await PATCH(patch("ref-a"));
    expect(res.status).toBe(200);
    expect(editReferenceContact).toHaveBeenCalledOnce();
  });

  it("refuses a leader scoped to a different program", async () => {
    use({ scope: "program-a" });
    const res = await PATCH(patch("ref-b"));
    expect(res.status).toBe(403);
    expect(editReferenceContact).not.toHaveBeenCalled();
  });

  it("lets a program_leader scoped to A edit that program and refuses program B", async () => {
    use({ scope: "leader-a" });
    expect((await PATCH(patch("ref-a"))).status).toBe(200);
    editReferenceContact.mockClear();
    expect((await PATCH(patch("ref-b"))).status).toBe(403);
    expect(editReferenceContact).not.toHaveBeenCalled();
  });

  it("refuses when the program lookup errors", async () => {
    use({ scope: "error" });
    const res = await PATCH(patch("ref-a"));
    expect(res.status).toBe(403);
    expect(editReferenceContact).not.toHaveBeenCalled();
  });
});

const APP = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const PROGRAM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const REVIEWER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const SOMEONE_ELSE = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";

function referenceRow() {
  return {
    id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    application_id: APP,
    slot_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    referee_name: "Referee",
    referee_email: "referee@example.test",
    token: "invite-token-must-not-leak",
    status: "pending",
    relationship: "pastor",
    known_duration: "3 years",
    reference_text: "A written reference",
    form_data: { answers: [] },
    submitted_at: null,
    email_sent_at: "2026-01-02T00:00:00Z",
    reminder_sent_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    reference_slots: { label: "Pastor", description: "A pastor who knows them" },
  };
}

function useGet(opts: {
  userId: string;
  assignedStaffId: string | null;
  canRead?: boolean;
  manager?: boolean;
  canAccess?: boolean;
}) {
  const user = createFakeSupabase({
    user: { id: opts.userId },
    resolve: (q: FakeQuery) => {
      if (q.rpc?.name === "can_access_assigned_school_record") {
        return { data: opts.canAccess === true };
      }
      if (q.table === "application_responses") {
        if (opts.canRead === false) return { data: null };
        return {
          data: {
            id: APP,
            program_id: PROGRAM,
            assigned_staff_id: opts.assignedStaffId,
          },
        };
      }
      if (q.table === "users") return { data: { is_active: true } };
      if (q.table === "user_roles") {
        if (!opts.manager) return { data: [] };
        return { data: [{ scope_type: null, scope_id: null, roles: { name: "admin" } }] };
      }
      if (q.table === "user_permissions" || q.table === "program_leaders" || q.table === "role_permissions") {
        return { data: [] };
      }
      if (q.table === "reference_requests") return { data: [referenceRow()] };
      return { data: [] };
    },
  });
  const admin = createFakeSupabase({
    resolve: (q: FakeQuery) => {
      if (q.table === "reference_requests") return { data: [referenceRow()] };
      return { data: [] };
    },
  });
  state.user = user.client;
  state.admin = admin.client;
  return { user, admin };
}

function getReferences() {
  return GET(new Request(`http://localhost/api/schools/applications/references?application_id=${APP}`));
}

function referenceQueries(fake: ReturnType<typeof createFakeSupabase>) {
  return fake.queries.filter((q) => q.table === "reference_requests" && q.action === "select");
}

describe("GET /api/schools/applications/references", () => {
  it("returns an assigned reviewer's references with no token", async () => {
    const { user, admin } = useGet({
      userId: REVIEWER,
      assignedStaffId: REVIEWER,
      canAccess: true,
    });

    const res = await getReferences();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.references).toHaveLength(1);
    expect(body.references[0].referee_name).toBe("Referee");
    expect(body.references[0].reference_slots).toEqual({
      label: "Pastor",
      description: "A pastor who knows them",
    });
    expect(body.references[0]).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toContain("invite-token-must-not-leak");

    expect(referenceQueries(user)).toHaveLength(0);
    const adminRead = referenceQueries(admin);
    expect(adminRead).toHaveLength(1);
    expect(adminRead[0].columns).not.toContain("token");
    expect(adminRead[0].columns).toContain("referee_email");
    expect(adminRead[0].columns).toContain("reference_slots(label, description)");
    expect(filterValue(adminRead[0], "eq", "application_id")).toBe(APP);
    const rpc = user.queries.find((q) => q.rpc?.name === "can_access_assigned_school_record");
    expect(rpc?.rpc?.args).toEqual({ target_program_id: PROGRAM });
  });

  it("refuses program staff who are not the assigned reviewer", async () => {
    const { admin } = useGet({
      userId: REVIEWER,
      assignedStaffId: SOMEONE_ELSE,
      canAccess: true,
    });

    const res = await getReferences();
    expect(res.status).toBe(403);
    expect(referenceQueries(admin)).toHaveLength(0);
  });

  it("does not treat a null assignee as the caller", async () => {
    const { user, admin } = useGet({
      userId: REVIEWER,
      assignedStaffId: null,
      canAccess: true,
    });

    const res = await getReferences();
    expect(res.status).toBe(403);
    expect(referenceQueries(admin)).toHaveLength(0);
    expect(user.queries.some((q) => q.rpc?.name === "can_access_assigned_school_record")).toBe(false);
  });

  it("keeps the manager read on the user client and still omits token", async () => {
    const { user, admin } = useGet({
      userId: REVIEWER,
      assignedStaffId: REVIEWER,
      manager: true,
      canAccess: false,
    });

    const res = await getReferences();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.references).toHaveLength(1);
    expect(body.references[0].referee_name).toBe("Referee");
    expect(body.references[0].status).toBe("pending");
    expect(body.references[0]).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toContain("invite-token-must-not-leak");

    const userRead = referenceQueries(user);
    expect(userRead).toHaveLength(1);
    expect(userRead[0].columns).toBe(REFERENCE_REQUEST_WITH_SLOT);
    expect(userRead[0].columns).not.toContain("token");
    expect(userRead[0].columns).not.toContain("*");
    expect(referenceQueries(admin)).toHaveLength(0);
    expect(user.queries.some((q) => q.rpc?.name === "can_access_assigned_school_record")).toBe(false);
  });

  it("refuses an assigned reviewer the school-record check does not allow", async () => {
    const { admin } = useGet({
      userId: REVIEWER,
      assignedStaffId: REVIEWER,
      canAccess: false,
    });

    const res = await getReferences();
    expect(res.status).toBe(403);
    expect(referenceQueries(admin)).toHaveLength(0);
  });

  it("refuses when the caller cannot read the application", async () => {
    const { user, admin } = useGet({
      userId: REVIEWER,
      assignedStaffId: REVIEWER,
      canRead: false,
      canAccess: true,
    });

    const res = await getReferences();
    expect(res.status).toBe(403);
    expect(referenceQueries(admin)).toHaveLength(0);
    expect(referenceQueries(user)).toHaveLength(0);
  });
});
