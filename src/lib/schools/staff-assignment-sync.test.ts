import { beforeEach, describe, expect, it, vi } from "vitest";

// Accepting copies Assigned (application_responses.assigned_staff_id) onto
// Walking with (enrollments.assigned_staff_id) for the enrolment the accept
// created or restored. The client below keeps rows in memory so the test can
// read what was written.

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  assignable: new Set<string>(),
  nextId: 1,
}));

vi.mock("@/lib/auth/assignable-contacts", () => ({
  unassignableContactError: async (_admin: unknown, _programId: string, userId: string | null) =>
    !userId || h.assignable.has(userId) ? null : "That person cannot be assigned to this school",
}));

function from(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let mode: "select" | "update" | "insert" = "select";
  let patch: Row | null = null;
  let inserted: Row | null = null;
  const rows = () => (h.tables[table] ??= []);
  const matched = () => rows().filter((row) => filters.every((f) => f(row)));
  const run = () => {
    if (mode === "insert" && inserted) {
      const row = { id: `new-${h.nextId++}`, assigned_staff_id: null, removed_at: null, ...inserted };
      rows().push(row);
      return [row];
    }
    if (mode === "update" && patch) {
      for (const row of matched()) Object.assign(row, patch);
      return matched();
    }
    return matched();
  };
  const q = {
    select: () => q,
    eq: (col: string, value: unknown) => {
      filters.push((row) => row[col] === value);
      return q;
    },
    update: (row: Row) => {
      mode = "update";
      patch = row;
      return q;
    },
    insert: (row: Row) => {
      mode = "insert";
      inserted = row;
      return q;
    },
    single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
    maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: run(), error: null }).then(resolve, reject),
  };
  return q;
}

const client = { from };

import { ensureEnrollmentForApplicant } from "@/services/schools";
import { copyApplicationAssigneeToEnrollment } from "./staff-assignment-sync";

const ASSIGNED_AT = "2026-10-01T09:00:00.000Z";

function applicant(overrides: Row = {}) {
  return {
    id: "app-1",
    user_id: "student",
    program_id: "p1",
    applicant_email: "student@example.com",
    assigned_staff_id: "amy",
    staff_assigned_at: ASSIGNED_AT,
    staff_assigned_by: "lead",
    ...overrides,
  } as Parameters<typeof ensureEnrollmentForApplicant>[1];
}

function enrolment(overrides: Row = {}): Row {
  const row: Row = {
    id: "enr-1",
    user_id: "student",
    program_id: "p1",
    assigned_staff_id: null,
    removed_at: null,
    staff_viewed_at: "2026-10-02T00:00:00Z",
    ...overrides,
  };
  h.tables.enrollments.push(row);
  return row;
}

beforeEach(() => {
  h.tables = { enrollments: [], application_responses: [], audit_logs: [] };
  h.assignable = new Set(["amy", "ben"]);
  h.nextId = 1;
});

describe("ensureEnrollmentForApplicant copies Assigned onto Walking with", () => {
  it("copies onto a newly created enrolment, keeping when and by whom", async () => {
    const result = await ensureEnrollmentForApplicant(client, applicant(), "actor");
    expect(result.outcome).toBe("created");
    const [enr] = h.tables.enrollments;
    expect(enr).toMatchObject({
      id: result.enrollmentId,
      assigned_staff_id: "amy",
      staff_assigned_at: ASSIGNED_AT,
      staff_assigned_by: "lead",
      staff_viewed_at: null,
    });
    expect(h.tables.audit_logs).toContainEqual(
      expect.objectContaining({
        action: "assign_enrollment_staff",
        changes: expect.objectContaining({ synced_from: "acceptance", new_staff_id: "amy" }),
      })
    );
  });

  it("copies onto a restored enrolment and replaces a different Walking with", async () => {
    const enr = enrolment({ removed_at: "2026-09-01T00:00:00Z", assigned_staff_id: "ben" });
    const result = await ensureEnrollmentForApplicant(client, applicant(), "actor");
    expect(result).toEqual({ enrollmentId: "enr-1", outcome: "restored" });
    expect(enr.removed_at).toBeNull();
    expect(enr.assigned_staff_id).toBe("amy");
  });

  it("leaves a restored enrolment that already has the same person untouched", async () => {
    const enr = enrolment({ removed_at: "2026-09-01T00:00:00Z", assigned_staff_id: "amy" });
    await ensureEnrollmentForApplicant(client, applicant(), "actor");
    expect(enr.staff_viewed_at).toBe("2026-10-02T00:00:00Z");
    expect(h.tables.audit_logs).toHaveLength(0);
  });

  it("does not touch an enrolment that was already live", async () => {
    const enr = enrolment({ assigned_staff_id: "ben" });
    const result = await ensureEnrollmentForApplicant(client, applicant(), "actor");
    expect(result.outcome).toBe("existing");
    expect(enr.assigned_staff_id).toBe("ben");
  });

  it("never clears Walking with when the application has nobody assigned", async () => {
    const enr = enrolment({ removed_at: "2026-09-01T00:00:00Z", assigned_staff_id: "ben" });
    await ensureEnrollmentForApplicant(
      client,
      applicant({ assigned_staff_id: null, staff_assigned_at: null, staff_assigned_by: null }),
      "actor"
    );
    expect(enr.assigned_staff_id).toBe("ben");
  });

  it("does not copy someone who is no longer assignable to this school", async () => {
    h.assignable = new Set(["ben"]);
    const result = await ensureEnrollmentForApplicant(client, applicant(), "actor");
    expect(result.outcome).toBe("created");
    expect(h.tables.enrollments[0].assigned_staff_id).toBeNull();
  });

  it("only touches the enrolment in the applicant's own school", async () => {
    const other = enrolment({ id: "enr-other", program_id: "p2", assigned_staff_id: "ben" });
    const result = await ensureEnrollmentForApplicant(client, applicant(), "actor");
    expect(result.outcome).toBe("created");
    expect(other.assigned_staff_id).toBe("ben");
  });
});

describe("copyApplicationAssigneeToEnrollment", () => {
  it("falls back to now and the actor when the application has no history", async () => {
    const enr = enrolment();
    const outcome = await copyApplicationAssigneeToEnrollment(client, {
      enrollmentId: "enr-1",
      programId: "p1",
      application: { assigned_staff_id: "amy" },
      actorId: "actor",
    });
    expect(outcome).toBe("copied");
    expect(enr.staff_assigned_by).toBe("actor");
    expect(typeof enr.staff_assigned_at).toBe("string");
  });

  it("reports failed when the enrolment is missing", async () => {
    const outcome = await copyApplicationAssigneeToEnrollment(client, {
      enrollmentId: "missing",
      programId: "p1",
      application: { assigned_staff_id: "amy" },
      actorId: "actor",
    });
    expect(outcome).toBe("failed");
  });
});
