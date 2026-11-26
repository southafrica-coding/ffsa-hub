import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  email: "Ada_Smith@Example.com",
  status: "submitted",
  userId: null as string | null,
  /** Existing users row. Null means the applicant has no account yet. */
  account: { id: "user-1", first_name: "Ada" } as { id: string; first_name: string } | null,
  /** Existing enrollment. Null means Accept still has to create one. */
  enrollment: null as { id: string; removed_at?: string | null } | null,
  /** Rows the compare-and-set status claim returns. Empty means another Accept won. */
  claimRows: [{ id: "app1" }] as Array<{ id: string }>,
  /** Enrolment insert error. A duplicate makes Accept reuse the existing row. */
  enrollInsertError: null as { message: string } | null,
  /** Error from the "is there already an enrolment?" read. */
  enrollmentLookupError: null as { message: string } | null,
  /** Existing billing plan for the enrolment. Set when billing must not run again. */
  billingPlan: null as { id: string } | null,
  reviewedAt: null as string | null,
  filters: [] as Array<{ table: string; op: string; column: string; value: unknown }>,
  writes: [] as string[],
  billing: 0,
  emails: 0,
  createUsers: 0,
  invites: 0,
  notesError: null as string | null,
  /** Assigned on the application. */
  assignedStaffId: null as string | null,
  copies: [] as Array<{ enrollmentId: string; programId: string; application: unknown }>,
  assignmentEmails: 0,
}));

function builder(table: string) {
  const b: Record<string, unknown> = {};
  let op = "select";
  const self = () => b;
  b.select = () => b;
  b.insert = () => {
    op = "insert";
    h.writes.push(`insert:${table}`);
    return b;
  };
  b.update = () => {
    op = "update";
    h.writes.push(`update:${table}`);
    return b;
  };
  b.delete = self;
  b.upsert = () => {
    op = "upsert";
    h.writes.push(`upsert:${table}`);
    return b;
  };
  b.or = (value: string) => {
    h.filters.push({ table, op: "or", column: "or", value });
    return b;
  };
  b.eq = (column: string, value: unknown) => {
    h.filters.push({ table, op: "eq", column, value });
    return b;
  };
  b.is = (column: string, value: unknown) => {
    h.filters.push({ table, op: "is", column, value });
    return b;
  };
  b.ilike = (column: string, value: unknown) => {
    h.filters.push({ table, op: "ilike", column, value });
    return b;
  };
  b.single = async () => {
    if (table === "application_responses") return { data: applicationRow(), error: null };
    if (table === "enrollments") {
      if (h.enrollInsertError) return { data: null, error: h.enrollInsertError };
      return { data: { id: "enr-1" }, error: null };
    }
    return { data: null, error: null };
  };
  b.maybeSingle = async () => {
    if (table === "users") return { data: h.account, error: null };
    if (table === "enrollments") {
      if (h.enrollmentLookupError) return { data: null, error: h.enrollmentLookupError };
      return { data: h.enrollment, error: null };
    }
    if (table === "student_billing_plans") return { data: h.billingPlan, error: null };
    if (table === "application_responses") return { data: applicationRow(), error: null };
    return { data: null, error: null };
  };
  b.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
    const value =
      table === "application_admin_notes" && op === "upsert" && h.notesError
        ? { data: null, error: { message: h.notesError } }
        : table === "application_responses" && op === "update"
          ? { data: h.claimRows, error: null }
          : { data: null, error: null };
    return Promise.resolve(value).then(onFulfilled, onRejected);
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "admin" } } }) },
  }),
}));
function applicationRow() {
  return {
    id: "app1",
    user_id: h.userId,
    status: h.status,
    program_id: "p1",
    applicant_email: h.email,
    reviewed_at: h.reviewedAt,
    assigned_staff_id: h.assignedStaffId,
    staff_assigned_at: h.assignedStaffId ? "2026-10-01T09:00:00.000Z" : null,
    staff_assigned_by: h.assignedStaffId ? "lead" : null,
    applicant_info: { first_name: "Ada", last_name: "Smith", email: h.email },
    programs: {
      id: "p1",
      name: "Test",
      code: "T",
      acceptance_email_subject: null,
      acceptance_email_body: null,
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => builder(table),
    auth: {
      admin: {
        createUser: async () => {
          h.createUsers += 1;
          return { data: { user: { id: "new-user" } }, error: null };
        },
      },
    },
  }),
}));
vi.mock("@/lib/auth/check-schools-access", () => ({ userCanManageProgram: async () => true }));
vi.mock("@/lib/auth/application-expiry", () => ({
  userCanReadApplication: async () => true,
  APPLICATIONS_EXPIRED_MESSAGE: "expired",
}));
vi.mock("@/lib/auth/membership-roles", () => ({ ensureStudentRole: async () => {} }));
vi.mock("@/lib/auth/onboarding-invite", () => ({
  createOnboardingInvite: async () => {
    h.invites += 1;
    return { ok: true, token: "tok", url: "https://hub.test/setup/tok" };
  },
}));
vi.mock("@/lib/schools/setup-invite-schedule", () => ({
  resolveSetupInviteDueDate: async () => null,
  formatInviteDate: () => "",
}));
vi.mock("@/services/billing-generation", () => ({
  setupProgramBillingOnAcceptance: async () => {
    h.billing += 1;
    return { ok: true };
  },
}));
vi.mock("@/lib/email/send-transactional", () => ({
  sendTransactional: async () => {
    h.emails += 1;
    return { ok: true, id: "msg" };
  },
}));

vi.mock("@/lib/schools/staff-assignment-sync", () => ({
  copyApplicationAssigneeToEnrollment: async (
    _admin: unknown,
    opts: { enrollmentId: string; programId: string; application: unknown }
  ) => {
    h.copies.push(opts);
    return "copied";
  },
}));
vi.mock("@/lib/email/send-staff-assignment", () => ({
  sendStaffAssignmentEmails: async () => {
    h.assignmentEmails += 1;
  },
}));

import { POST } from "./route";

function post(extra: Record<string, unknown> = {}) {
  return POST(
    new Request("https://hub.test/api/admin/accept-application", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_id: "app1", ...extra }),
    })
  );
}

describe("POST /api/admin/accept-application email match", () => {
  beforeEach(() => {
    h.email = "Ada_Smith@Example.com";
    h.status = "submitted";
    h.userId = null;
    h.account = { id: "user-1", first_name: "Ada" };
    h.enrollment = null;
    h.claimRows = [{ id: "app1" }];
    h.enrollInsertError = null;
    h.enrollmentLookupError = null;
    h.billingPlan = null;
    h.reviewedAt = null;
    h.filters = [];
    h.writes = [];
    h.billing = 0;
    h.emails = 0;
    h.createUsers = 0;
    h.invites = 0;
    h.notesError = null;
    h.assignedStaffId = null;
    h.copies = [];
    h.assignmentEmails = 0;
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

  it("finishes an application that is already accepted but has no enrollment", async () => {
    h.status = "accepted";
    h.userId = null;
    h.account = null;
    h.enrollment = null;
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.error).toBeUndefined();
    expect(h.writes).toContain("insert:enrollments");
    expect(h.billing).toBe(1);
    expect(h.emails).toBe(1);
  });

  it("refuses an application that is already accepted and already enrolled", async () => {
    h.status = "accepted";
    h.userId = "user-1";
    h.account = { id: "user-1", first_name: "Ada" };
    h.enrollment = { id: "enr-existing" };
    const res = await post();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "This application has already been accepted",
      code: "already_enrolled",
    });
    expect(h.writes).toEqual([]);
    expect(h.billing).toBe(0);
    expect(h.emails).toBe(0);
  });

  it("returns 409 and writes nothing when an accepted row was claimed seconds ago", async () => {
    h.status = "accepted";
    h.reviewedAt = new Date().toISOString();
    h.userId = null;
    h.account = null;
    h.enrollment = null;
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error:
        "This application was accepted moments ago. If it didn't finish, try again in a few minutes.",
    });
    expect(h.writes).toEqual([]);
    expect(h.createUsers).toBe(0);
    expect(h.invites).toBe(0);
    expect(h.emails).toBe(0);
    expect(h.billing).toBe(0);
  });

  it("reverts the accepted status when the note cannot be saved", async () => {
    h.notesError = "notes failed";
    const res = await post({ admin_notes: "keep this" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "notes failed" });
    expect(h.writes.filter((write) => write === "update:application_responses")).toHaveLength(2);
    expect(h.writes).toContain("upsert:application_admin_notes");
    expect(h.writes).not.toContain("insert:enrollments");
    expect(h.createUsers).toBe(0);
    expect(h.invites).toBe(0);
    expect(h.emails).toBe(0);
    expect(h.billing).toBe(0);
  });

  it("returns 409 and does nothing else when the accept claim matches no row", async () => {
    h.claimRows = [];
    h.account = null;
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "This application is already being accepted. Refresh and check.",
    });
    expect(h.createUsers).toBe(0);
    expect(h.invites).toBe(0);
    expect(h.emails).toBe(0);
    expect(h.billing).toBe(0);
    expect(h.writes).toEqual(["update:application_responses"]);
  });

  it("does not bill again when the enrolment already has a billing plan", async () => {
    h.enrollInsertError = { message: "duplicate key value violates unique constraint" };
    h.enrollment = { id: "enr-existing", removed_at: null };
    h.billingPlan = { id: "plan-1" };
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.billing).toBe(0);
    expect(h.writes).toContain("insert:enrollments");
  });

  it("returns 500 and stops when the enrolment check fails", async () => {
    h.status = "accepted";
    h.userId = "user-1";
    h.enrollmentLookupError = { message: "timeout" };
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Could not check whether this applicant is already enrolled.",
    });
    expect(h.writes).toEqual([]);
    expect(h.emails).toBe(0);
    expect(h.billing).toBe(0);
    expect(h.createUsers).toBe(0);
    expect(h.invites).toBe(0);
  });

  it("finishes an accepted row whose email matches an existing account", async () => {
    h.status = "accepted";
    h.userId = null;
    h.account = { id: "user-1", first_name: "Ada" };
    h.enrollment = null;
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(h.createUsers).toBe(0);
    expect(h.invites).toBe(0);
    expect(h.emails).toBe(1);
    expect(h.billing).toBe(1);
    expect(h.writes).toContain("insert:enrollments");
    expect(h.filters).toContainEqual({
      table: "application_responses",
      op: "eq",
      column: "status",
      value: "accepted",
    });
    expect(h.filters).toContainEqual({
      table: "application_responses",
      op: "is",
      column: "reviewed_at",
      value: null,
    });
  });

  it("rejects * before the user lookup and does not accept the application", async () => {
    h.email = "a*@gmail.com";
    const res = await post();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This applicant's email can't be matched safely." });
    expect(h.filters.some((f) => f.table === "users")).toBe(false);
    expect(h.filters.some((f) => f.op === "ilike")).toBe(false);
  });

  it("copies Assigned onto the new enrolment without an assignment email", async () => {
    h.assignedStaffId = "amy";
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.copies).toEqual([
      {
        enrollmentId: "enr-1",
        programId: "p1",
        application: {
          assigned_staff_id: "amy",
          staff_assigned_at: "2026-10-01T09:00:00.000Z",
          staff_assigned_by: "lead",
        },
        actorId: "admin",
      },
    ]);
    expect(h.assignmentEmails).toBe(0);
  });

  it("copies Assigned onto a restored enrolment", async () => {
    h.assignedStaffId = "amy";
    h.enrollInsertError = { message: "duplicate key value violates unique constraint" };
    h.enrollment = { id: "enr-old", removed_at: "2026-09-01T00:00:00Z" };
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.copies.map((c) => c.enrollmentId)).toEqual(["enr-old"]);
    expect(h.assignmentEmails).toBe(0);
  });

  it("leaves an enrolment that was already live alone", async () => {
    h.assignedStaffId = "amy";
    h.enrollInsertError = { message: "duplicate key value violates unique constraint" };
    h.enrollment = { id: "enr-old", removed_at: null };
    const res = await post();
    expect(res.status).toBe(200);
    expect(h.copies).toEqual([]);
  });
});
