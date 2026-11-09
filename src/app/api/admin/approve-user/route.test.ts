import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "admin-1" } as { id: string } | null,
  isAdmin: true,
  userUpdates: [] as unknown[],
  adminUpdates: [] as unknown[],
  adminClientCalls: 0,
}));

function builder(kind: "user" | "admin") {
  let writing = false;
  const q: Record<string, unknown> = {};
  const chain = () => q;
  q.select = chain;
  q.eq = chain;
  q.in = chain;
  q.limit = chain;
  q.update = (payload: unknown) => {
    writing = true;
    if (kind === "user") state.userUpdates.push(payload);
    else state.adminUpdates.push(payload);
    return q;
  };
  q.single = async () => ({ data: { id: "target-1", status: "active" }, error: null });
  q.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
    const result = writing
      ? { data: null, error: null }
      : { data: state.isAdmin ? [{ roles: { name: "admin" } }] : [], error: null };
    return Promise.resolve(result).then(onFulfilled, onRejected);
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => builder("user"),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    state.adminClientCalls += 1;
    return { from: () => builder("admin") };
  },
}));

vi.mock("@/lib/auth/super-admin-target", () => ({
  refuseSuperAdminTarget: async () => null,
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/admin/approve-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  state.user = { id: "admin-1" };
  state.isAdmin = true;
  state.userUpdates = [];
  state.adminUpdates = [];
  state.adminClientCalls = 0;
});

describe("POST /api/admin/approve-user", () => {
  it("403 for a non-admin and does not write", async () => {
    state.isAdmin = false;
    const res = await post({ user_id: "target-1", job_title: "Pastor" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Not authorized" });
    expect(state.adminClientCalls).toBe(0);
    expect(state.userUpdates).toHaveLength(0);
    expect(state.adminUpdates).toHaveLength(0);
  });

  it("writes status with the service role and job_title with the user client", async () => {
    const res = await post({ user_id: "target-1", job_title: "Pastor" });
    expect(res.status).toBe(200);
    expect(state.adminUpdates).toEqual([{ status: "active" }]);
    expect(state.userUpdates).toEqual([{ job_title: "Pastor" }]);
    expect(state.userUpdates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "active" })])
    );
  });

  it("omits the user-client write when no job title is sent", async () => {
    const res = await post({ user_id: "target-1" });
    expect(res.status).toBe(200);
    expect(state.adminUpdates).toEqual([{ status: "active" }]);
    expect(state.userUpdates).toHaveLength(0);
  });

  it("401 when signed out", async () => {
    state.user = null;
    const res = await post({ user_id: "target-1", job_title: "Pastor" });
    expect(res.status).toBe(401);
    expect(state.adminClientCalls).toBe(0);
  });
});
