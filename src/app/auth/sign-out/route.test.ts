import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  error: null as { message: string } | null,
  scopes: [] as string[],
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
      signOut: async (opts?: { scope?: string }) => {
        const scope = opts?.scope ?? "global";
        state.scopes.push(scope);
        // A failed global revoke leaves the cookies. The local retry clears them.
        if (scope === "local" || !state.error) {
          options.cookies.setAll([
            { name: "sb-access-token", value: "", options: { path: "/", maxAge: 0 } },
          ]);
        }
        return { error: scope === "local" ? null : state.error };
      },
    },
  }),
}));

import { POST } from "./route";

function post(cookie?: string) {
  return new NextRequest("https://hub.test/auth/sign-out", {
    method: "POST",
    headers: cookie ? { cookie } : undefined,
  });
}

describe("POST /auth/sign-out", () => {
  beforeEach(() => {
    state.error = null;
    state.scopes = [];
  });

  it("clears the session cookie and redirects to /login", async () => {
    const res = await POST(post());
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
    expect(res.cookies.get("sb-access-token")?.value).toBe("");
    expect(state.scopes).toEqual(["global"]);
  });

  it("on failure, clears sb-* cookies locally and redirects to /login?error=signout", async () => {
    state.error = { message: "network" };
    const res = await POST(post("sb-ref-auth-token=secret; sb-ref-auth-token.0=chunk; theme=light"));
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("error")).toBe("signout");
    expect(state.scopes).toEqual(["global", "local"]);
    expect(res.cookies.get("sb-access-token")?.value).toBe("");
    expect(res.cookies.get("sb-ref-auth-token")?.value).toBe("");
    expect(res.cookies.get("sb-ref-auth-token.0")?.value).toBe("");
    expect(res.cookies.get("theme")).toBeUndefined();
  });
});
