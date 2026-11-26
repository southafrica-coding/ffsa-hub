import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, filterValue } from "@/lib/testing/fake-supabase";

// The Store's routes in the middleware: /store is public, /store/admin is
// not, and a Store buyer (signed in, no users row) stays inside the Store.

let current: ReturnType<typeof makeClient>;
vi.mock("@supabase/ssr", () => ({ createServerClient: () => current.client }));

import { middleware } from "@/middleware";

function jwtFor(sub: string) {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256" })}.${enc({ sub, role: "authenticated" })}.sig`;
}

// usersRow: "staff" → a users row; "buyer" → no row; "error" → the read fails.
function makeClient(opts: { userId?: string; usersRow?: "staff" | "buyer" | "error" }) {
  const fake = createFakeSupabase({
    resolve: (q) => {
      if (q.table === "users") {
        if (opts.usersRow === "error") return { data: null, error: { message: "timeout" } };
        if (opts.usersRow === "buyer") return { data: null };
        return { data: { id: filterValue(q, "eq", "id"), is_active: true } };
      }
      return { data: [] };
    },
  });
  fake.client.auth = {
    async getSession() {
      return { data: { session: opts.userId ? { access_token: jwtFor(opts.userId) } : null }, error: null };
    },
    async getUser(jwt?: string) {
      return { data: { user: jwt && opts.userId ? { id: opts.userId } : null }, error: null };
    },
  };
  return fake;
}

const req = (path: string, headers: Record<string, string> = {}) => new NextRequest(new URL(path, "https://hub.test"), { headers });
const loc = (res: Response) => (res.headers.get("location") ? new URL(res.headers.get("location")!).pathname : null);

describe("middleware: Store", () => {
  beforeEach(() => {
    current = makeClient({});
  });

  it("the storefront and product pages are public and skip Supabase", async () => {
    for (const p of ["/store", "/store/p/example-review", "/api/store/preview/example-review", "/api/store/page"]) {
      const res = await middleware(req(p));
      expect(loc(res)).toBeNull();
    }
    expect(current.queries).toHaveLength(0);
  });

  it("the staff area under /store is never public", async () => {
    expect(loc(await middleware(req("/store/admin")))).toBe("/login");
    expect(loc(await middleware(req("/store/admin/products/new")))).toBe("/login");
    const api = await middleware(req("/api/store/admin/products"));
    expect(api.status).toBe(401);
  });

  it("buyer pages are reachable signed out (they show the sign-in form) and refresh a session when there is one", async () => {
    expect(loc(await middleware(req("/store/library")))).toBeNull();
    current = makeClient({ userId: "buyer-1", usersRow: "buyer" });
    expect(loc(await middleware(req("/store/library")))).toBeNull();
    expect(current.queries.some((q) => q.table === "users")).toBe(true);
  });

  it("a Store buyer is kept out of the staff Hub", async () => {
    current = makeClient({ userId: "buyer-1", usersRow: "buyer" });
    expect(loc(await middleware(req("/dashboard")))).toBe("/store/library");
    expect(loc(await middleware(req("/store/admin")))).toBe("/store/library");
    expect(loc(await middleware(req("/profile")))).toBe("/store/library");
    const api = await middleware(req("/api/finance/school-fees/payments"));
    expect(api.status).toBe(403);
    // /login sends a buyer to their library, not to /dashboard.
    expect(loc(await middleware(req("/login")))).toBe("/store/library");
  });

  it("staff are unaffected, and a failed users read never turns staff into a buyer", async () => {
    current = makeClient({ userId: "staff-1", usersRow: "staff" });
    expect(loc(await middleware(req("/store/admin")))).toBeNull();
    expect(loc(await middleware(req("/dashboard")))).toBeNull();
    current = makeClient({ userId: "staff-1", usersRow: "error" });
    expect(loc(await middleware(req("/dashboard")))).toBeNull();
  });
});
