import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("REDIRECT"), { url });
  },
}));

const getUser = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
  }),
}));

import RootPage from "./page";

async function destination(): Promise<string> {
  try {
    await RootPage();
  } catch (error) {
    if (error instanceof Error && "url" in error && typeof error.url === "string") {
      return error.url;
    }
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("root page", () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it("sends a signed-in person to /home without going through /login", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    await expect(destination()).resolves.toBe("/home");
  });

  it("sends an anonymous visitor to /login with no redirect param", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(destination()).resolves.toBe("/login");
  });
});
