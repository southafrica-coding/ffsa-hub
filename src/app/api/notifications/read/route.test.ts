import { beforeEach, describe, expect, it, vi } from "vitest";

// POST /api/notifications/read through the REAL createClient(): the phone
// app marks items read with its bearer token, and the write is scoped to the
// token's user (the website's cookie path is unchanged).

const BEARER_JWT = "aaa.bbb.ccc";

const h = vi.hoisted(() => ({
  requestHeaders: new Headers(),
  marked: [] as Array<{ client: { kind: string }; userId: string; keys: string[] }>,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
  headers: async () => h.requestHeaders,
}));
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
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    kind: "cookie",
    auth: {
      async getSession() {
        return { data: { session: null }, error: null };
      },
      async getUser() {
        return { data: { user: null }, error: null };
      },
    },
  }),
}));
vi.mock("@/services/notifications", () => ({
  markNotificationsRead: async (client: { kind: string }, userId: string, keys: string[]) => {
    h.marked.push({ client, userId, keys });
    return { error: null };
  },
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("https://hub.test/api/notifications/read", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  h.requestHeaders = new Headers();
  h.marked.length = 0;
});

describe("POST /api/notifications/read (bearer)", () => {
  it("marks keys read for the bearer token's user", async () => {
    h.requestHeaders = new Headers({ authorization: `Bearer ${BEARER_JWT}` });
    const res = await post({ keys: ["booking:1", "user:2", 7] });
    expect(res.status).toBe(200);
    expect(h.marked).toEqual([
      { client: expect.objectContaining({ kind: "bearer" }), userId: "app-user", keys: ["booking:1", "user:2"] },
    ]);
  });

  it("401 without a usable session", async () => {
    const res = await post({ keys: ["booking:1"] });
    expect(res.status).toBe(401);
    expect(h.marked).toHaveLength(0);
  });
});
