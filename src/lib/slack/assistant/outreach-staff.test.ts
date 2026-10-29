import { describe, expect, it } from "vitest";
import { isFinanceStaff } from "./outreach";

// isFinanceStaff() decides who sees every outreach team in Slack and in the
// Hub's outreach screens. A person flagged "outreach limited to own teams"
// (migration 274) is not finance staff through finance.view / finance.edit,
// but an admin tier or finance_admin still counts.

type Person = {
  roles?: string[];
  direct?: string[];
  viaRole?: string[];
  limited?: boolean | "error";
};

function admin(p: Person) {
  return {
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        limit: () => q,
        maybeSingle: async () => {
          if (p.limited === "error") return { data: null, error: { message: "relation does not exist" } };
          return { data: p.limited === undefined ? null : { limited_to_own_teams: p.limited }, error: null };
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve(q.run()).then(res),
        run() {
          if (table === "user_roles") {
            return { data: (p.roles ?? []).map((name) => ({ role_id: name, roles: { name } })), error: null };
          }
          if (table === "user_permissions") {
            return { data: (p.direct ?? []).map((key) => ({ permissions: { key } })), error: null };
          }
          if (table === "role_permissions") {
            return { data: (p.viaRole ?? []).map((key) => ({ permissions: { key } })), error: null };
          }
          return { data: [], error: null };
        },
      };
      return q;
    },
  };
}

describe("isFinanceStaff", () => {
  it.each([
    ["a finance.view grant", { direct: ["finance.view"] }],
    ["a finance.edit grant", { direct: ["finance.edit"] }],
    ["finance.view through a title", { roles: ["staff"], viaRole: ["finance.view"] }],
  ])("is true for %s", async (_label, person) => {
    expect(await isFinanceStaff(admin(person), "u")).toBe(true);
  });

  it.each([
    ["a finance.view grant", { direct: ["finance.view"] }],
    ["finance.view + finance.edit grants", { direct: ["finance.view", "finance.edit"] }],
    ["finance.view through a title", { roles: ["staff"], viaRole: ["finance.view"] }],
  ])("is false for %s when limited to own teams", async (_label, person) => {
    expect(await isFinanceStaff(admin({ ...person, limited: true }), "stefan")).toBe(false);
  });

  it.each(["super_admin", "admin", "finance_admin"])("a limited %s is still staff", async (role) => {
    expect(await isFinanceStaff(admin({ roles: [role], direct: ["finance.view"], limited: true }), "u")).toBe(true);
  });

  it.each([false, "error" as const])("the flag off (%s) changes nothing", async (limited) => {
    expect(await isFinanceStaff(admin({ direct: ["finance.edit"], limited }), "u")).toBe(true);
  });

  it("is false for someone with no finance access", async () => {
    expect(await isFinanceStaff(admin({ roles: ["staff"] }), "u")).toBe(false);
  });
});
