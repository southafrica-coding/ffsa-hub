import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: Array<string | undefined> = [];
let session: { access_token: string } | null = { access_token: "tok" };

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      async getSession() {
        return { data: { session }, error: null };
      },
      async getUser(jwt?: string) {
        calls.push(jwt);
        return { data: { user: jwt === "tok" ? { id: "u1" } : null }, error: null };
      },
    },
  }),
}));

import { createClient } from "@/lib/supabase/server";

beforeEach(() => {
  calls.length = 0;
  session = { access_token: "tok" };
});

describe("server createClient().auth.getUser", () => {
  it("validates the session token with the Auth server", async () => {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    expect(data.user).toEqual({ id: "u1" });
    expect(calls).toEqual(["tok"]);
  });

  it("an explicit token goes straight through", async () => {
    const supabase = await createClient();
    await supabase.auth.getUser("other");
    expect(calls).toEqual(["other"]);
  });

  it("with no session it falls back to the stock call (and does not loop)", async () => {
    session = null;
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    expect(data.user).toBeNull();
    expect(calls).toEqual([undefined]);
  });
});
