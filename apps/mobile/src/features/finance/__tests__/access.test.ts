import { makeMe } from "../../../../test/fixtures";
import { isFinanceStaff } from "../access";

const role = (name: string) => ({ name, scopeType: null, scopeId: null });
const perm = (key: string, source: "direct" | "role" = "role") => ({ key, scopeType: null, scopeId: null, source });

describe("isFinanceStaff (wording only)", () => {
  it("is false while /api/me hasn't loaded", () => {
    expect(isFinanceStaff(null)).toBe(false);
  });

  it("is true for admins and the finance office", () => {
    for (const name of ["super_admin", "admin", "finance_admin"]) {
      expect(isFinanceStaff(makeMe({ roles: [role(name)], permissions: [] }))).toBe(true);
    }
  });

  it("is true for finance.view / finance.edit from any source", () => {
    expect(isFinanceStaff(makeMe({ roles: [], permissions: [perm("finance.view", "direct")] }))).toBe(true);
    expect(isFinanceStaff(makeMe({ roles: [], permissions: [perm("finance.edit")] }))).toBe(true);
  });

  it("is false for everyone else", () => {
    expect(isFinanceStaff(makeMe())).toBe(false);
    expect(isFinanceStaff(makeMe({ roles: [role("team_leader")], permissions: [perm("events.view")] }))).toBe(false);
  });
});
