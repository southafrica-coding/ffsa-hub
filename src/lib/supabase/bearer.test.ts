import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createClientFromRequest,
  getBearerToken,
  hasBearerHeader,
} from "@/lib/supabase/bearer";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";

const req = (authorization?: string) =>
  new Request("https://hub.test/api/me", {
    headers: authorization ? { authorization } : {},
  });

describe("getBearerToken", () => {
  it("reads Bearer <jwt>, case-insensitive on the scheme", () => {
    expect(getBearerToken(req(`Bearer ${JWT}`))).toBe(JWT);
    expect(getBearerToken(req(`bearer ${JWT}`))).toBe(JWT);
    expect(getBearerToken(new Headers({ authorization: `Bearer  ${JWT} ` }))).toBe(JWT);
  });

  it("returns null for no header, other schemes, and anything not JWT-shaped", () => {
    expect(getBearerToken(req())).toBeNull();
    expect(getBearerToken(req(`Basic ${JWT}`))).toBeNull();
    expect(getBearerToken(req("Bearer "))).toBeNull();
    expect(getBearerToken(req("Bearer my-cron-secret"))).toBeNull();
    expect(getBearerToken(req("Bearer a.b"))).toBeNull();
    expect(getBearerToken(req("Bearer a.b.c d"))).toBeNull();
    expect(getBearerToken(req(`Bearer ${"a".repeat(9000)}.b.c`))).toBeNull();
  });

  it("hasBearerHeader spots the scheme even when the token is junk", () => {
    expect(hasBearerHeader(req("Bearer junk"))).toBe(true);
    expect(hasBearerHeader(req())).toBe(false);
    expect(hasBearerHeader(req("Basic x"))).toBe(false);
  });
});

describe("createClientFromRequest", () => {
  const seen: Array<{ url: string; authorization: string | null }> = [];

  beforeEach(() => {
    seen.length = 0;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        seen.push({ url, authorization: headers.get("authorization") });
        if (url.includes("/auth/v1/user")) {
          return new Response(JSON.stringify({ id: "u1", aud: "authenticated" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      })
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is null without a usable bearer (never an anonymous client)", () => {
    expect(createClientFromRequest(req())).toBeNull();
    expect(createClientFromRequest(req("Bearer nope"))).toBeNull();
  });

  it("sends the caller's token on database queries, so RLS runs as them", async () => {
    const supabase = createClientFromRequest(req(`Bearer ${JWT}`))!;
    await supabase.from("users").select("id").eq("id", "u1");
    const rest = seen.find((s) => s.url.includes("/rest/v1/users"));
    expect(rest?.authorization).toBe(`Bearer ${JWT}`);
  });

  it("auth.getUser() with no argument validates the same token with the Auth server", async () => {
    const supabase = createClientFromRequest(req(`Bearer ${JWT}`))!;
    const { data } = await supabase.auth.getUser();
    expect(data.user?.id).toBe("u1");
    const auth = seen.find((s) => s.url.includes("/auth/v1/user"));
    expect(auth?.authorization).toBe(`Bearer ${JWT}`);
  });
});
