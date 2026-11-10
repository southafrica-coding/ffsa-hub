import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, permissionWorldResolver, type PermissionWorld } from "@/lib/testing/fake-supabase";

const createProgram = vi.hoisted(() => vi.fn(async () => ({ data: { id: "new" }, error: null })));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
}));
vi.mock("@/services/schools", () => ({
  createProgram,
  updateProgram: vi.fn(),
  deleteProgram: vi.fn(),
  seedDefaultReferenceQuestions: vi.fn(async () => ({})),
}));

const state = vi.hoisted(() => ({
  client: null as unknown as ReturnType<typeof createFakeSupabase>["client"],
}));

import { POST } from "./route";

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function useWorld(world: PermissionWorld) {
  state.client = createFakeSupabase({
    user: { id: "u" },
    resolve: (q) => permissionWorldResolver(world)(q) ?? { data: [] },
  }).client;
}

function post() {
  return new Request("http://localhost/api/schools/programs", {
    method: "POST",
    body: JSON.stringify({ name: "DTS", code: "DTS" }),
  });
}

describe("POST /api/schools/programs", () => {
  beforeEach(() => {
    createProgram.mockClear();
  });

  it("creates a program for an unscoped schools grant", async () => {
    useWorld({ roles: [], direct: [{ module: "schools", key: "schools.manage" }] });
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(createProgram).toHaveBeenCalledOnce();
  });

  it("denies a program-scoped leader", async () => {
    useWorld({
      roles: [{ id: "pl", name: "program_leader", scopeType: "program", scopeId: A }],
      direct: [{ module: "schools", key: "schools.manage", scopeType: "program", scopeId: A }],
      bundles: { pl: [{ module: "schools", key: "schools.manage" }] },
    });
    const res = await POST(post());
    expect(res.status).toBe(403);
    expect(createProgram).not.toHaveBeenCalled();
  });

  it("denies a user whose only schools grant is assignable_as_contact", async () => {
    useWorld({
      roles: [],
      direct: [{ module: "schools", key: "schools.assignable_as_contact" }],
    });
    const res = await POST(post());
    expect(res.status).toBe(403);
    expect(createProgram).not.toHaveBeenCalled();
  });
});
