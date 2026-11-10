import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
    },
  }),
}));

import { GET } from "./route";

const ORIGIN = "https://hub.test";

function callback(next: string) {
  const url = new URL("/auth/callback", ORIGIN);
  url.searchParams.set("code", "valid-code");
  url.searchParams.set("next", next);
  return GET(new Request(url));
}

async function redirectTarget(next: string) {
  const res = await callback(next);
  const location = res.headers.get("location");
  expect(location).toBeTruthy();
  const target = new URL(location ?? "");
  expect(target.host).toBe(new URL(ORIGIN).host);
  return target;
}

describe("GET /auth/callback", () => {
  it.each(["@evil.com", "//evil.com", "/%09/evil.com", "/.//evil.com"])(
    "sends next=%s to /profile on the request origin",
    async (next) => {
      const target = await redirectTarget(next);
      expect(target.href).toBe(`${ORIGIN}/profile`);
    }
  );

  it("follows an internal path and its query", async () => {
    const target = await redirectTarget("/departments/x?tab=okrs");
    expect(target.href).toBe(`${ORIGIN}/departments/x?tab=okrs`);
  });
});
