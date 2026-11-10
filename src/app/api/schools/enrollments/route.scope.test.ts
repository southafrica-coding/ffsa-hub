import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeQuery } from "@/lib/testing/fake-supabase";

const updateEnrollmentStatus = vi.hoisted(() => vi.fn(async () => ({ data: { id: "e" }, error: null })));
const setEnrollmentRemoved = vi.hoisted(() => vi.fn(async () => ({ data: { id: "e" }, error: null })));
const deleteEnrollment = vi.hoisted(() => vi.fn(async () => ({ error: null })));

const state = vi.hoisted(() => ({
  user: null as ReturnType<typeof createFakeSupabase>["client"] | null,
  rows: [] as Array<{ id: string; program_id: string; removed_at: string | null }>,
  error: false,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.user }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const selected: { ids?: string[] } = {};
      const q: Record<string, unknown> = {
        select() { return q; },
        in(_col: string, ids: string[]) { selected.ids = ids; return q; },
        eq() { return q; },
        insert() { return Promise.resolve({ error: null }); },
        single() { return Promise.resolve(payload()); },
        then(resolve: (v: unknown) => unknown) { return Promise.resolve(payload()).then(resolve); },
      };
      function payload() {
        if (state.error) return { data: null, error: { message: "boom" } };
        const data = state.rows.filter((row) => !selected.ids || selected.ids.includes(row.id));
        return { data, error: null };
      }
      return q;
    },
  }),
}));
vi.mock("@/services/schools", () => ({
  createEnrollment: vi.fn(),
  updateEnrollmentStatus,
  setEnrollmentRemoved,
  deleteEnrollment,
}));
vi.mock("@/lib/auth/membership-roles", () => ({
  deactivateMembershipProfile: vi.fn(async () => {}),
}));

import { DELETE, PATCH, PUT } from "./route";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function leader(active = true) {
  state.user = createFakeSupabase({
    user: { id: "u" },
    resolve: (q: FakeQuery) => {
      if (q.table === "users") return { data: { is_active: active } };
      if (q.table === "user_roles") {
        return { data: [{ scope_type: "program", scope_id: A, roles: { name: "program_leader" } }] };
      }
      return { data: [] };
    },
  }).client;
}

function req(method: string, body: unknown) {
  return new Request("http://localhost/api/schools/enrollments", {
    method,
    body: JSON.stringify(body),
  });
}

describe("enrollment roster gates", () => {
  beforeEach(() => {
    state.error = false;
    state.rows = [
      { id: "own", program_id: A, removed_at: "2026-01-01" },
      { id: "other", program_id: B, removed_at: "2026-01-01" },
    ];
    updateEnrollmentStatus.mockClear();
    setEnrollmentRemoved.mockClear();
    deleteEnrollment.mockClear();
    leader();
  });

  it("lets a scoped leader dismiss a student in their program", async () => {
    const res = await PUT(req("PUT", { id: "own", status: "dismissed" }));
    expect(res.status).toBe(200);
    expect(updateEnrollmentStatus).toHaveBeenCalled();
  });

  it("refuses a student in another program", async () => {
    const res = await PUT(req("PUT", { id: "other", status: "dismissed" }));
    expect(res.status).toBe(403);
    expect(updateEnrollmentStatus).not.toHaveBeenCalled();
  });

  it("refuses a mixed batch", async () => {
    const res = await PATCH(req("PATCH", { id: "own", ids: ["own", "other"], removed: true }));
    expect(res.status).toBe(403);
    expect(setEnrollmentRemoved).not.toHaveBeenCalled();
  });

  it("refuses a deactivated leader", async () => {
    leader(false);
    const res = await DELETE(req("DELETE", { id: "own" }));
    expect(res.status).toBe(403);
    expect(deleteEnrollment).not.toHaveBeenCalled();
  });

  it("refuses when the enrollment lookup errors", async () => {
    state.error = true;
    const res = await PUT(req("PUT", { id: "own", status: "dismissed" }));
    expect(res.status).toBe(403);
    expect(updateEnrollmentStatus).not.toHaveBeenCalled();
  });
});
