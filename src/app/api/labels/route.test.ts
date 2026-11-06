import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  permissionWorldResolver,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

// POST /api/labels used to accept any signed-in user. It now uses the same
// communications write gate as label rename/delete: canManageComms with
// communications.manage_labels (roles: super_admin, admin, comms_admin).

const state = vi.hoisted(() => ({
  client: null as unknown,
  creates: [] as Array<Record<string, unknown>>,
  revalidated: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.client,
}));
vi.mock("@/services/labels", () => ({
  findOrCreateLabel: async (_client: unknown, args: Record<string, unknown>) => {
    state.creates.push(args);
    return {
      data: { id: "lab-1", name: args.name, slug: args.slug },
      error: null,
    };
  },
}));
vi.mock("@/lib/cached-reads", () => ({
  revalidateLabelsCache: () => {
    state.revalidated += 1;
  },
}));

import { POST } from "./route";

function as(world: PermissionWorld | null) {
  const fake = createFakeSupabase({
    user: world ? { id: "u1" } : null,
    resolve: (q) => (world ? permissionWorldResolver(world)(q) : null) ?? { data: [] },
  });
  state.client = fake.client;
}

const role = (name: string): PermissionWorld => ({
  roles: [{ id: `r-${name}`, name }],
  direct: [],
});

const post = (body: unknown) =>
  POST(
    new Request("https://hub.test/api/labels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  state.creates = [];
  state.revalidated = 0;
});

describe("POST /api/labels", () => {
  it("401 when not signed in", async () => {
    as(null);
    const res = await post({ name: "Welcome team" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authenticated" });
    expect(state.creates).toEqual([]);
    expect(state.revalidated).toBe(0);
  });

  it("403 for a signed-in caller without communications manage", async () => {
    as(role("staff"));
    const res = await post({ name: "Welcome team" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Not authorized" });
    expect(state.creates).toEqual([]);
    expect(state.revalidated).toBe(0);
  });

  it("403 for a communications permission that is not label manage", async () => {
    as({
      roles: [],
      direct: [{ module: "communications", key: "communications.send_emails" }],
    });
    const res = await post({ name: "Welcome team" });
    expect(res.status).toBe(403);
    expect(state.creates).toEqual([]);
  });

  it("a comms manager can create a label", async () => {
    as(role("comms_admin"));
    const res = await post({ name: "Welcome team", category: "outreach" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "lab-1",
      name: "Welcome team",
      slug: "welcome-team",
    });
    expect(state.creates).toEqual([
      {
        slug: "welcome-team",
        name: "Welcome team",
        createdBy: "u1",
        category: "outreach",
      },
    ]);
    expect(state.revalidated).toBe(1);
  });

  it("admin, super_admin, and a manage_labels grant can create a label", async () => {
    for (const world of [
      role("admin"),
      role("super_admin"),
      {
        roles: [],
        direct: [{ module: "communications", key: "communications.manage_labels" }],
      } satisfies PermissionWorld,
    ]) {
      state.creates = [];
      as(world);
      expect((await post({ name: "Night watch" })).status).toBe(200);
      expect(state.creates).toHaveLength(1);
    }
  });
});
