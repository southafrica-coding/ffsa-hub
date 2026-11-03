import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPushFake, filterArg, MISSING_TABLE, type FakeOp, type FakeOut } from "@/lib/push/fake-db";

// POST / DELETE /api/devices — the phone app registering and revoking its
// push token. `user` is the caller's own (RLS) client, `admin` the service
// role. Both are recording fakes; `answer` decides what each query returns.

const h = vi.hoisted(() => ({
  callerId: "u1" as string | null,
  answer: (() => undefined) as (op: FakeOp, who: "user" | "admin") => FakeOut | undefined,
  adminThrows: false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: null as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: null as any,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.user.client }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (h.adminThrows) throw new Error("Missing Supabase admin environment variables");
    return h.admin.client;
  },
}));

const { POST, DELETE } = await import("./route");

const TOKEN = "ExponentPushToken[abcdEFGH1234_-xyz]";
const good = { expoToken: TOKEN, platform: "ios", appVersion: "1.0.0", deviceName: "Jo's iPhone" };

function call(method: "POST" | "DELETE", body: unknown) {
  const req = new Request("http://localhost/api/devices", {
    method,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return method === "POST" ? POST(req) : DELETE(req);
}

beforeEach(() => {
  h.callerId = "u1";
  h.adminThrows = false;
  h.answer = () => undefined;
  h.user = createPushFake({ userId: "u1", resolve: (op) => h.answer(op, "user") });
  h.admin = createPushFake({ userId: null, resolve: (op) => h.answer(op, "admin") });
});

describe("POST /api/devices", () => {
  it("401 when signed out, and writes nothing", async () => {
    h.user = createPushFake({ userId: null });
    const res = await call("POST", good);
    expect(res.status).toBe(401);
    expect(h.admin.ops).toEqual([]);
  });

  it.each([
    ["not JSON", "{nope"],
    ["missing token", { ...good, expoToken: undefined }],
    ["not an Expo token", { ...good, expoToken: "abc" }],
    ["unknown platform", { ...good, platform: "web" }],
    ["empty version", { ...good, appVersion: " " }],
    ["over-long device name", { ...good, deviceName: "x".repeat(101) }],
  ])("400 for %s", async (_label, body) => {
    const res = await call("POST", body);
    expect(res.status).toBe(400);
    expect(h.admin.ops).toEqual([]);
  });

  it("upserts on the token for the CALLER, un-revoking it (re-assigns a phone that changed hands)", async () => {
    h.answer = (op) => (op.action === "upsert" ? { data: { id: "d1" } } : undefined);
    const res = await call("POST", { ...good, user_id: "someone-else" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const up = h.admin.ops.find((o: FakeOp) => o.action === "upsert");
    expect(up.table).toBe("device_push_tokens");
    expect(up.options).toEqual({ onConflict: "expo_token" });
    expect(up.payload).toMatchObject({
      user_id: "u1",
      expo_token: TOKEN,
      platform: "ios",
      app_version: "1.0.0",
      device_name: "Jo's iPhone",
      revoked_at: null,
    });
  });

  it("accepts the older ExpoPushToken[...] form and no device name", async () => {
    const res = await call("POST", { ...good, expoToken: "ExpoPushToken[abcdefgh12]", deviceName: undefined });
    expect(res.status).toBe(200);
    expect(h.admin.ops[0].payload).toMatchObject({ device_name: null });
  });

  it("503 push_not_enabled while the table doesn't exist (migration 288 not applied)", async () => {
    h.answer = () => ({ error: MISSING_TABLE });
    const res = await call("POST", good);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("push_not_enabled");
  });

  it("503 push_not_enabled when the server has no service-role config", async () => {
    h.adminThrows = true;
    const res = await call("POST", good);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("push_not_enabled");
  });

  it("500 with a plain message on other database errors", async () => {
    h.answer = () => ({ error: { code: "23514", message: "check violation" } });
    const res = await call("POST", good);
    expect(res.status).toBe(500);
    expect((await res.json()).message).toMatch(/Couldn't register this phone/);
  });
});

describe("DELETE /api/devices", () => {
  it("401 when signed out", async () => {
    h.user = createPushFake({ userId: null });
    expect((await call("DELETE", { expoToken: TOKEN })).status).toBe(401);
  });

  it("400 for a bad token", async () => {
    expect((await call("DELETE", { expoToken: "x" })).status).toBe(400);
    expect(h.user.ops).toEqual([]);
  });

  it("revokes only the caller's own row, on the caller's own client", async () => {
    h.answer = (op) => (op.action === "update" ? { data: [{ id: "d1" }] } : undefined);
    const res = await call("DELETE", { expoToken: TOKEN });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revoked: 1 });
    expect(h.admin.ops).toEqual([]);
    const upd = h.user.ops[0];
    expect(upd.table).toBe("device_push_tokens");
    expect(upd.action).toBe("update");
    expect(filterArg(upd, "eq", "user_id")).toBe("u1");
    expect(filterArg(upd, "eq", "expo_token")).toBe(TOKEN);
    expect((upd.payload as { revoked_at: string }).revoked_at).toEqual(expect.any(String));
  });

  it("someone else's token: nothing matches, still ok (revoked 0)", async () => {
    h.answer = () => ({ data: [] });
    const res = await call("DELETE", { expoToken: TOKEN });
    expect(await res.json()).toEqual({ ok: true, revoked: 0 });
  });

  it("503 push_not_enabled while the table doesn't exist", async () => {
    h.answer = () => ({ error: MISSING_TABLE });
    const res = await call("DELETE", { expoToken: TOKEN });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("push_not_enabled");
  });
});
