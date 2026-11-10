import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
    },
  }),
}));

import { GET } from "./route";

describe("auth callback absolute next", () => {
  it("sends an absolute https next back to /profile", async () => {
    const url = new URL("https://hub.test/auth/callback");
    url.searchParams.set("code", "abc");
    url.searchParams.set("next", "https://evil.com");
    const res = await GET(new Request(url));
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.origin).toBe("https://hub.test");
    expect(loc.pathname).toBe("/profile");
    expect(loc.search).toBe("");
  });
});
