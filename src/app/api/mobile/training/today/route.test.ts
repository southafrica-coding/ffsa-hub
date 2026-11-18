import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/mobile/training/today: everything through the caller's own
// client; leader-only reads skipped when they manage no school; names via
// the service role; a failed optional read drops its line, not the screen.

const state = vi.hoisted(() => ({ user: { id: "daniel" } as { id: string } | null, manages: new Set<string>() }));
const userClient = { tag: "user" };
const adminClient = { tag: "admin" };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => userClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminClient }));
vi.mock("@/lib/api-auth", () => ({ getAuthedUser: async () => state.user }));
vi.mock("@/services/training", () => ({
  listVisibleEnrolments: vi.fn(async () => ({
    data: [{ id: "e-grace", user_id: "grace", program_id: "p1", status: "arrived", enrolled_at: null, programs: { name: "FFX", code: null } }],
    error: null,
  })),
  listActiveWalkers: vi.fn(async () => ({ data: [{ enrollment_id: "e-grace", user_id: "daniel" }], error: null })),
  listCheckins: vi.fn(async () => ({ data: [], error: null })),
  getNames: vi.fn(async () => ({ data: [{ id: "grace", first_name: "Grace", last_name: "M", preferred_name: null }], error: null })),
}));
vi.mock("@/services/training-today", () => ({
  myLedPrograms: vi.fn(async () => ({ data: [], error: null })),
  listDismissals: vi.fn(async () => ({ data: [], error: null })),
  listOpenCare: vi.fn(async () => ({ data: [], error: null })),
  managedPrograms: vi.fn(async () => state.manages),
  listUndecidedApplications: vi.fn(async () => ({ data: null, error: { message: "permission denied" } })),
  listPendingReferences: vi.fn(async () => ({ data: [], error: null })),
  listGradedArrivals: vi.fn(async () => ({ data: [], error: null })),
  listGrades: vi.fn(async () => ({ data: [], error: null })),
  listOverdueCharges: vi.fn(async () => ({ data: [], error: null })),
}));

import * as today from "@/services/training-today";
import * as training from "@/services/training";
import { GET } from "./route";

beforeEach(() => {
  state.user = { id: "daniel" };
  state.manages = new Set();
  vi.clearAllMocks();
});

describe("GET /api/mobile/training/today", () => {
  it("401 when signed out", async () => {
    state.user = null;
    expect((await GET()).status).toBe(401);
  });

  it("a walker gets their student, with no leader reads at all", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: { title: string }) => i.title)).toEqual(["Check in with Grace"]);
    expect(body.band).toBe(body.items[0].key);
    expect(today.listUndecidedApplications).not.toHaveBeenCalled();
    expect(vi.mocked(training.listVisibleEnrolments).mock.calls[0][0]).toBe(userClient);
    expect(vi.mocked(training.getNames).mock.calls[0][0]).toBe(adminClient);
  });

  it("a leader's refused optional read drops that line, not the screen", async () => {
    state.manages = new Set(["p1"]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(today.listUndecidedApplications).toHaveBeenCalledWith(userClient);
    expect(vi.mocked(today.listOverdueCharges).mock.calls[0][0]).toBe(userClient);
  });
});
