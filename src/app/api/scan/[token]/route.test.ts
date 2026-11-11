import { beforeEach, describe, expect, it, vi } from "vitest";

// The public door's rate limit now goes through the shared limiter: 120 a
// minute per token + IP, and a limiter that can't answer never shuts the door.

const state = vi.hoisted(() => ({
  hits: [] as Array<{ key: string; limit: number; windowSeconds: number }>,
  allowed: true,
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
  resolveScanLink: async () => ({ id: "link-1", event_id: "event-1" }),
}));
vi.mock("@/services/ticket-check-in", () => ({
  checkInTicket: async () => ({ result: "ok" }),
  undoCheckIn: async () => ({ ok: true }),
  getDoorStats: async () => ({ checkedIn: 3 }),
  searchGuests: async () => [],
}));

import { GET } from "./route";

const get = (ip: string) =>
  GET(
    new Request("https://hub.test/api/scan/tok123?stats=1", {
      headers: { "x-forwarded-for": ip },
    }),
    { params: Promise.resolve({ token: "tok123" }) }
  );

beforeEach(() => {
  state.hits.length = 0;
  state.allowed = true;
});

function expectResponse<T>(res: T): asserts res is NonNullable<T> {
  expect(res).toBeDefined();
  if (!res) throw new Error("expected a response");
}

describe("/api/scan/[token] rate limit", () => {
  it("keys on token + client IP, 120 per 60 seconds", async () => {
    const res = await get("198.51.100.7");
    expectResponse(res);
    expect(res.status).toBe(200);
    expect(state.hits).toEqual([{ key: "scan:tok123:198.51.100.7", limit: 120, windowSeconds: 60 }]);
  });

  it("429 with Retry-After when the limiter says no", async () => {
    state.allowed = false;
    const res = await get("198.51.100.7");
    expectResponse(res);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("20");
  });
});
