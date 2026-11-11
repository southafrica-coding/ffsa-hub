import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, filterValue, type FakeQuery } from "@/lib/testing/fake-supabase";

// GET is new (for the phone app); PUT is the website's existing toggle.

const state = vi.hoisted(() => ({
  fake: null as unknown as ReturnType<typeof import("@/lib/testing/fake-supabase").createFakeSupabase>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.fake.client,
}));

import { GET, PUT } from "./route";

function world(opts: { user?: { id: string } | null; muted?: string[] | null; row?: boolean; error?: string }) {
  state.fake = createFakeSupabase({
    user: opts.user === undefined ? { id: "me" } : opts.user,
    resolve: (q: FakeQuery) => {
      if (q.table !== "notification_preferences") return { data: [] };
      if (opts.error) return { error: { message: opts.error } };
      if (opts.row === false) return { data: null };
      return { data: { muted_modules: opts.muted ?? [] } };
    },
  });
}

describe("GET /api/profile/notification-preferences", () => {
  beforeEach(() => world({}));

  it("401 when not signed in", async () => {
    world({ user: null });
    expect((await GET()).status).toBe(401);
  });

  it("lists the mutable modules and the caller's mutes (unknown keys dropped)", async () => {
    world({ muted: ["prayer_room", "retired_module"] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.mutedModules).toEqual(["prayer_room"]);
    expect(body.modules).toContainEqual({
      key: "prayer_room",
      label: "Prayer room",
      description: expect.any(String),
    });
    const q = state.fake.queries.find((x) => x.table === "notification_preferences")!;
    expect(filterValue(q, "eq", "user_id")).toBe("me");
  });

  it("no prefs row yet → nothing muted", async () => {
    world({ row: false });
    expect((await (await GET()).json()).mutedModules).toEqual([]);
  });

  it("500 with a plain message when the read fails", async () => {
    world({ error: "boom" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET();
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Couldn't load/);
  });
});

describe("PUT /api/profile/notification-preferences (unchanged)", () => {
  beforeEach(() => world({}));

  it("400 on a bad body", async () => {
    const res = await PUT(new Request("https://hub.test/x", { method: "PUT", body: JSON.stringify({ mutedModules: "x" }) }));
    expect(res.status).toBe(400);
  });
});
