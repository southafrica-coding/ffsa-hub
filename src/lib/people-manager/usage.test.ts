import { describe, expect, it } from "vitest";
import { guidelineLine, projectRequest, usageByType, type UsageRequest } from "./usage";

const types = [
  { id: "annual", slug: "annual", label: "Annual leave", sort_order: 10, is_active: true, annual_allowance_days: 15 },
  { id: "sick", slug: "sick", label: "Sick leave", sort_order: 20, is_active: true, annual_allowance_days: 5 },
  { id: "unpaid", slug: "unpaid", label: "Unpaid leave", sort_order: 60, is_active: true, annual_allowance_days: null },
  { id: "old", slug: "old", label: "Old type", sort_order: 70, is_active: false, annual_allowance_days: 2 },
];
const req = (leave_type_id: string, status: UsageRequest["status"], days_by_year: Record<string, number>): UsageRequest => ({
  leave_type_id,
  status,
  days_by_year,
});

describe("usageByType", () => {
  it("sums approved as used and pending separately, against the guideline", () => {
    const u = usageByType({
      types,
      year: 2026,
      requests: [
        req("sick", "approved", { "2026": 3 }),
        req("sick", "pending", { "2026": 4 }),
        req("sick", "declined", { "2026": 5 }),
        req("sick", "cancelled", { "2026": 5 }),
        req("annual", "approved", { "2026": 8 }),
        req("annual", "approved", { "2026": 9 }),
        req("unpaid", "approved", { "2026": 2.5 }),
      ],
    });
    expect(u.map((x) => x.slug)).toEqual(["annual", "sick", "unpaid"]); // inactive "old" has no days
    expect(u[0]).toMatchObject({ used: 17, pending: 0, guideline: 15, remaining: -2, over: 2 });
    expect(u[1]).toMatchObject({ used: 3, pending: 4, guideline: 5, remaining: 2, over: 0 });
    expect(u[2]).toMatchObject({ used: 2.5, guideline: null, remaining: null, over: null });
  });

  it("counts only each year's own days of a request across the boundary", () => {
    const requests = [req("annual", "approved", { "2026": 4, "2027": 2 })];
    expect(usageByType({ types, requests, year: 2026 })[0].used).toBe(4);
    expect(usageByType({ types, requests, year: 2027 })[0].used).toBe(2);
    expect(usageByType({ types, requests, year: 2028 })[0].used).toBe(0);
  });

  it("applies a department override's guideline to requests on the base type (same slug)", () => {
    const override = [{ ...types[1], id: "grounds-sick", annual_allowance_days: 10 }];
    const u = usageByType({
      types: override,
      year: 2026,
      requests: [req("base-sick", "approved", { "2026": 7 })],
      typeSlugById: new Map([["base-sick", "sick"]]),
    });
    expect(u[0]).toMatchObject({ leave_type_id: "grounds-sick", used: 7, guideline: 10, over: 0, remaining: 3 });
  });

  it("shows an inactive type only when it has days", () => {
    const u = usageByType({ types, year: 2026, requests: [req("old", "approved", { "2026": 1 })] });
    expect(u.map((x) => x.slug)).toContain("old");
  });
});

describe("projectRequest and the Slack line", () => {
  it("adds this request to what is used", () => {
    const [annual] = usageByType({ types, year: 2026, requests: [req("annual", "approved", { "2026": 8 })] });
    expect(projectRequest(annual, 7)).toEqual({ used: 8, this_request: 7, total: 15, guideline: 15, over: 0, reaches_guideline: true });
    expect(projectRequest(annual, 9).over).toBe(2);
  });

  it("formats the guideline line like the mockup", () => {
    expect(guidelineLine("Sick", 7, 5)).toBe("Sick: 7 of 5 guideline days used (+2 over)");
    expect(guidelineLine("Annual leave", 15, 15)).toBe("Annual leave: 15 of 15 guideline days used");
    expect(guidelineLine("Annual leave", 3.5, 15)).toBe("Annual leave: 3.5 of 15 guideline days used");
    expect(guidelineLine("Unpaid leave", 1, null)).toBe("Unpaid leave: 1 day used (no guideline)");
  });
});
