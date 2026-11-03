import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/notifications through the REAL createClient(): the phone app's
// bearer token and the website's cookie session must both reach the feed as
// the right user. Supabase and the feed service are faked at the edges.

const BEARER_JWT = "aaa.bbb.ccc";

const h = vi.hoisted(() => ({
  requestHeaders: new Headers(),
  cookieSession: null as { access_token: string } | null,
  feedCalls: [] as Array<{ client: { kind: string }; userId: string }>,
  feedImpl: null as null | (() => Promise<unknown>),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
  headers: async () => h.requestHeaders,
}));
// Bearer path: @supabase/supabase-js createClient (src/lib/supabase/bearer.ts).
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    kind: "bearer",
    auth: {
      async getUser(jwt?: string) {
        return { data: { user: jwt === BEARER_JWT ? { id: "app-user" } : null }, error: null };
      },
    },
  }),
}));
// Cookie path: @supabase/ssr createServerClient (src/lib/supabase/server.ts).
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    kind: "cookie",
    auth: {
      async getSession() {
        return { data: { session: h.cookieSession }, error: null };
      },
      async getUser(jwt?: string) {
        return { data: { user: jwt === "cookie-tok" ? { id: "web-user" } : null }, error: null };
      },
    },
  }),
}));
vi.mock("@/services/notifications", () => ({
  getNotifications: async (client: { kind: string }, userId: string) => {
    h.feedCalls.push({ client, userId });
    if (h.feedImpl) return h.feedImpl();
    return {
      notifications: [
        {
          key: "booking:1",
          kind: "booking",
          title: "New booking request",
          body: "Hall",
          href: "/bookings/requests",
          when: "2h ago",
          ts: Date.parse("2026-11-03T08:00:00.000Z"),
          read: false,
        },
      ],
      unreadCount: 1,
    };
  },
}));

import { GET } from "./route";

beforeEach(() => {
  h.requestHeaders = new Headers();
  h.cookieSession = null;
  h.feedCalls.length = 0;
  h.feedImpl = null;
});

describe("GET /api/notifications auth", () => {
  it("works with a bearer token (phone app) and runs the feed as that user", async () => {
    h.requestHeaders = new Headers({ authorization: `Bearer ${BEARER_JWT}` });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(h.feedCalls).toHaveLength(1);
    expect(h.feedCalls[0].userId).toBe("app-user");
    expect(h.feedCalls[0].client.kind).toBe("bearer");
    expect(await res.json()).toEqual({
      items: [
        {
          key: "booking:1",
          kind: "booking",
          title: "New booking request",
          body: "Hall",
          href: "/bookings/requests",
          read: false,
          createdAt: "2026-11-03T08:00:00.000Z",
        },
      ],
      unreadCount: 1,
    });
  });

  it("works with a cookie session (website)", async () => {
    h.cookieSession = { access_token: "cookie-tok" };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(h.feedCalls[0].userId).toBe("web-user");
    expect(h.feedCalls[0].client.kind).toBe("cookie");
  });

  it("401 for a bearer token the Auth server doesn't recognise", async () => {
    h.requestHeaders = new Headers({ authorization: "Bearer xxx.yyy.zzz" });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(h.feedCalls).toHaveLength(0);
  });

  it("401 with neither", async () => {
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("500 JSON (no stack) if the feed service throws", async () => {
    h.requestHeaders = new Headers({ authorization: `Bearer ${BEARER_JWT}` });
    h.feedImpl = async () => {
      throw new Error("db exploded");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET();
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error", message: "Couldn't load notifications." });
  });
});
