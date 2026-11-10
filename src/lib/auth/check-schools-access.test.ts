import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/lib/testing/fake-supabase";
import { userCanManageApplications, userCanManageProgram } from "./check-schools-access";

const PROGRAM = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function client(opts: { active?: boolean | null; error?: boolean; leader?: boolean; admin?: boolean }) {
  return createFakeSupabase({
    resolve: (q) => {
      if (opts.error) return { data: null, error: { message: "boom" } };
      if (q.table === "users") return { data: { is_active: opts.active === undefined ? true : opts.active } };
      if (q.table === "user_roles" && opts.admin) {
        return { data: [{ roles: { name: "admin" } }] };
      }
      if (q.table === "program_leaders" && opts.leader) return { data: [{ id: "pl" }] };
      return { data: [] };
    },
  }).client;
}

describe("userCanManageApplications is_active", () => {
  it("allows an active admin and treats NULL is_active as active", async () => {
    expect(await userCanManageApplications(client({ admin: true }), "u")).toBe(true);
    expect(await userCanManageApplications(client({ admin: true, active: null }), "u")).toBe(true);
  });

  it("denies a deactivated admin", async () => {
    expect(await userCanManageApplications(client({ admin: true, active: false }), "u")).toBe(false);
  });

  it("returns false when the active-account lookup errors", async () => {
    expect(await userCanManageApplications(client({ admin: true, error: true }), "u")).toBe(false);
  });
});

describe("userCanManageProgram is_active", () => {
  it("allows an active program leader and treats NULL is_active as active", async () => {
    expect(await userCanManageProgram(client({ leader: true }), "u", PROGRAM)).toBe(true);
    expect(await userCanManageProgram(client({ leader: true, active: null }), "u", PROGRAM)).toBe(true);
  });

  it("denies a deactivated program leader", async () => {
    expect(await userCanManageProgram(client({ leader: true, active: false }), "u", PROGRAM)).toBe(false);
  });

  it("returns false when the active-account lookup errors", async () => {
    expect(await userCanManageProgram(client({ leader: true, error: true }), "u", PROGRAM)).toBe(false);
  });
});
