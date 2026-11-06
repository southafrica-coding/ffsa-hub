import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFakeSupabase,
  permissionWorldResolver,
  type FakeQuery,
  type PermissionWorld,
} from "@/lib/testing/fake-supabase";

// Only the "Finance organisation" field (migrations 290, 291) is covered here.

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("@/lib/testing/fake-supabase").createFakeSupabase>,
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.fake.client }));
vi.mock("@/services/event-labels", () => ({ setEventLabels: async () => ({ error: null }) }));
vi.mock("@/services/events", () => ({
  updateEvent: async (_s: unknown, id: string, patch: Record<string, unknown>) => {
    state.updates.push({ id, patch });
    return { data: { id, ...patch }, error: null };
  },
}));

import { PATCH } from "./route";

const ORGS = [
  { id: "org-npc", key: "npc", name: "FFSA NPC", record_currency: "ZAR", is_active: true },
  { id: "org-usa", key: "usa", name: "FF USA Inc", record_currency: "USD", is_active: true },
];

function world(access: PermissionWorld) {
  state.fake = createFakeSupabase({
    user: { id: "me" },
    resolve: (q: FakeQuery) => {
      if (q.rpc?.name === "finance_org_choices") return { data: ORGS };
      return permissionWorldResolver(access)(q) ?? { data: [] };
    },
  });
}

const call = (body: unknown) =>
  PATCH(new Request("http://x/api/events/e1", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "e1" }),
  });

describe("PATCH /api/events/[id] — finance organisation", () => {
  beforeEach(() => {
    state.updates = [];
    world({ roles: [{ id: "r", name: "events_admin" }], direct: [] });
  });

  it("an events admin can set one of the two orgs", async () => {
    expect((await call({ finance_org_id: "org-usa" })).status).toBe(200);
    expect(state.updates).toEqual([{ id: "e1", patch: { finance_org_id: "org-usa" } }]);
  });

  it("can clear it back to 'not chosen yet'", async () => {
    expect((await call({ finance_org_id: null })).status).toBe(200);
    expect(state.updates[0].patch).toEqual({ finance_org_id: null });
  });

  it("rejects an id that isn't one of the orgs", async () => {
    expect((await call({ finance_org_id: "made-up" })).status).toBe(400);
    expect((await call({ finance_org_id: 42 })).status).toBe(400);
    expect(state.updates).toEqual([]);
  });

  it("403 for someone who can't edit events", async () => {
    world({ roles: [{ id: "r", name: "staff" }], direct: [] });
    expect((await call({ finance_org_id: "org-npc" })).status).toBe(403);
    expect(state.updates).toEqual([]);
  });
});
