import { describe, expect, it } from "vitest";
import {
  anyIsSuperAdmin,
  canChangeAccount,
  refuseSuperAdminTarget,
  SUPER_ADMIN_TARGET_ERROR,
} from "./super-admin-target";

// A user_roles reader over a fixed map of user → role names. Understands the
// two filters the helpers use: user_id (eq / in) and roles.name (eq / in).
function rolesClient(held: Record<string, string[]>, error: { message: string } | null = null) {
  return {
    from() {
      let users: string[] = Object.keys(held);
      let names: string[] | null = null;
      const q = {
        select: () => q,
        limit: () => q,
        eq: (col: string, v: string) => q.in(col, [v]),
        in: (col: string, vs: string[]) => {
          if (col === "user_id") users = vs;
          if (col === "roles.name") names = vs;
          return q;
        },
        then: (resolve: (r: unknown) => unknown) => {
          const data = users.flatMap((u) =>
            (held[u] ?? [])
              .filter((n) => !names || names.includes(n))
              .map((n) => ({ user_id: u, roles: { name: n } }))
          );
          return Promise.resolve(error ? { data: null, error } : { data, error: null }).then(resolve);
        },
      };
      return q;
    },
  };
}

const held = {
  boss: ["super_admin", "staff"],
  ga: ["admin", "staff"],
  pat: ["staff"],
};

describe("canChangeAccount", () => {
  it("only a super admin changes a super admin; anyone changes everyone else", () => {
    expect(canChangeAccount(true, true)).toBe(true);
    expect(canChangeAccount(false, true)).toBe(false);
    expect(canChangeAccount(true, false)).toBe(true);
    expect(canChangeAccount(false, false)).toBe(true);
  });
});

describe("anyIsSuperAdmin", () => {
  it("spots a super admin anywhere in the list", async () => {
    const db = rolesClient(held);
    expect(await anyIsSuperAdmin(db, ["boss"])).toBe(true);
    expect(await anyIsSuperAdmin(db, ["pat", "boss"])).toBe(true);
    expect(await anyIsSuperAdmin(db, ["pat", "ga"])).toBe(false);
    expect(await anyIsSuperAdmin(db, [])).toBe(false);
  });

  it("throws rather than waving a change through when the read fails", async () => {
    const db = rolesClient(held, { message: "boom" });
    await expect(anyIsSuperAdmin(db, ["boss"])).rejects.toThrow(/boom/);
  });
});

describe("refuseSuperAdminTarget", () => {
  const db = rolesClient(held);

  it("refuses a General Admin acting on a super admin with a 403", async () => {
    const res = await refuseSuperAdminTarget(db, "ga", db, "boss");
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: SUPER_ADMIN_TARGET_ERROR });
  });

  it("refuses when the super admin is either side of a pair (merge)", async () => {
    expect((await refuseSuperAdminTarget(db, "ga", db, ["pat", "boss"]))?.status).toBe(403);
  });

  it("lets a super admin act on a super admin", async () => {
    expect(await refuseSuperAdminTarget(db, "boss", db, "boss")).toBeNull();
  });

  it("lets a General Admin act on anyone who isn't a super admin", async () => {
    expect(await refuseSuperAdminTarget(db, "ga", db, "pat")).toBeNull();
    expect(await refuseSuperAdminTarget(db, "ga", db, ["pat", "ga"])).toBeNull();
  });
});
