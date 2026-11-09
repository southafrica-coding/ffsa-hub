import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOT_ASSIGNABLE_CONTACT_ERROR } from "@/lib/auth/assignable-contacts";

// The assignment route must use the same eligibility as the dropdown.
// The admin client below is enough of a query builder for both the
// application update and fetchAssignableContacts.

const PROGRAM_A = "program-a";
const PROGRAM_B = "program-b";

type Row = Record<string, unknown>;

const h = vi.hoisted(() => {
  type HRow = Record<string, unknown>;
  const state = {
    user: { id: "actor" } as { id: string } | null,
    canManage: true,
    canRead: true,
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
vi.mock("@/lib/auth/application-expiry", () => ({
  userCanReadApplication: async () => h.state.canRead,
  APPLICATIONS_EXPIRED_MESSAGE: "These applications have expired",
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

function permission(userId: string, personRow: Row, programId: string): Row {
  return {
    user_id: userId,
    scope_type: "program",
    scope_id: programId,
    permissions: { key: "schools.assignable_as_contact" },
    users: personRow,
  };
}

let responseRow: Row;

beforeEach(() => {
  h.state.user = { id: "actor" };
  h.state.canManage = true;
  h.state.canRead = true;

  const amy = person("amy", "Amy");
  const ben = person("ben", "Ben");
  const cara = person("cara", "Cara");
  const dee = person("dee", "Dee");
  const evan = person("evan", "Evan");
  const fran = person("fran", "Fran", false);
  const actor = person("actor", "Actor");

  responseRow = {
    id: "resp-1",
    program_id: PROGRAM_A,
    user_id: "student",
    applicant_email: "student@example.com",
    applicant_info: null,
    assigned_staff_id: null,
    users: { first_name: "Stu", last_name: "Dent", preferred_name: null, email: "student@example.com" },
    programs: { name: "Leadership Track" },
  };

  h.state.tables = {
    users: [amy, ben, cara, dee, evan, fran, actor],
    user_permissions: [
      permission("ben", ben, PROGRAM_A),
      permission("dee", dee, PROGRAM_A),
    ],
    user_roles: [{ user_id: "cara", roles: { name: "super_admin" }, users: cara }],
    program_leaders: [
      { user_id: "amy", program_id: PROGRAM_A, users: amy },
      { user_id: "dee", program_id: PROGRAM_A, users: dee },
      { user_id: "fran", program_id: PROGRAM_A, users: fran },
      { user_id: "evan", program_id: PROGRAM_B, users: evan },
    ],
    application_responses: [responseRow],
    audit_logs: [],
  };
});

function put(assignedStaffId: string | null) {
  return PUT(
    new Request("http://localhost/api/schools/applications/responses/assign-staff", {
      method: "PUT",
      body: JSON.stringify({ response_id: "resp-1", assigned_staff_id: assignedStaffId }),
    })
  );
}

function assigned() {
  return h.state.tables.application_responses[0].assigned_staff_id;
}

describe("PUT /api/schools/applications/responses/assign-staff", () => {
  it("accepts an active leader of this program", async () => {
    const res = await put("amy");
    expect(res.status).toBe(200);
    expect(assigned()).toBe("amy");
  });

  it("rejects that leader for a different program", async () => {
    responseRow.program_id = PROGRAM_B;
    const res = await put("amy");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: NOT_ASSIGNABLE_CONTACT_ERROR });
    expect(assigned()).toBeNull();
  });

  it("rejects a deactivated leader and a removed leader", async () => {
    expect((await put("fran")).status).toBe(400);
    expect((await put("removed-leader")).status).toBe(400);
    expect(assigned()).toBeNull();
  });

  it("still accepts a permission holder and a super admin", async () => {
    expect((await put("ben")).status).toBe(200);
    expect(assigned()).toBe("ben");
    expect((await put("cara")).status).toBe(200);
    expect(assigned()).toBe("cara");
  });

  it("accepts someone who is both a leader and a permission holder", async () => {
    const res = await put("dee");
    expect(res.status).toBe(200);
    expect(assigned()).toBe("dee");
  });

  it("rejects a leader of the other program", async () => {
    const res = await put("evan");
    expect(res.status).toBe(400);
    expect(assigned()).toBeNull();
  });

  it("clears the assignment without an eligibility check against a person", async () => {
    responseRow.assigned_staff_id = "amy";
    const res = await put(null);
    expect(res.status).toBe(200);
    expect(assigned()).toBeNull();
  });

  it("does not write when the caller cannot manage the program", async () => {
    h.state.canManage = false;
    expect((await put("amy")).status).toBe(403);
    expect(assigned()).toBeNull();
  });
});
