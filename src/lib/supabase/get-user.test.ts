import { describe, it, expect, vi } from "vitest";
import { lockFreeGetUser } from "@/lib/supabase/get-user";

describe("lockFreeGetUser", () => {
  it("validates the session's access token with the Auth server", async () => {
    const getUser = vi.fn(async (jwt?: string) => ({ data: { user: jwt ? { id: "u1" } : null }, error: null }));
    const auth = {
      getSession: async () => ({ data: { session: { access_token: "tok" } }, error: null }),
      getUser,
    };
    const res = await lockFreeGetUser(auth);
    expect(getUser).toHaveBeenCalledWith("tok");
    expect(res.data.user).toEqual({ id: "u1" });
  });

  it("returns whatever the Auth server says, never the cookie's copy of the user", async () => {
    const auth = {
      getSession: async () => ({
        data: { session: { access_token: "revoked", user: { id: "someone-else" } } },
        error: null,
      }),
      getUser: async () => ({ data: { user: null }, error: { message: "invalid JWT" } }),
    };
    const res = await lockFreeGetUser(auth);
    expect(res.data.user).toBeNull();
    expect(res.error).toEqual({ message: "invalid JWT" });
  });

  it("with no session, defers to the stock call so the 'no user' result is unchanged", async () => {
    const getUser = vi.fn(async () => ({ data: { user: null }, error: { name: "AuthSessionMissingError" } }));
    const auth = {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser,
    };
    const res = await lockFreeGetUser(auth);
    expect(getUser).toHaveBeenCalledWith();
    expect(res.data.user).toBeNull();
  });
});
