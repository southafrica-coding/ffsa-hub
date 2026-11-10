import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("REDIRECT"), { url });
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const createClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

import { requireSignedIn } from "./session";

function client(user: { id: string } | null, row: { data: unknown; error: unknown }) {
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => row,
        }),
      }),
    }),
  };
}

describe("requireSignedIn", () => {
  it("redirects when nobody is signed in", async () => {
    createClient.mockResolvedValue(client(null, { data: null, error: null }));
    await expect(requireSignedIn()).rejects.toMatchObject({ url: "/login" });
  });

  it("404s an inactive account", async () => {
    createClient.mockResolvedValue(
      client({ id: "user-1" }, { data: { is_active: false }, error: null })
    );
    await expect(requireSignedIn()).rejects.toThrow("NOT_FOUND");
  });

  it("404s when the active check fails", async () => {
    createClient.mockResolvedValue(
      client({ id: "user-1" }, { data: null, error: { message: "db down" } })
    );
    await expect(requireSignedIn()).rejects.toThrow("NOT_FOUND");
  });

  it("returns the user when the account is active", async () => {
    createClient.mockResolvedValue(
      client({ id: "user-1" }, { data: { is_active: true }, error: null })
    );
    await expect(requireSignedIn()).resolves.toEqual({ id: "user-1" });
  });
});
