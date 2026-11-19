import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPushFake, filterArg, MISSING_COLUMN, type FakeOp, type FakeOut } from "@/lib/push/fake-db";

// GET / PUT /api/devices/preferences — phone-push category opt-outs on the
// caller's own notification_preferences row (RLS client only).

const h = vi.hoisted(() => ({
  answer: (() => undefined) as (op: FakeOp) => FakeOut | undefined,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: null as any,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.user.client }));

const { GET, PUT } = await import("./route");

const put = (body: unknown) =>
  PUT(new Request("http://localhost/api/devices/preferences", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => {
  h.answer = () => undefined;
  h.user = createPushFake({ userId: "u1", resolve: (op) => h.answer(op) });
});

describe("GET /api/devices/preferences", () => {
  it("401 when signed out", async () => {
    h.user = createPushFake({ userId: null });
    expect((await GET()).status).toBe(401);
  });

  it("lists the categories and the caller's mutes (unknown keys dropped)", async () => {
    h.answer = () => ({ data: { push_muted_kinds: ["booking_requests", "old_thing"] } });
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.muted).toEqual(["booking_requests"]);
    expect(json.categories.map((c: { key: string }) => c.key)).toEqual(["booking_requests", "booking_updates", "training_care", "training_week"]);
    expect(filterArg(h.user.ops[0], "eq", "user_id")).toBe("u1");
  });

  it("no prefs row yet = nothing muted", async () => {
    const json = await (await GET()).json();
    expect(json.muted).toEqual([]);
  });

  it("503 push_not_enabled while the column doesn't exist", async () => {
    h.answer = () => ({ error: MISSING_COLUMN });
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("push_not_enabled");
  });

  it("500 on other errors", async () => {
    h.answer = () => ({ error: { code: "XX000", message: "boom" } });
    expect((await GET()).status).toBe(500);
  });
});

describe("PUT /api/devices/preferences", () => {
  it("401 when signed out", async () => {
    h.user = createPushFake({ userId: null });
    expect((await put({ muted: [] })).status).toBe(401);
  });

  it.each([[{}], [{ muted: "booking_requests" }], [{ muted: [1] }]])("400 for %j", async (body) => {
    expect((await put(body)).status).toBe(400);
    expect(h.user.ops).toEqual([]);
  });

  it("writes only the push column on the caller's own row, dropping unknown keys", async () => {
    const res = await put({ muted: ["booking_updates", "booking_updates", "junk"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, muted: ["booking_updates"] });
    const op = h.user.ops[0];
    expect(op.action).toBe("upsert");
    expect(op.table).toBe("notification_preferences");
    expect(op.payload).toEqual({ user_id: "u1", push_muted_kinds: ["booking_updates"] });
    expect(op.options).toEqual({ onConflict: "user_id" });
  });

  it("503 push_not_enabled while the column doesn't exist", async () => {
    h.answer = () => ({ error: MISSING_COLUMN });
    const res = await put({ muted: [] });
    expect(res.status).toBe(503);
  });
});
