import { describe, expect, it } from "vitest";
import {
  countDecisions,
  programIdSchema,
  shapeDepartmentOptions,
  shapeSchool,
  sortSchools,
} from "./staff-decisions";

const decided = (accepted: boolean) => ({
  decision: { accepted, note: null, decidedAt: "2026-10-01T00:00:00Z", decidedByName: null },
});

describe("mobile staff-decisions contract", () => {
  it("counts yes / no / undecided the way the web page does", () => {
    expect(countDecisions([])).toEqual({ total: 0, yes: 0, no: 0, undecided: 0 });
    expect(countDecisions([decided(true), decided(true), decided(false), { decision: null }])).toEqual({
      total: 4,
      yes: 2,
      no: 1,
      undecided: 1,
    });
  });

  it("marks archived schools and sorts by name descending", () => {
    const a = shapeSchool({ id: "a", name: "LT 2024", status: "archived" }, []);
    const b = shapeSchool({ id: "b", name: "LT 2026", status: "active" }, [decided(true)]);
    expect(a.archived).toBe(true);
    expect(b).toMatchObject({ archived: false, total: 1, yes: 1 });
    expect(sortSchools([a, b]).map((s) => s.id)).toEqual(["b", "a"]);
  });

  it("maps ministries to department options, tolerating null", () => {
    expect(shapeDepartmentOptions(null)).toEqual([]);
    expect(shapeDepartmentOptions([{ slug: "media", name: "Media" }])).toEqual([{ value: "media", label: "Media" }]);
  });

  it("accepts only uuids as a program id", () => {
    expect(programIdSchema.safeParse("11111111-1111-4111-8111-111111111111").success).toBe(true);
    expect(programIdSchema.safeParse("../x").success).toBe(false);
  });
});
