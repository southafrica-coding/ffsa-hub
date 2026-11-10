import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  row: {
    is_active: true,
    signup_type: "student",
    department: null as string | null,
    status: "invited" as string | null,
    accepted_at: null as string | null,
    marital_status: "married" as string | null,
  },
  readError: null as { message: string } | null,
  updateError: null as { code?: string; message: string } | null,
  updates: [] as unknown[],
}));

function builder() {
  let writing = false;
  const q: Record<string, unknown> = {};
  const chain = () => q;
  q.select = chain;
  q.eq = chain;
  q.is = chain;
  q.maybeSingle = async () => ({
    data: state.readError ? null : state.row,
    error: state.readError,
  });
  q.update = (payload: unknown) => {
    writing = true;
    state.updates.push(payload);
    return q;
  };
  q.single = async () =>
    writing
      ? { data: { id: "u1" }, error: state.updateError }
      : { data: state.row, error: state.readError };
  q.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
    const result = writing
      ? { data: null, error: state.updateError }
      : { data: [], error: null };
    return Promise.resolve(result).then(onFulfilled, onRejected);
  };
  return q;
}

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: () => {} };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => builder(),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("onboarding complete must not touch the service role");
  },
}));

import { POST } from "./route";

function post(body?: unknown) {
  return POST(
    new Request("http://localhost/api/onboarding/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  state.user = { id: "u1" };
  state.row = {
    is_active: true,
    signup_type: "student",
    department: null,
    status: "invited",
    accepted_at: null,
    marital_status: "married",
  };
  state.readError = null;
  state.updateError = null;
  state.updates = [];
});

describe("POST /api/onboarding/complete", () => {
  it("sets status to active and stamps accepted_at", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    const payload = state.updates[0] as { status: string; accepted_at: string };
    expect(payload.status).toBe("active");
    expect(typeof payload.accepted_at).toBe("string");
    expect(Object.keys(payload).sort()).toEqual(["accepted_at", "status"]);
  });

  it("403 when status is pending_approval and does not update", async () => {
    state.row.status = "pending_approval";
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Only an admin can change the account status.",
    });
    expect(state.updates).toHaveLength(0);
  });

  it("allows a null status through to active", async () => {
    state.row.status = null;
    const res = await post();
    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
  });

  it("does not write again once accepted_at is set", async () => {
    state.row.accepted_at = "2026-01-01T00:00:00Z";
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, alreadyComplete: true });
    expect(state.updates).toHaveLength(0);
  });

  it("403 for a deactivated account", async () => {
    state.row.is_active = false;
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This account is deactivated." });
    expect(state.updates).toHaveLength(0);
  });

  it("400 names a privileged body field and does not update", async () => {
    const res = await post({ is_active: true, contact_id: "c1", status: "active" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("is_active");
    expect(body.error).toContain("contact_id");
    expect(body.error).toContain("status");
    expect(state.updates).toHaveLength(0);
  });

  it("maps a 42501 from the update to 403", async () => {
    state.updateError = {
      code: "42501",
      message: "Only an admin can change accepted_at.",
    };
    const res = await post();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Only an admin can change accepted_at.",
    });
  });
});
