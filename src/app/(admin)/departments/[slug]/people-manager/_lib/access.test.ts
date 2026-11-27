import { describe, expect, it } from "vitest";
import { peopleManagerAccess } from "./access";

function home(viewerMembership: "member" | "leader" | "none") {
  return { department: { viewerMembership } } as Parameters<typeof peopleManagerAccess>[1];
}
const client = (admin: boolean | "error") => ({
  rpc: async (fn: string) => {
    expect(fn).toBe("leave_caller_is_admin");
    return admin === "error" ? { data: null, error: { message: "nope" } } : { data: admin, error: null };
  },
});

describe("peopleManagerAccess", () => {
  it("members request, leaders and admins manage, like the API's me", async () => {
    expect(await peopleManagerAccess(client(false), home("member"))).toEqual({ canUse: true, canRequest: true, canManage: false });
    expect(await peopleManagerAccess(client(false), home("leader"))).toEqual({ canUse: true, canRequest: true, canManage: true });
    expect(await peopleManagerAccess(client(true), home("none"))).toEqual({ canUse: true, canRequest: false, canManage: true });
    expect(await peopleManagerAccess(client(false), home("none"))).toEqual({ canUse: false, canRequest: false, canManage: false });
  });

  it("an RPC error is not an admin", async () => {
    expect(await peopleManagerAccess(client("error"), home("none"))).toEqual({ canUse: false, canRequest: false, canManage: false });
  });
});
