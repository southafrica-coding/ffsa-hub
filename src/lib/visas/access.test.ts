import { describe, expect, it } from "vitest";
import { canFollowUp, isLegalFor, scopeOf, type VisaAccess } from "./access";

const A = "a", B = "b";

describe("visa access", () => {
  it("reads scopes: an unscoped grant means everywhere", () => {
    expect(scopeOf([{ scope_type: "program", scope_id: A }, { scope_type: null }])).toBe("all");
    expect(scopeOf([{ scope_type: "program", scope_id: A }, { scope_type: "program", scope_id: A }])).toEqual([A]);
    expect(scopeOf([{ scope_type: "team", scope_id: A }])).toEqual([]);
  });

  it("scoped legal is legal only for its schools", () => {
    const access: VisaAccess = { globalLegal: false, legalPrograms: [A], followUpPrograms: [], open: true };
    expect(isLegalFor(access, [A, B])).toBe(true);
    expect(isLegalFor(access, [B])).toBe(false);
    expect(canFollowUp(access, [B])).toBe(false);
  });

  it("a leader follows up only their schools' cases", () => {
    const access: VisaAccess = { globalLegal: false, legalPrograms: [], followUpPrograms: [B], open: true };
    expect(canFollowUp(access, [A, B])).toBe(true);
    expect(canFollowUp(access, [A])).toBe(false);
    expect(isLegalFor(access, [B])).toBe(false);
  });
});
