import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "admin-1" } as { id: string } | null,
  isAdmin: true,
  userUpdates: [] as unknown[],
  adminUpdates: [] as unknown[],
  adminClientCalls: 0,
  adminUpdateError: null as { message: string } | null,
  rpcThrow: false,
  callerActive: true,
  pendingMatch: true,
  adminEqs: [] as Array<[string, unknown]>,
}));

function builder(kind: "user" | "admin") {
  let writing = false;
  const q: Record<string, unknown> = {};
  const chain = () => q;
  q.select = chain;
  q.eq = (col: string, val: unknown) => {
    if (kind === "admin") state.adminEqs.push([col, val]);
    return q;
  };
  q.in = chain;
  q.limit = chain;
  q.update = (payload: unknown) => {
    writing = true;
    if (kind === "user") state.userUpdates.push(payload);
    else if (state.pendingMatch) state.adminUpdates.push(payload);
    return q;
  };
  q.maybeSingle = async () => {
    if (!writing) {
      return {
        data: state.callerActive
          ? {
              is_active: true,
              signup_type: null,
              department: null,
              status: "active",
              accepted_at: null,
              marital_status: null,
            }
          : {
              is_active: false,
              signup_type: null,
              department: null,
              status: "active",
              accepted_at: null,
              marital_status: null,
            },
        error: null,
      };
    }
    if (kind === "admin" && !state.pendingMatch) return { data: null, error: null };
    return {
      data: state.adminUpdateError ? null : { id: "target-1", status: "active" },
      error: kind === "admin" ? state.adminUpdateError : null,
    };
  };
  q.single = q.maybeSingle;
  q.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
    const result = writing
      ? { data: null, error: kind === "admin" ? state.adminUpdateError : null }
      : { data: [], error: null };
    return Promise.resolve(result).then(onFulfilled, onRejected);
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => builder("user"),
    rpc: async (name: string) => {
      if (state.rpcThrow) throw new Error("is_admin exploded");
      if (name === "is_admin") return { data: state.isAdmin, error: null };
      return { data: null, error: null };
    },
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
import { PERMISSION_DENIED_MESSAGE } from "@/lib/users/users-update-error";

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
  state.adminUpdateError = null;
  state.rpcThrow = false;
  state.callerActive = true;
  state.pendingMatch = true;
  state.adminEqs = [];
});

describe("POST /api/admin/approve-user", () => {
  it("403 for a non-admin and does not write", async () => {
    state.isAdmin = false;
    const res = await post({ user_id: "target-1", job_title: "Pastor" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: PERMISSION_DENIED_MESSAGE });
    expect(state.adminClientCalls).toBe(0);
    expect(state.userUpdates).toHaveLength(0);
    expect(state.adminUpdates).toHaveLength(0);
  });

  it("403 for a scoped admin (is_admin is false) with no writes", async () => {
    state.isAdmin = false;
    const res = await post({ user_id: "target-1", job_title: "Pastor" });
    expect(res.status).toBe(403);
    expect(state.adminClientCalls).toBe(0);
    expect(state.adminUpdates).toHaveLength(0);
    expect(state.userUpdates).toHaveLength(0);
  });

  it("403 when is_admin throws, with the permission message and no writes", async () => {
    state.rpcThrow = true;
    const res = await post({ user_id: "target-1", job_title: "Pastor" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: PERMISSION_DENIED_MESSAGE });
    expect(state.adminClientCalls).toBe(0);
    expect(state.adminUpdates).toHaveLength(0);
  });

  it("403 for a deactivated admin before any write", async () => {
    state.callerActive = false;
    const res = await post({ user_id: "target-1", job_title: "Pastor" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "This account is deactivated." });
    expect(state.adminClientCalls).toBe(0);
    expect(state.adminUpdates).toHaveLength(0);
  });

  it("400 when job_title is not text", async () => {
    const res = await post({ user_id: "target-1", job_title: 12 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Job title must be text." });
    expect(state.adminClientCalls).toBe(0);
    expect(state.adminUpdates).toHaveLength(0);
  });

  it("400 when job_title is longer than 120 characters", async () => {
    const res = await post({ user_id: "target-1", job_title: "x".repeat(121) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/120/);
    expect(state.adminUpdates).toHaveLength(0);
  });

  it("trims job_title before saving", async () => {
    const res = await post({ user_id: "target-1", job_title: "  Pastor  " });
    expect(res.status).toBe(200);
    expect(state.adminUpdates).toEqual([{ status: "active", job_title: "Pastor" }]);
  });

  it("409 when the target is not pending approval and changes no row", async () => {
    state.pendingMatch = false;
    const res = await post({ user_id: "target-1", job_title: "Pastor" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This user is not pending approval." });
    expect(state.adminUpdates).toHaveLength(0);
    expect(state.adminEqs).toEqual(
      expect.arrayContaining([
        ["id", "target-1"],
        ["status", "pending_approval"],
      ])
    );
    expect(state.userUpdates).toHaveLength(0);
  });

  it("writes status and job_title together on the service role", async () => {
    const res = await post({ user_id: "target-1", job_title: "Pastor" });
    expect(res.status).toBe(200);
    expect(state.adminUpdates).toEqual([{ status: "active", job_title: "Pastor" }]);
    expect(state.userUpdates).toHaveLength(0);
  });

  it("writes only status when no job title is sent", async () => {
    const res = await post({ user_id: "target-1" });
    expect(res.status).toBe(200);
    expect(state.adminUpdates).toEqual([{ status: "active" }]);
    expect(state.userUpdates).toHaveLength(0);
  });

  it("returns the update error without a second write after approval", async () => {
    state.adminUpdateError = { message: "update failed" };
    const res = await post({ user_id: "target-1", job_title: "Pastor" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "update failed" });
    expect(state.adminUpdates).toEqual([{ status: "active", job_title: "Pastor" }]);
    expect(state.userUpdates).toHaveLength(0);
  });

  it("401 when signed out", async () => {
    state.user = null;
    const res = await post({ user_id: "target-1", job_title: "Pastor" });
    expect(res.status).toBe(401);
    expect(state.adminClientCalls).toBe(0);
  });
});
