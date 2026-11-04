import { beforeEach, describe, expect, it, vi } from "vitest";
import { pushCategoryList, pushText, PUSH_KINDS, type PushKind } from "./categories";
import { createPushFake, filterArg, MISSING_COLUMN, MISSING_TABLE, type FakeOp, type FakeOut } from "./fake-db";
import { isMissingSchema } from "./schema-errors";
import {
  BATCH_SIZE,
  buildMessages,
  chunk,
  EXPO_PUSH_URL,
  filterOptedOut,
  sendPush,
  unregisteredTokens,
} from "./send";

// The push sender: who gets a push, what it says, how it's batched, and that
// it never throws into the request that called it.

const tok = (n: number) => `ExponentPushToken[tok${String(n).padStart(5, "0")}]`;

type World = {
  devices: { id: string; user_id: string; expo_token: string }[];
  active?: string[];
  mutes?: { user_id: string; push_muted_kinds: string[] }[];
  errors?: Partial<Record<"device_push_tokens" | "users" | "notification_preferences", unknown>>;
};

function fakeAdmin(world: World) {
  return createPushFake({
    resolve(op: FakeOp): FakeOut | undefined {
      const err = world.errors?.[op.table as keyof NonNullable<World["errors"]>];
      if (err && op.action === "select") return { error: err };
      if (op.table === "device_push_tokens" && op.action === "select") {
        const ids = filterArg(op, "in", "user_id") as string[];
        return { data: world.devices.filter((d) => ids.includes(d.user_id)) };
      }
      if (op.table === "users") {
        const ids = filterArg(op, "in", "id") as string[];
        const active = world.active ?? world.devices.map((d) => d.user_id);
        return { data: ids.filter((id) => active.includes(id)).map((id) => ({ id })) };
      }
      if (op.table === "notification_preferences") return { data: world.mutes ?? [] };
      return undefined;
    },
  });
}

/** fetch stand-in for the Expo push API: answers ok, or per-token errors. */
function expoFetch(opts: { gone?: string[]; status?: number; throws?: boolean } = {}) {
  const calls: { url: string; init: RequestInit; messages: { to: string }[] }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    const messages = JSON.parse(String(init.body));
    calls.push({ url, init, messages });
    if (opts.throws) throw new TypeError("fetch failed");
    if (opts.status && opts.status !== 200) return new Response("nope", { status: opts.status });
    const data = messages.map((m: { to: string }) =>
      opts.gone?.includes(m.to)
        ? { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }
        : { status: "ok", id: `ticket-${m.to}` }
    );
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const INPUT = { kind: "booking_request" as const, key: "booking:b1", href: "/bookings/requests" };

beforeEach(() => {
  delete process.env.EXPO_ACCESS_TOKEN;
});

// ── Pure helpers ─────────────────────────────────────────────

describe("generic text", () => {
  it("every kind has lock-screen-safe text and a category the app can switch off", () => {
    const categories = pushCategoryList().map((c) => c.key);
    for (const kind of Object.keys(PUSH_KINDS) as PushKind[]) {
      const { title, body } = pushText(kind);
      expect(title.length).toBeGreaterThan(0);
      expect(title.length).toBeLessThanOrEqual(40);
      expect(body.length).toBeLessThanOrEqual(120);
      // No placeholders, numbers (amounts) or currency.
      expect(`${title} ${body}`).not.toMatch(/[{}$€£]|\bR\s?\d|\d/);
      expect(categories).toContain(PUSH_KINDS[kind]);
    }
  });

  it("messages carry the kind's text whatever the caller knows", () => {
    const [m] = buildMessages([{ expo_token: tok(1) }], INPUT);
    expect(m).toEqual({
      to: tok(1),
      title: pushText("booking_request").title,
      body: pushText("booking_request").body,
      data: { href: "/bookings/requests", kind: "booking_request", key: "booking:b1" },
      channelId: "booking_requests",
      priority: "default",
    });
    expect(m).not.toHaveProperty("sound");
  });
});

describe("chunk", () => {
  it("splits into batches of at most 100", () => {
    const sizes = chunk(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length);
    expect(BATCH_SIZE).toBe(100);
    expect(sizes).toEqual([100, 100, 50]);
    expect(chunk([])).toEqual([]);
  });
});

describe("filterOptedOut", () => {
  it("drops users who muted the kind's category, keeps everyone else", () => {
    const mutes = [
      { user_id: "a", push_muted_kinds: ["booking_requests"] },
      { user_id: "b", push_muted_kinds: ["booking_updates"] },
      { user_id: "c", push_muted_kinds: null as unknown as string[] },
    ];
    expect(filterOptedOut(["a", "b", "c", "d"], "booking_request", mutes)).toEqual(["b", "c", "d"]);
    expect(filterOptedOut(["a", "b"], "booking_decision", mutes)).toEqual(["a"]);
  });
});

describe("unregisteredTokens", () => {
  it("matches tickets to messages by position", () => {
    const msgs = buildMessages([{ expo_token: tok(1) }, { expo_token: tok(2) }, { expo_token: tok(3) }], INPUT);
    const tickets = [
      { status: "ok" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
      { status: "error", details: { error: "MessageRateExceeded" } },
    ];
    expect(unregisteredTokens(msgs, tickets)).toEqual([tok(2)]);
  });
});

describe("isMissingSchema", () => {
  it("recognises a missing table or column, and nothing else", () => {
    expect(isMissingSchema(MISSING_TABLE)).toBe(true);
    expect(isMissingSchema(MISSING_COLUMN)).toBe(true);
    expect(isMissingSchema({ code: "42P01", message: 'relation "x" does not exist' })).toBe(true);
    expect(isMissingSchema({ code: "23505", message: "duplicate" })).toBe(false);
    expect(isMissingSchema(null)).toBe(false);
  });
});

// ── sendPush ─────────────────────────────────────────────────

describe("sendPush", () => {
  it("table missing (migration 288 not applied): silent no-op, no request to Expo", async () => {
    const admin = fakeAdmin({ devices: [], errors: { device_push_tokens: MISSING_TABLE } });
    const expo = expoFetch();
    const res = await sendPush(["a"], INPUT, { admin: admin.client, fetchImpl: expo.impl });
    expect(res).toEqual({ skipped: "not_enabled", sent: 0, failed: 0, revoked: 0 });
    expect(expo.calls).toEqual([]);
  });

  it("table present: one message per live phone, generic text, POSTed to Expo", async () => {
    const admin = fakeAdmin({
      devices: [
        { id: "1", user_id: "a", expo_token: tok(1) },
        { id: "2", user_id: "a", expo_token: tok(2) },
        { id: "3", user_id: "b", expo_token: tok(3) },
      ],
    });
    const expo = expoFetch();
    const res = await sendPush(["a", "b", "a", ""], INPUT, { admin: admin.client, fetchImpl: expo.impl });
    expect(res).toEqual({ sent: 3, failed: 0, revoked: 0 });
    expect(expo.calls).toHaveLength(1);
    expect(expo.calls[0].url).toBe(EXPO_PUSH_URL);
    expect(expo.calls[0].messages.map((m) => m.to)).toEqual([tok(1), tok(2), tok(3)]);
    expect(new Headers(expo.calls[0].init.headers).get("authorization")).toBeNull();
    // Only live tokens were asked for.
    const read = admin.ops.find((o) => o.table === "device_push_tokens")!;
    expect(filterArg(read, "is", "revoked_at")).toBeNull();
  });

  it("sends EXPO_ACCESS_TOKEN as a bearer token when set", async () => {
    process.env.EXPO_ACCESS_TOKEN = "placeholder-not-real";
    const admin = fakeAdmin({ devices: [{ id: "1", user_id: "a", expo_token: tok(1) }] });
    const expo = expoFetch();
    await sendPush(["a"], INPUT, { admin: admin.client, fetchImpl: expo.impl });
    expect(new Headers(expo.calls[0].init.headers).get("authorization")).toBe("Bearer placeholder-not-real");
  });

  it("batches 230 phones into requests of 100, 100 and 30", async () => {
    const devices = Array.from({ length: 230 }, (_, i) => ({ id: `${i}`, user_id: `u${i}`, expo_token: tok(i) }));
    const admin = fakeAdmin({ devices });
    const expo = expoFetch();
    const res = await sendPush(devices.map((d) => d.user_id), INPUT, { admin: admin.client, fetchImpl: expo.impl });
    expect(expo.calls.map((c) => c.messages.length)).toEqual([100, 100, 30]);
    expect(res.sent).toBe(230);
  });

  it("honours opt-outs and skips deactivated users", async () => {
    const admin = fakeAdmin({
      devices: [
        { id: "1", user_id: "a", expo_token: tok(1) },
        { id: "2", user_id: "b", expo_token: tok(2) },
        { id: "3", user_id: "c", expo_token: tok(3) },
      ],
      active: ["a", "b"],
      mutes: [{ user_id: "b", push_muted_kinds: ["booking_requests"] }],
    });
    const expo = expoFetch();
    const res = await sendPush(["a", "b", "c"], INPUT, { admin: admin.client, fetchImpl: expo.impl });
    expect(expo.calls[0].messages.map((m) => m.to)).toEqual([tok(1)]);
    expect(res.sent).toBe(1);
  });

  it("everyone opted out: no request at all", async () => {
    const admin = fakeAdmin({
      devices: [{ id: "1", user_id: "a", expo_token: tok(1) }],
      mutes: [{ user_id: "a", push_muted_kinds: ["booking_requests"] }],
    });
    const expo = expoFetch();
    const res = await sendPush(["a"], INPUT, { admin: admin.client, fetchImpl: expo.impl });
    expect(res.skipped).toBe("no_recipients");
    expect(expo.calls).toEqual([]);
  });

  it("can't read opt-outs (other error): sends nothing rather than risk it", async () => {
    const admin = fakeAdmin({
      devices: [{ id: "1", user_id: "a", expo_token: tok(1) }],
      errors: { notification_preferences: { code: "XX000", message: "boom" } },
    });
    const expo = expoFetch();
    expect((await sendPush(["a"], INPUT, { admin: admin.client, fetchImpl: expo.impl })).skipped).toBe("error");
    expect(expo.calls).toEqual([]);
  });

  it("revokes tokens Expo reports as DeviceNotRegistered", async () => {
    const admin = fakeAdmin({
      devices: [
        { id: "1", user_id: "a", expo_token: tok(1) },
        { id: "2", user_id: "b", expo_token: tok(2) },
      ],
    });
    const expo = expoFetch({ gone: [tok(2)] });
    const res = await sendPush(["a", "b"], INPUT, { admin: admin.client, fetchImpl: expo.impl });
    expect(res).toEqual({ sent: 1, failed: 1, revoked: 1 });
    const revoke = admin.ops.find((o) => o.action === "update")!;
    expect(revoke.table).toBe("device_push_tokens");
    expect(filterArg(revoke, "in", "expo_token")).toEqual([tok(2)]);
  });

  it.each([
    ["the network fails", { throws: true }],
    ["Expo answers 500", { status: 500 }],
  ])("never throws when %s", async (_label, opts) => {
    const admin = fakeAdmin({ devices: [{ id: "1", user_id: "a", expo_token: tok(1) }] });
    const expo = expoFetch(opts);
    const res = await sendPush(["a"], INPUT, { admin: admin.client, fetchImpl: expo.impl });
    expect(res).toEqual({ sent: 0, failed: 1, revoked: 0 });
  });

  it("never throws even if the database client itself throws", async () => {
    const admin = { from: () => { throw new Error("kaboom"); } };
    await expect(sendPush(["a"], INPUT, { admin })).resolves.toMatchObject({ skipped: "error" });
  });

  it("no service-role config: not_configured, no throw", async () => {
    const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(sendPush(["a"], INPUT)).resolves.toMatchObject({ skipped: "not_configured" });
    if (prev !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
  });

  it("no recipients: nothing happens", async () => {
    await expect(sendPush([], INPUT)).resolves.toMatchObject({ skipped: "no_recipients" });
  });
});
