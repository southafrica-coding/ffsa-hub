import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, filterValue, measure } from "@/lib/testing/fake-supabase";

// The middleware's Supabase client is swapped for a fake whose session /
// Auth answers each test controls.
let current: ReturnType<typeof makeClient>;
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => current.client,
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

const req = (path: string) => new NextRequest(new URL(path, "https://hub.test"));
const location = (res: Response) => {
  const loc = res.headers.get("location");
  return loc ? new URL(loc) : null;
};

describe("middleware", () => {
  beforeEach(() => {
    current = makeClient({});
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
