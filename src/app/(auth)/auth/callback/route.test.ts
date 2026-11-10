import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
    },
  }),
}));

import { GET } from "./route";

function callback(next: string) {
  const url = new URL("https://hub.test/auth/callback");
  url.searchParams.set("code", "abc");
  url.searchParams.set("next", next);
  return GET(new Request(url));
}

describe("auth callback next", () => {
  it("falls back to /profile for a protocol-relative or absolute next", async () => {
    for (const next of ["//evil.com", "https://evil.com"]) {
      const res = await callback(next);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.origin).toBe("https://hub.test");
      expect(loc.pathname).toBe("/profile");
      expect(loc.search).toBe("");
    }
  });

  it("follows an internal path, including its query", async () => {
    const res = await callback("/departments/x?tab=okrs");
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe("https://hub.test");
    expect(loc.pathname).toBe("/departments/x");
    expect(loc.searchParams.get("tab")).toBe("okrs");
  });
});
