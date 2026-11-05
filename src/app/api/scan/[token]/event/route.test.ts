import { beforeEach, describe, expect, it, vi } from "vitest";

// The phone app's volunteer door asks which event a link belongs to. Same
// token, same rate-limit bucket and same dead-link answer as /api/scan/[token];
// only the title and start date come back.

const state = vi.hoisted(() => ({
  hits: [] as Array<{ key: string; limit: number; windowSeconds: number }>,
  allowed: true,
  link: null as unknown,
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    getRateLimiter: () => ({
      hit: async (key: string, opts: { limit: number; windowSeconds: number }) => {
        state.hits.push({ key, ...opts });
        return { allowed: state.allowed, remaining: 0, resetAt: new Date(Date.now() + 20_000) };
      },
    }),
  };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/services/event-scan-links", () => ({
  resolveScanLink: async () => state.link,
}));

import { GET } from "./route";

const LIVE_LINK = {
  id: "link-1",
  event_id: "event-1",
  token: "tok123",
  is_active: true,
  event: { id: "event-1", title: "Send Night", start_date: "2026-11-07" },
};

const get = (ip = "198.51.100.7") =>
  GET(
    new Request("https://hub.test/api/scan/tok123/event", {
      headers: { "x-forwarded-for": ip },
    }),
    { params: Promise.resolve({ token: "tok123" }) }
  );

beforeEach(() => {
  state.hits.length = 0;
  state.allowed = true;
  state.link = LIVE_LINK;
});

describe("GET /api/scan/[token]/event", () => {
  it("returns only the event's title and start date, never ids or the token", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ event: { title: "Send Night", startDate: "2026-11-07" } });
  });

  it("shares the door's rate-limit bucket (token + IP, 120 a minute)", async () => {
    await get();
    expect(state.hits).toEqual([{ key: "scan:tok123:198.51.100.7", limit: 120, windowSeconds: 60 }]);
  });

  it("429 with Retry-After when the limiter says no, without looking the link up", async () => {
    state.allowed = false;
    state.link = null;
    const res = await get();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("20");
  });

  it("404 with the door's plain-English message for a dead or unknown link", async () => {
    state.link = null;
    const res = await get();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/no longer active/);
  });
});
