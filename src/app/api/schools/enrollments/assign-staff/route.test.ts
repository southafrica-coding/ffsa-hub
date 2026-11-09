import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOT_ASSIGNABLE_CONTACT_ERROR } from "@/lib/auth/assignable-contacts";

// Enrollment assignment uses the same shared eligibility helper as the
// applicant assignment route.

const PROGRAM_A = "program-a";
const PROGRAM_B = "program-b";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  type HRow = Record<string, unknown>;
  const state = {
    user: { id: "actor" } as { id: string } | null,
    canManage: true,
    tables: {} as Record<string, HRow[]>,
  };

  function read(row: HRow, path: string): unknown {
    return path.split(".").reduce<unknown>((cur, key) => {
      if (cur && typeof cur === "object") return (cur as HRow)[key];
      return undefined;
    }, row);
  }

  function from(table: string) {
    const filters: Array<(row: HRow) => boolean> = [];
    let mode: "select" | "update" | "insert" = "select";
    let patch: HRow | null = null;
    let inserted: HRow | null = null;
    const matched = () => (state.tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
    const done = () => {
      if (mode === "insert" && inserted) {
        (state.tables[table] ??= []).push(inserted);
        return { data: null, error: null };
      }
      if (mode === "update" && patch) {
        for (const row of matched()) Object.assign(row, patch);
        return { data: null, error: null };
      }
      return { data: matched(), error: null };
    };
    const q = {
      select: () => q,
      eq: (col: string, value: unknown) => {
        filters.push((row) => read(row, col) === value);
        return q;
      },
      update: (row: HRow) => {
        mode = "update";
        patch = row;
        return q;
      },
      insert: (row: HRow) => {
        mode = "insert";
        inserted = row;
        return q;
      },
      single: () => {
        const row = matched()[0];
        if (!row) return Promise.resolve({ data: null, error: { message: "not found" } });
        return Promise.resolve({ data: row, error: null });
      },
      maybeSingle: () => Promise.resolve({ data: matched()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(done()).then(resolve, reject),
    };
    return q;
  }

  return { state, from };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.state.user } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: h.from }),
}));
vi.mock("@/lib/auth/check-schools-access", () => ({
  userCanManageProgram: async () => h.state.canManage,
}));
vi.mock("@/lib/email/send-staff-assignment", () => ({
  sendStaffAssignmentEmails: async () => {},
}));

import { PUT } from "./route";

function person(id: string, first: string, isActive = true): Row {
  return {
    id,
    first_name: first,
    last_name: "Person",
    preferred_name: null,
    email: `${id}@example.com`,
    is_active: isActive,
  };
}

let enrollment: Row;

beforeEach(() => {
  h.state.user = { id: "actor" };
  h.state.canManage = true;
  const amy = person("amy", "Amy");
  const ben = person("ben", "Ben");
  const cara = person("cara", "Cara");
  const evan = person("evan", "Evan");
  const fran = person("fran", "Fran", false);
  enrollment = {
    id: "enr-1",
    program_id: PROGRAM_A,
    user_id: "student",
    assigned_staff_id: null,
    users: { first_name: "Stu", last_name: "Dent", preferred_name: null, email: "student@example.com" },
    programs: { name: "Leadership Track" },
  };
  h.state.tables = {
    users: [amy, ben, cara, evan, fran, person("actor", "Actor")],
    user_permissions: [
      {
        user_id: "ben",
        scope_type: "program",
        scope_id: PROGRAM_A,
        permissions: { key: "schools.assignable_as_contact" },
        users: ben,
      },
    ],
    user_roles: [{ user_id: "cara", roles: { name: "super_admin" }, users: cara }],
    program_leaders: [
      { user_id: "amy", program_id: PROGRAM_A, users: amy },
      { user_id: "fran", program_id: PROGRAM_A, users: fran },
      { user_id: "evan", program_id: PROGRAM_B, users: evan },
    ],
    enrollments: [enrollment],
    audit_logs: [],
  };
});

function put(assignedStaffId: string | null) {
  return PUT(
    new Request("http://localhost/api/schools/enrollments/assign-staff", {
      method: "PUT",
      body: JSON.stringify({ enrollment_id: "enr-1", assigned_staff_id: assignedStaffId }),
    })
  );
}

describe("PUT /api/schools/enrollments/assign-staff", () => {
  it("accepts an active leader of this program and rejects them for another", async () => {
    expect((await put("amy")).status).toBe(200);
    expect(enrollment.assigned_staff_id).toBe("amy");

    enrollment.program_id = PROGRAM_B;
    enrollment.assigned_staff_id = null;
    const res = await put("amy");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: NOT_ASSIGNABLE_CONTACT_ERROR });
    expect(enrollment.assigned_staff_id).toBeNull();
  });

  it("rejects a deactivated leader and still accepts the existing grants", async () => {
    enrollment.program_id = PROGRAM_A;
    expect((await put("fran")).status).toBe(400);
    expect((await put("ben")).status).toBe(200);
    expect((await put("cara")).status).toBe(200);
    expect(enrollment.assigned_staff_id).toBe("cara");
  });

  it("clears the assignment", async () => {
    enrollment.assigned_staff_id = "amy";
    expect((await put(null)).status).toBe(200);
    expect(enrollment.assigned_staff_id).toBeNull();
  });
});
