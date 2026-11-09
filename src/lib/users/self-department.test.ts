import { describe, expect, it } from "vitest";
import {
  callerMayChooseDepartment,
  isBlankDepartment,
  isDistinct,
  normalizeDepartment,
  onlyAdminDepartmentMessage,
  selfServiceDepartmentOptions,
  verdictForDepartment,
} from "./self-department";

const media = { slug: "media", ministry_type: "main" };
const leadership = { slug: "leadership_team", ministry_type: "main" };
const partTime = { slug: "sunday_band", ministry_type: "part_time" };

describe("verdictForDepartment", () => {
  it("allows null, empty, and whitespace without a ministry lookup", () => {
    expect(normalizeDepartment(null)).toBeNull();
    expect(normalizeDepartment("")).toBeNull();
    expect(normalizeDepartment(" \t\n\u00a0 ")).toBeNull();
    expect(normalizeDepartment("  media  ")).toBe("media");
    expect(isBlankDepartment(null)).toBe(true);
    expect(isBlankDepartment("")).toBe(true);
    expect(isBlankDepartment("   ")).toBe(true);
    for (const value of [null, "", "   "]) {
      expect(verdictForDepartment({ value, isStaff: false, ministry: null })).toEqual({
        ok: true,
      });
    }
  });

  it("refuses a non-staff caller before it cares what the slug is", () => {
    expect(callerMayChooseDepartment("student", false)).toBe(false);
    expect(callerMayChooseDepartment(null, false)).toBe(false);
    expect(callerMayChooseDepartment("staff", false)).toBe(true);
    expect(callerMayChooseDepartment(null, true)).toBe(true);
    expect(
      verdictForDepartment({ value: "media", isStaff: false, ministry: media })
    ).toEqual({ ok: false, status: 403, error: "Only staff choose a department." });
  });

  it("refuses leadership_team and part-time, and 400s an unknown slug", () => {
    expect(
      verdictForDepartment({ value: "leadership_team", isStaff: true, ministry: leadership })
    ).toEqual({
      ok: false,
      status: 403,
      error: onlyAdminDepartmentMessage("leadership_team"),
    });
    expect(
      verdictForDepartment({ value: "sunday_band", isStaff: true, ministry: partTime })
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      verdictForDepartment({ value: "not_a_ministry", isStaff: true, ministry: null })
    ).toEqual({ ok: false, status: 400, error: "Please select a valid department." });
  });

  it("allows a staff caller to pick a main ministry", () => {
    expect(verdictForDepartment({ value: "media", isStaff: true, ministry: media })).toEqual({
      ok: true,
    });
  });

  it("treats null and '' as distinct, matching IS DISTINCT FROM", () => {
    expect(isDistinct(null, "")).toBe(true);
    expect(isDistinct(null, null)).toBe(false);
    expect(isDistinct("media", "media")).toBe(false);
  });
});

describe("selfServiceDepartmentOptions", () => {
  const ministries = [
    { slug: "leadership_team", name: "Leadership Team" },
    { slug: "media", name: "Media" },
  ];

  it("hides leadership_team unless the person already has it", () => {
    expect(selfServiceDepartmentOptions(ministries, "media")).toEqual([
      { value: "media", label: "Media" },
    ]);
    expect(selfServiceDepartmentOptions(ministries, "leadership_team")).toEqual([
      { value: "media", label: "Media" },
      { value: "leadership_team", label: "Leadership Team" },
    ]);
  });
});
