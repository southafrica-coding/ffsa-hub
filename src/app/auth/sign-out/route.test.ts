import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  error: null as { message: string } | null,
  cleared: [] as Array<{ name: string; value: string }>,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (cookies: Array<{ name: string; value: string; options?: object }>) => void;
      };
    }
  ) => ({
    auth: {
      signOut: async () => {
        // Local cookies are cleared even when the revoke call then fails.
        options.cookies.setAll([
          { name: "sb-access-token", value: "", options: { path: "/", maxAge: 0 } },
        ]);
        state.cleared.push({ name: "called", value: state.error ? "error" : "ok" });
        return { error: state.error };
      },
    },
  }),
}));

import { POST } from "./route";

function post() {
  return new NextRequest("https://hub.test/auth/sign-out", { method: "POST" });
}

describe("POST /auth/sign-out", () => {
  beforeEach(() => {
    state.error = null;
    state.cleared = [];
  });

  it("clears the session cookie and redirects to /login", async () => {
    const res = await POST(post());
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
    expect(res.cookies.get("sb-access-token")?.value).toBe("");
    expect(state.cleared).toEqual([{ name: "called", value: "ok" }]);
  });

  it("redirects a failed sign-out to /login?error=signout with the cleared cookie", async () => {
    state.error = { message: "network" };
    const res = await POST(post());
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe("signout");
    expect(res.cookies.get("sb-access-token")?.value).toBe("");
  });
});
