import { describe, it, expect, vi } from "vitest";
import {
  DbRateLimiter,
  FallbackRateLimiter,
  hashRateLimitKey,
  InMemoryRateLimiter,
  retryAfterSeconds,
  type RateLimiter,
} from "@/lib/rate-limit";

const OPTS = { limit: 3, windowSeconds: 60 };

describe("InMemoryRateLimiter (fake clock)", () => {
  it("allows `limit` hits per window, then refuses until the window resets", async () => {
    let now = Date.UTC(2026, 10, 2, 8, 0, 0); // on a minute boundary
    const limiter = new InMemoryRateLimiter(() => now);

    const results = [];
    for (let i = 0; i < 4; i++) results.push(await limiter.hit("k", OPTS));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[0].resetAt.getTime()).toBe(now + 60_000);

    now += 59_999;
    expect((await limiter.hit("k", OPTS)).allowed).toBe(false);
    now += 1;
    expect((await limiter.hit("k", OPTS)).allowed).toBe(true);
  });

  it("windows align to the clock, like the SQL function", async () => {
    const now = Date.UTC(2026, 10, 2, 8, 0, 45);
    const limiter = new InMemoryRateLimiter(() => now);
    const r = await limiter.hit("k", OPTS);
    expect(r.resetAt.toISOString()).toBe("2026-11-02T08:01:00.000Z");
  });

  it("counts keys separately", async () => {
    const limiter = new InMemoryRateLimiter(() => 0);
    for (let i = 0; i < 3; i++) await limiter.hit("a", OPTS);
    expect((await limiter.hit("a", OPTS)).allowed).toBe(false);
    expect((await limiter.hit("b", OPTS)).allowed).toBe(true);
  });

  it("stays bounded when sprayed with unique keys", async () => {
    const limiter = new InMemoryRateLimiter(() => 0, 100);
    for (let i = 0; i < 1000; i++) await limiter.hit(`k${i}`, OPTS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((limiter as any).hits.size).toBeLessThanOrEqual(100);
  });
});

// A fake database that implements rate_limit_hit() the way migration 280 does.
function fakeDb(clock: () => number) {
  const rows = new Map<string, number>();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: vi.fn(async (name: string, args: { p_key: string; p_limit: number; p_window_seconds: number }) => {
      calls.push({ name, args });
      const size = args.p_window_seconds * 1000;
      const start = Math.floor(clock() / size) * size;
      const k = `${args.p_key}|${start}`;
      const count = (rows.get(k) ?? 0) + 1;
      rows.set(k, count);
      return {
        data: [
          {
            allowed: count <= args.p_limit,
            remaining: Math.max(args.p_limit - count, 0),
            reset_at: new Date(start + size).toISOString(),
          },
        ],
        error: null,
      };
    }),
  };
  return { client, calls };
}

describe("DbRateLimiter", () => {
  it("calls rate_limit_hit with a hashed key and maps the row", async () => {
    let now = Date.UTC(2026, 10, 2, 8, 0, 0);
    const db = fakeDb(() => now);
    const limiter = new DbRateLimiter(() => db.client);

    const r = await limiter.hit("scan:token:1.2.3.4", OPTS);
    expect(r).toEqual({ allowed: true, remaining: 2, resetAt: new Date(now + 60_000) });
    expect(db.calls[0].name).toBe("rate_limit_hit");
    expect(db.calls[0].args).toEqual({
      p_key: await hashRateLimitKey("scan:token:1.2.3.4"),
      p_limit: 3,
      p_window_seconds: 60,
    });
    // The raw token / IP never reach the database.
    expect(String(db.calls[0].args.p_key)).not.toContain("token");
    expect(String(db.calls[0].args.p_key)).toMatch(/^[0-9a-f]{64}$/);

    await limiter.hit("scan:token:1.2.3.4", OPTS);
    await limiter.hit("scan:token:1.2.3.4", OPTS);
    expect((await limiter.hit("scan:token:1.2.3.4", OPTS)).allowed).toBe(false);
    now += 60_000;
    expect((await limiter.hit("scan:token:1.2.3.4", OPTS)).allowed).toBe(true);
  });

  it("throws on an RPC error (e.g. the function doesn't exist yet)", async () => {
    const limiter = new DbRateLimiter(() => ({
      rpc: async () => ({ data: null, error: { message: "function public.rate_limit_hit does not exist" } }),
    }));
    await expect(limiter.hit("k", OPTS)).rejects.toThrow(/does not exist/);
  });

  it("throws if the client can't be built (missing env), so the fallback takes over", async () => {
    const limiter = new DbRateLimiter(() => {
      throw new Error("Missing Supabase admin environment variables");
    });
    await expect(limiter.hit("k", OPTS)).rejects.toThrow(/Missing/);
  });
});

describe("FallbackRateLimiter", () => {
  const broken: RateLimiter = { hit: async () => Promise.reject(new Error("no such function")) };

  it("uses the database when it works", async () => {
    const db = fakeDb(() => 0);
    const log = vi.fn();
    const limiter = new FallbackRateLimiter(new DbRateLimiter(() => db.client), new InMemoryRateLimiter(() => 0), { log });
    expect((await limiter.hit("k", OPTS)).allowed).toBe(true);
    expect(db.calls).toHaveLength(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("falls back to memory when the database fails, logging once — still limits", async () => {
    const log = vi.fn();
    const limiter = new FallbackRateLimiter(broken, new InMemoryRateLimiter(() => 0), { log, now: () => 0 });
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await limiter.hit("k", OPTS)).allowed);
    expect(results).toEqual([true, true, true, false]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/migration 280/);
  });

  it("retries the database after the cool-down", async () => {
    let now = 0;
    let dbWorks = false;
    const primary: RateLimiter = {
      hit: vi.fn(async () => {
        if (!dbWorks) throw new Error("down");
        return { allowed: true, remaining: 99, resetAt: new Date(0) };
      }),
    };
    const limiter = new FallbackRateLimiter(primary, new InMemoryRateLimiter(() => now), {
      log: () => {},
      now: () => now,
      retryAfterMs: 1000,
    });
    await limiter.hit("k", OPTS);
    await limiter.hit("k", OPTS); // within cool-down: database not asked
    expect(primary.hit).toHaveBeenCalledTimes(1);
    dbWorks = true;
    now = 1000;
    expect((await limiter.hit("k", OPTS)).remaining).toBe(99);
  });

  it("fails OPEN if even the fallback throws: never blocks a door", async () => {
    const limiter = new FallbackRateLimiter(broken, broken, { log: () => {} });
    expect((await limiter.hit("k", OPTS)).allowed).toBe(true);
  });
});

describe("retryAfterSeconds", () => {
  it("rounds up, minimum 1", () => {
    expect(retryAfterSeconds({ allowed: false, remaining: 0, resetAt: new Date(10_500) }, 0)).toBe(11);
    expect(retryAfterSeconds({ allowed: false, remaining: 0, resetAt: new Date(0) }, 5000)).toBe(1);
  });
});
