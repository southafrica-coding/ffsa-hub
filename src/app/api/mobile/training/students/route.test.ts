import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/mobile/training/students: enrolments, walkers and check-ins come
// from the caller's own client (RLS decides); the service role is used only
// for names of those people.

const state = vi.hoisted(() => ({ user: { id: "daniel" } as { id: string } | null }));
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
  getNames: vi.fn(async () => ({
    data: [
      { id: "grace", first_name: "Grace", last_name: "Mwangi", preferred_name: null },
      { id: "daniel", first_name: "Daniel", last_name: "P", preferred_name: null },
    ],
    error: null,
  })),
}));

import * as services from "@/services/training";
import { GET } from "./route";

beforeEach(() => {
  state.user = { id: "daniel" };
  vi.clearAllMocks();
});

describe("GET /api/mobile/training/students", () => {
  it("401 when signed out", async () => {
    state.user = null;
    expect((await GET()).status).toBe(401);
  });

  it("reads people through RLS and names through the service role", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(vi.mocked(services.listVisibleEnrolments).mock.calls[0][0]).toBe(userClient);
    expect(vi.mocked(services.listActiveWalkers).mock.calls[0][0]).toBe(userClient);
    expect(vi.mocked(services.listCheckins).mock.calls[0][0]).toBe(userClient);
    expect(vi.mocked(services.getNames).mock.calls[0][0]).toBe(adminClient);
    const body = await res.json();
    expect(body.students).toEqual([
      expect.objectContaining({ enrollmentId: "e-grace", name: "Grace Mwangi", status: "no_checkin", walkingWithMe: true }),
    ]);
  });
});
