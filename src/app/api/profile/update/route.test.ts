import { beforeEach, describe, expect, it, vi } from "vitest";

// PUT /api/profile/update — self-edit allowlist and the 315 department rules.
// The Supabase client is faked; normalizeInsuranceWrite and the household
// write are the real functions and only run when those fields are sent.

type Row = {
  is_active: boolean;
  signup_type: string | null;
  department: string | null;
  status: string | null;
  accepted_at: string | null;
  marital_status: string | null;
};

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  row: {
    is_active: true,
    signup_type: "staff",
    department: null,
    status: "active",
    accepted_at: "2026-01-01T00:00:00Z",
    marital_status: "single",
  } as Row,
  readError: null as { message: string } | null,
  hasStaffRole: false,
  roleError: null as { message: string } | null,
  ministry: null as { slug: string; ministry_type: string } | null,
  updateError: null as { code?: string; message: string } | null,
  updates: [] as Array<{ table: string; payload: unknown }>,
  rpcs: [] as Array<{ name: string; args: unknown }>,
}));

function builder(table: string) {
  let writing = false;
  const q: Record<string, unknown> = {};
  const chain = () => q;
  q.select = chain;
  q.eq = chain;
  q.in = chain;
  q.limit = chain;
  q.maybeSingle = async () => {
    if (table === "staff_ministries") return { data: state.ministry, error: null };
    return { data: state.readError ? null : state.row, error: state.readError };
  };
  q.single = q.maybeSingle;
  q.update = (payload: unknown) => {
    writing = true;
    state.updates.push({ table, payload });
    return q;
  };
  q.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
    const result = writing
      ? { data: null, error: state.updateError }
      : { data: state.row, error: state.readError };
    return Promise.resolve(result).then(onFulfilled, onRejected);
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (name: string, args: unknown) => {
      state.rpcs.push({ name, args });
      return { data: state.hasStaffRole, error: state.roleError };
    },
    from: (table: string) => builder(table),
  }),
}));

import { PUT } from "./route";
import { SELF_EDIT_DENIED_MESSAGE } from "@/lib/users/users-update-error";

function put(body: unknown) {
  return PUT(
    new Request("http://localhost/api/profile/update", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  state.user = { id: "u1" };
  state.row = {
    is_active: true,
    signup_type: null,
    department: null,
    status: "active",
    accepted_at: "2026-01-01T00:00:00Z",
    marital_status: "single",
  };
  state.readError = null;
  state.hasStaffRole = false;
  state.roleError = null;
  state.ministry = null;
  state.updateError = null;
  state.updates = [];
  state.rpcs = [];
});

describe("PUT /api/profile/update", () => {
  it("401 when signed out", async () => {
    state.user = null;
    const res = await put({ first_name: "Asha" });
    expect(res.status).toBe(401);
    expect(state.updates).toHaveLength(0);
  });

  it("400 names privileged fields and does not update", async () => {
    const res = await put({
      first_name: "Asha",
      department: "leadership_team",
      is_active: true,
      contact_id: "c1",
      email: "a@b.c",
      household_id: "h1",
      signup_type: "staff",
      drivers_licence_number: "123",
      base_driving_test_status: "passed",
      slack_user_id: "U1",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    for (const field of [
      "is_active",
      "contact_id",
      "email",
      "household_id",
      "signup_type",
      "drivers_licence_number",
      "base_driving_test_status",
      "slack_user_id",
    ]) {
      expect(body.error).toContain(field);
    }
    expect(state.updates).toHaveLength(0);
  });

  it("writes an allowlisted field", async () => {
    const res = await put({ first_name: "Asha", phone: "0820000000" });
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([
      { table: "users", payload: { first_name: "Asha", phone: "0820000000" } },
    ]);
  });

  it("403 when the account is deactivated, before any update", async () => {
    state.row.is_active = false;
    const res = await put({ first_name: "Asha" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This account is deactivated." });
    expect(state.updates).toHaveLength(0);
  });

  it("403 when the profile read fails", async () => {
    state.readError = { message: "boom" };
    const res = await put({ first_name: "Asha" });
    expect(res.status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it("403 for leadership_team and does not update", async () => {
    state.row.signup_type = "staff";
    state.ministry = { slug: "leadership_team", ministry_type: "main" };
    const res = await put({ department: "leadership_team" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Only an admin can set the department leadership_team.",
    });
    expect(state.updates).toHaveLength(0);
    expect(state.rpcs).toHaveLength(0);
  });

  it("403 when a non-staff user sets a main department", async () => {
    state.row.signup_type = "student";
    state.hasStaffRole = false;
    state.ministry = { slug: "media", ministry_type: "main" };
    const res = await put({ department: "media" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only staff choose a department." });
    expect(state.updates).toHaveLength(0);
    expect(state.rpcs).toEqual([
      { name: "has_any_role", args: { required_roles: ["staff"] } },
    ]);
  });

  it("lets a staff role set a main department", async () => {
    state.hasStaffRole = true;
    state.ministry = { slug: "media", ministry_type: "main" };
    const res = await put({ department: "media" });
    expect(res.status).toBe(200);
    expect(state.updates).toEqual([{ table: "users", payload: { department: "media" } }]);
  });

  it("lets signup_type staff set a main department without the role", async () => {
    state.row.signup_type = "staff";
    state.hasStaffRole = false;
    state.ministry = { slug: "media", ministry_type: "main" };
    const res = await put({ department: "media" });
    expect(res.status).toBe(200);
    expect(state.rpcs).toHaveLength(0);
    expect(state.updates[0]?.payload).toEqual({ department: "media" });
  });

  it("lets anyone clear department with null or an empty string", async () => {
    state.row.department = "media";
    state.row.signup_type = "student";
    const cleared = await put({ department: null });
    expect(cleared.status).toBe(200);
    const blank = await put({ department: "" });
    expect(blank.status).toBe(200);
    expect(state.updates.map((u) => u.payload)).toEqual([{ department: null }, { department: "" }]);
    expect(state.rpcs).toHaveLength(0);
  });

  it("400 for an unknown slug", async () => {
    state.row.signup_type = "staff";
    state.ministry = null;
    const res = await put({ department: "not_a_ministry" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Please select a valid department." });
    expect(state.updates).toHaveLength(0);
  });

  it("leaves an unchanged leadership_team value alone", async () => {
    state.row.department = "leadership_team";
    state.row.signup_type = "student";
    const res = await put({ department: "leadership_team", first_name: "Asha" });
    expect(res.status).toBe(200);
    expect(state.updates[0]?.payload).toEqual({
      department: "leadership_team",
      first_name: "Asha",
    });
  });

  it("maps a column-grant 42501 to the friendly 403", async () => {
    state.updateError = { code: "42501", message: "permission denied for column is_active" };
    const res = await put({ first_name: "Asha" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: SELF_EDIT_DENIED_MESSAGE });
    expect(state.updates).toHaveLength(1);
  });

  it("maps a trigger 42501 to the trigger sentence", async () => {
    state.updateError = {
      code: "42501",
      message: "Only an admin can change job_title on an account.",
    };
    const res = await put({ first_name: "Asha" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Only an admin can change job_title on an account.",
    });
  });
});
