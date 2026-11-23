import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, filterValue, measure } from "@/lib/testing/fake-supabase";

// The middleware's Supabase client is swapped for a fake whose session /
// Auth answers each test controls.
let current: ReturnType<typeof makeClient>;
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => {
    cookieClientsBuilt += 1;
    return current.client;
  },
}));
let cookieClientsBuilt = 0;

// The bearer path (phone app) builds a plain supabase-js client carrying the
// token. It is a separate fake, so a test can tell which path ran.
let bearer: ReturnType<typeof makeBearerClient>;
vi.mock("@supabase/supabase-js", () => ({
  createClient: (
    _url: string,
    _key: string,
    options: { global?: { headers?: Record<string, string> } }
  ) => {
    bearer.headersSent.push(options.global?.headers?.Authorization ?? null);
    return bearer.client;
  },
}));

import { middleware } from "@/middleware";

function jwtFor(sub: string) {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256" })}.${enc({ sub, role: "authenticated" })}.sig`;
}

function makeClient(opts: {
  token?: string | null; // access token in the cookie session
  validUserId?: string | null; // who the Auth server says the token belongs to
  inactive?: string[]; // user ids with is_active = false
  latencyMs?: number;
}) {
  const fake = createFakeSupabase({
    latencyMs: opts.latencyMs,
    resolve: (q) => {
      if (q.table === "users") {
        const id = filterValue(q, "eq", "id") as string;
        return { data: { is_active: !(opts.inactive ?? []).includes(id) } };
      }
      return { data: [] };
    },
  });
  const sleep = () => new Promise((r) => setTimeout(r, opts.latencyMs ?? 0));
  const getUserCalls: Array<string | undefined> = [];
  fake.client.auth = {
    async getSession() {
      return { data: { session: opts.token ? { access_token: opts.token } : null }, error: null };
    },
    async getUser(jwt?: string) {
      getUserCalls.push(jwt);
      await sleep();
      const id = jwt && opts.validUserId ? opts.validUserId : null;
      return { data: { user: id ? { id } : null }, error: id ? null : { message: "no user" } };
    },
  };
  return { ...fake, getUserCalls };
}

// Token → user id, as the Auth server would answer for a bearer token.
function makeBearerClient(opts: { valid?: Record<string, string>; inactive?: string[] }) {
  const fake = createFakeSupabase({
    resolve: (q) => {
      if (q.table === "users") {
        const id = filterValue(q, "eq", "id") as string;
        return { data: { is_active: !(opts.inactive ?? []).includes(id) } };
      }
      return { data: [] };
    },
  });
  const getUserCalls: Array<string | undefined> = [];
  fake.client.auth = {
    async getUser(jwt?: string) {
      getUserCalls.push(jwt);
      const id = jwt ? opts.valid?.[jwt] : undefined;
      return { data: { user: id ? { id } : null }, error: id ? null : { message: "bad jwt" } };
    },
  };
  return { ...fake, getUserCalls, headersSent: [] as Array<string | null> };
}

const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, "https://hub.test"), { headers });
const location = (res: Response) => {
  const loc = res.headers.get("location");
  return loc ? new URL(loc) : null;
};

describe("middleware", () => {
  beforeEach(() => {
    current = makeClient({});
    bearer = makeBearerClient({});
    cookieClientsBuilt = 0;
  });

  it("public routes skip Supabase entirely", async () => {
    current = makeClient({ token: jwtFor("u1"), validUserId: "u1" });
    const res = await middleware(req("/e/some-event"));
    expect(location(res)).toBeNull();
    expect(current.getUserCalls).toHaveLength(0);
    expect(current.queries).toHaveLength(0);
  });

  it("no session → /login with the destination remembered", async () => {
    const res = await middleware(req("/finance"));
    const loc = location(res)!;
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("redirect")).toBe("/finance");
  });

  it("a token the Auth server rejects is treated as signed out", async () => {
    current = makeClient({ token: jwtFor("u1"), validUserId: null });
    expect(location(await middleware(req("/finance")))?.pathname).toBe("/login");
  });

  it("an active user passes through, with one is_active read for their own id", async () => {
    current = makeClient({ token: jwtFor("u1"), validUserId: "u1" });
    const res = await middleware(req("/finance"));
    expect(location(res)).toBeNull();
    expect(current.getUserCalls).toEqual([jwtFor("u1")]);
    expect(current.queries.map((q) => filterValue(q, "eq", "id"))).toEqual(["u1"]);
  });

  it("a deactivated user is sent to /login?error=deactivated", async () => {
    current = makeClient({ token: jwtFor("u1"), validUserId: "u1", inactive: ["u1"] });
    const loc = location(await middleware(req("/finance")))!;
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe("deactivated");
  });

  it("decides on the Auth-validated user, never the token's own claim", async () => {
    // Token claims u-active, but Auth says it belongs to u-deactivated.
    current = makeClient({
      token: jwtFor("u-active"),
      validUserId: "u-deactivated",
      inactive: ["u-deactivated"],
    });
    const loc = location(await middleware(req("/finance")))!;
    expect(loc.searchParams.get("error")).toBe("deactivated");
    expect(current.queries.map((q) => filterValue(q, "eq", "id"))).toEqual([
      "u-active",
      "u-deactivated",
    ]);
  });

  it("signed-in users leave /login for the dashboard", async () => {
    current = makeClient({ token: jwtFor("u1"), validUserId: "u1" });
    expect(location(await middleware(req("/login")))?.pathname).toBe("/dashboard");
  });

  it("a signed-out visit to /login stays on /login", async () => {
    current = makeClient({});
    expect(location(await middleware(req("/login")))).toBeNull();
  });

  it("a cleared session can open /login?error=signout", async () => {
    current = makeClient({});
    const res = await middleware(req("/login?error=signout"));
    expect(location(res)).toBeNull();
  });

  it("a still-signed-in visit to /login?error=signout is not sent to the dashboard", async () => {
    current = makeClient({ token: jwtFor("u1"), validUserId: "u1" });
    const res = await middleware(req("/login?error=signout"));
    expect(location(res)).toBeNull();
  });

  it("POST /auth/sign-out is not refreshed or sent to the dashboard", async () => {
    current = makeClient({ token: jwtFor("u1"), validUserId: "u1" });
    const res = await middleware(
      new NextRequest(new URL("/auth/sign-out", "https://hub.test"), { method: "POST" })
    );
    expect(location(res)).toBeNull();
    expect(current.getUserCalls).toHaveLength(0);
  });

  it("deactivated users can still reach /login", async () => {
    current = makeClient({ token: jwtFor("u1"), validUserId: "u1", inactive: ["u1"] });
    expect(location(await middleware(req("/login")))).toBeNull();
  });

  it("checks the token and is_active in one round trip, not two", async () => {
    current = makeClient({ token: jwtFor("u1"), validUserId: "u1", latencyMs: 25 });
    const { roundTrips } = await measure(25, () => middleware(req("/finance")));
    expect(roundTrips).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────
// /api/* without a session, and the phone app's bearer tokens
// ────────────────────────────────────────────────────────────

// What Next forwards to the route: the header names the middleware kept.
const forwardedHeaders = (res: Response) =>
  (res.headers.get("x-middleware-override-headers") ?? "").split(",").filter(Boolean);

describe("middleware: /api/* answers in JSON", () => {
  beforeEach(() => {
    current = makeClient({});
    bearer = makeBearerClient({});
    cookieClientsBuilt = 0;
  });

  it("fetch() with no session → 401 JSON, not a redirect", async () => {
    const res = await middleware(req("/api/people"));
    expect(res.status).toBe(401);
    expect(location(res)).toBeNull();
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a browser navigation to /api/* (Accept: text/html) still goes to /login", async () => {
    const res = await middleware(
      req("/api/events/e1/attendees/export", { accept: "text/html,application/xhtml+xml,*/*;q=0.8" })
    );
    const loc = location(res)!;
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("redirect")).toBe("/api/events/e1/attendees/export");
  });

  it("a deactivated cookie user calling /api/* → 403 JSON", async () => {
    current = makeClient({ token: jwtFor("u1"), validUserId: "u1", inactive: ["u1"] });
    const res = await middleware(req("/api/people"));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "deactivated" });
  });

  it("an active cookie user calling /api/* passes through as before", async () => {
    current = makeClient({ token: jwtFor("u1"), validUserId: "u1" });
    const res = await middleware(req("/api/people"));
    expect(res.status).toBe(200);
    expect(location(res)).toBeNull();
  });

  it("pages keep their redirect even when the client asks for JSON", async () => {
    const res = await middleware(req("/finance", { accept: "application/json" }));
    expect(location(res)?.pathname).toBe("/login");
  });
});

describe("middleware: bearer tokens (phone app)", () => {
  const T1 = jwtFor("u1");

  beforeEach(() => {
    current = makeClient({});
    bearer = makeBearerClient({ valid: { [T1]: "u1" } });
    cookieClientsBuilt = 0;
  });

  it("valid + active → continues, with the token forwarded and no cookie work", async () => {
    const res = await middleware(req("/api/me", { authorization: `Bearer ${T1}` }));
    expect(res.status).toBe(200);
    expect(location(res)).toBeNull();
    expect(bearer.getUserCalls).toEqual([T1]);
    expect(bearer.headersSent).toEqual([`Bearer ${T1}`]);
    // is_active read once, for the validated user, with the bearer client.
    expect(bearer.queries.map((q) => filterValue(q, "eq", "id"))).toEqual(["u1"]);
    expect(cookieClientsBuilt).toBe(0);
    expect(forwardedHeaders(res)).toContain("authorization");
  });

  it("invalid or expired token → 401 JSON", async () => {
    const res = await middleware(req("/api/me", { authorization: `Bearer ${jwtFor("nobody")}` }));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("malformed token → 401 JSON without asking the Auth server", async () => {
    const res = await middleware(req("/api/me", { authorization: "Bearer not-a-jwt" }));
    expect(res.status).toBe(401);
    expect(bearer.getUserCalls).toHaveLength(0);
  });

  it("a browser-style Accept header never turns a bad bearer into a redirect", async () => {
    const res = await middleware(
      req("/api/me", { authorization: "Bearer junk", accept: "text/html" })
    );
    expect(res.status).toBe(401);
    expect(location(res)).toBeNull();
  });

  it("deactivated → 403 JSON", async () => {
    bearer = makeBearerClient({ valid: { [T1]: "u1" }, inactive: ["u1"] });
    const res = await middleware(req("/api/me", { authorization: `Bearer ${T1}` }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "deactivated" });
  });

  it("decides on the Auth-validated user, never the token's own claim", async () => {
    const lying = jwtFor("u-active");
    bearer = makeBearerClient({ valid: { [lying]: "u-off" }, inactive: ["u-off"] });
    const res = await middleware(req("/api/me", { authorization: `Bearer ${lying}` }));
    expect(res.status).toBe(403);
  });

  it("bearer wins over cookies: a bad bearer is 401 even with a good cookie session", async () => {
    current = makeClient({ token: jwtFor("u2"), validUserId: "u2" });
    const res = await middleware(req("/api/me", { authorization: "Bearer junk" }));
    expect(res.status).toBe(401);
    expect(cookieClientsBuilt).toBe(0);
  });

  it("a bearer never authenticates a page: no cookie → /login, and the header is dropped", async () => {
    const res = await middleware(req("/finance", { authorization: `Bearer ${T1}` }));
    expect(location(res)?.pathname).toBe("/login");
    expect(bearer.getUserCalls).toHaveLength(0);
  });

  it("a page with a cookie session renders as the cookie user, with the bearer stripped", async () => {
    current = makeClient({ token: jwtFor("u2"), validUserId: "u2" });
    const res = await middleware(req("/finance", { authorization: `Bearer ${T1}` }));
    expect(location(res)).toBeNull();
    expect(forwardedHeaders(res)).not.toContain("authorization");
  });

  it("public pages also have the bearer stripped", async () => {
    const res = await middleware(req("/e/some-event", { authorization: `Bearer ${T1}` }));
    expect(forwardedHeaders(res)).not.toContain("authorization");
  });

  it("public /api routes are untouched: cron keeps its own Bearer secret", async () => {
    const res = await middleware(req("/api/cron/send-scheduled", { authorization: "Bearer cron-secret" }));
    expect(res.status).toBe(200);
    expect(bearer.getUserCalls).toHaveLength(0);
    expect(current.queries).toHaveLength(0);
  });

  it("Missio connect is public, and the neighbouring paths stay signed-in", async () => {
    const card = await middleware(req("/connect/missio"));
    expect(location(card)).toBeNull();
    expect(card.status).toBe(200);
    expect(current.getUserCalls).toHaveLength(0);

    const submit = await middleware(
      new NextRequest(new URL("/api/missio/connect", "https://hub.test"), { method: "POST" })
    );
    expect(submit.status).toBe(200);
    expect(location(submit)).toBeNull();
    expect(current.getUserCalls).toHaveLength(0);

    expect(location(await middleware(req("/connect")))?.pathname).toBe("/login");
    expect(location(await middleware(req("/connect/other")))?.pathname).toBe("/login");
    expect(location(await middleware(req("/connect/missio-extra")))?.pathname).toBe("/login");

    const followUp = await middleware(req("/api/missio/follow-up"));
    expect(followUp.status).toBe(401);
    expect(await followUp.json()).toMatchObject({ error: "unauthenticated" });
    const people = await middleware(req("/api/missio/people"));
    expect(people.status).toBe(401);
    const prefix = await middleware(req("/api/missio/connectivity"));
    expect(prefix.status).toBe(401);
  });

  it("the Missio WhatsApp webhook is public, and nothing else under /api/missio or /api/webhooks is", async () => {
    const hook = await middleware(
      new NextRequest(new URL("/api/webhooks/missio/whatsapp", "https://hub.test"), { method: "POST" })
    );
    expect(hook.status).toBe(200);
    expect(location(hook)).toBeNull();
    expect(current.getUserCalls).toHaveLength(0);

    expect((await middleware(req("/api/missio/whatsapp"))).status).toBe(401);
    expect((await middleware(req("/api/missio/whatsapp/send"))).status).toBe(401);
    expect((await middleware(req("/api/webhooks/missio"))).status).toBe(401);
    expect((await middleware(req("/api/webhooks/missio/whatsapp-extra"))).status).toBe(401);
    expect(location(await middleware(req("/missio/whatsapp")))?.pathname).toBe("/login");
  });

  it("/.well-known is public", async () => {
    const res = await middleware(req("/.well-known/apple-app-site-association"));
    expect(location(res)).toBeNull();
    expect(res.status).toBe(200);
    expect(current.getUserCalls).toHaveLength(0);
  });
});
