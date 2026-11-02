import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: Array<string | undefined> = [];
let session: { access_token: string } | null = { access_token: "tok" };
let requestHeaders = new Headers();
let cookieClientsBuilt = 0;

const BEARER_JWT = "aaa.bbb.ccc";
const bearerClients: Array<{ options: { global?: { headers?: Record<string, string> } } }> = [];
const bearerGetUserCalls: Array<string | undefined> = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
  headers: async () => requestHeaders,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, options: never) => {
    const record = { options };
    bearerClients.push(record);
    return {
      kind: "bearer",
      auth: {
        async getUser(jwt?: string) {
          bearerGetUserCalls.push(jwt);
          return { data: { user: jwt === BEARER_JWT ? { id: "app-user" } : null }, error: null };
        },
      },
    };
  },
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    kind: "cookie",
    _built: ++cookieClientsBuilt,
    auth: {
      async getSession() {
        return { data: { session }, error: null };
      },
      async getUser(jwt?: string) {
        calls.push(jwt);
        return { data: { user: jwt === "tok" ? { id: "u1" } : null }, error: null };
      },
    },
  }),
}));

import { createClient } from "@/lib/supabase/server";

beforeEach(() => {
  calls.length = 0;
  session = { access_token: "tok" };
  requestHeaders = new Headers();
  cookieClientsBuilt = 0;
  bearerClients.length = 0;
  bearerGetUserCalls.length = 0;
});

describe("server createClient().auth.getUser", () => {
  it("validates the session token with the Auth server", async () => {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    expect(data.user).toEqual({ id: "u1" });
    expect(calls).toEqual(["tok"]);
  });

  it("an explicit token goes straight through", async () => {
    const supabase = await createClient();
    await supabase.auth.getUser("other");
    expect(calls).toEqual(["other"]);
  });

  it("with no session it falls back to the stock call (and does not loop)", async () => {
    session = null;
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    expect(data.user).toBeNull();
    expect(calls).toEqual([undefined]);
  });
});

describe("server createClient() with a bearer token (the phone app)", () => {
  it("no Authorization header → the cookie client, exactly as before", async () => {
    const supabase = await createClient();
    expect((supabase as unknown as { kind: string }).kind).toBe("cookie");
    expect(bearerClients).toHaveLength(0);
  });

  it("Bearer <jwt> → a client that sends that token, and getUser() validates it", async () => {
    requestHeaders = new Headers({ authorization: `Bearer ${BEARER_JWT}` });
    const supabase = await createClient();
    expect((supabase as unknown as { kind: string }).kind).toBe("bearer");
    expect(cookieClientsBuilt).toBe(0);
    expect(bearerClients[0].options.global?.headers?.Authorization).toBe(`Bearer ${BEARER_JWT}`);

    const { data } = await supabase.auth.getUser();
    expect(data.user).toEqual({ id: "app-user" });
    expect(bearerGetUserCalls).toEqual([BEARER_JWT]);
    // The cookie session is never consulted.
    expect(calls).toEqual([]);
  });

  it("a bearer that isn't a JWT (e.g. a cron secret) is ignored", async () => {
    requestHeaders = new Headers({ authorization: "Bearer not-a-jwt-secret" });
    const supabase = await createClient();
    expect((supabase as unknown as { kind: string }).kind).toBe("cookie");
    expect(bearerClients).toHaveLength(0);
  });
});
