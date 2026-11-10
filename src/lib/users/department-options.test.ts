import { describe, expect, it } from "vitest";
import { shapeDepartmentOptions } from "@/lib/mobile/staff-decisions";
import {
  adminDepartmentOptions,
  departmentChoice,
  labelForDepartment,
  staffDecisionDepartmentOptions,
} from "./department-options";

const ministries = [
  { slug: "leadership_team", name: "Leadership Team" },
  { slug: "media", name: "Media" },
  { slug: "operations", name: "Operations" },
];

const withoutLeadership = [
  { value: "media", label: "Media" },
  { value: "operations", label: "Operations" },
];

describe("department option lists", () => {
  it("omits leadership_team from the staff-decision dropdown and the mobile department list", () => {
    expect(staffDecisionDepartmentOptions(ministries)).toEqual(withoutLeadership);
    expect(staffDecisionDepartmentOptions(null)).toEqual([]);
    // The phone picker (including a self-set) is this list.
    expect(shapeDepartmentOptions(ministries)).toEqual(withoutLeadership);
    expect(shapeDepartmentOptions(undefined)).toEqual([]);
  });

  it("keeps leadership_team available on the admin user-edit list", () => {
    expect(adminDepartmentOptions(ministries)).toEqual([
      { value: "leadership_team", label: "Leadership Team" },
      ...withoutLeadership,
    ]);
    expect(adminDepartmentOptions(null)).toEqual([]);
  });

  it("still names an existing leadership_team, and does not preselect it when it is not a choice", () => {
    expect(labelForDepartment("leadership_team", withoutLeadership)).toBe("Leadership Team");
    expect(labelForDepartment("media", withoutLeadership)).toBe("Media");
    expect(labelForDepartment("retired_slug", withoutLeadership)).toBe("retired_slug");
    expect(labelForDepartment(null)).toBeNull();
    expect(departmentChoice("leadership_team", withoutLeadership)).toBe("");
    expect(departmentChoice("media", withoutLeadership)).toBe("media");
    expect(departmentChoice("leadership_team", withoutLeadership, "__later__")).toBe("__later__");
  });
});
