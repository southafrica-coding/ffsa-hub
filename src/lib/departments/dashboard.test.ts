import { describe, expect, it } from "vitest";
import type { DepartmentViewer } from "@/types/departments";
import {
  addIsoDays,
  saTodayIso,
  selectHomeDashboard,
  selectMyDepartments,
  selectOkrCheckInsDue,
  selectRocksDue,
  selectServicesIUse,
} from "./dashboard";
import { getDepartmentViewer } from "./data";
import { OKR_CHECK_INS, ROCKS } from "./mocks";

const nobody: DepartmentViewer = {
  name: "Nobody",
  roles: ["staff"],
  permittedModules: [],
  memberships: [],
  usedServiceIds: [],
};

describe("home dashboard selectors", () => {
  it("reads today in Africa/Johannesburg", () => {
    expect(saTodayIso(new Date("2026-11-10T21:30:00Z"))).toBe("2026-11-10");
    expect(saTodayIso(new Date("2026-11-10T22:30:00Z"))).toBe("2026-11-11");
    expect(addIsoDays("2026-11-10", 14)).toBe("2026-11-24");
  });

  it("returns empty lists when the viewer has no ministry and no usage", () => {
    const home = selectHomeDashboard(nobody, "2026-11-10");
    expect(home.departments).toEqual([]);
    expect(home.services).toEqual([]);
    expect(home.rocksDue).toEqual([]);
    expect(home.okrCheckInsDue).toEqual([]);
  });

  it("drops excluded ministries from my departments", () => {
    const viewer: DepartmentViewer = {
      ...nobody,
      memberships: [
        { departmentSlug: "woven", capacity: "member" },
        { departmentSlug: "brave_love", capacity: "leader" },
        { departmentSlug: "no_ministry", capacity: "member" },
        { departmentSlug: "prayer_and_worship", capacity: "leader" },
      ],
    };
    expect(selectMyDepartments(viewer).map((home) => home.slug)).toEqual(["prayer_and_worship"]);
    expect(
      selectMyDepartments({
        ...viewer,
        memberships: [{ departmentSlug: "donors_dev", capacity: "member" }],
      })
    ).toEqual([]);
  });

  it("keeps services the viewer uses and can open", () => {
    const viewer: DepartmentViewer = {
      ...nobody,
      usedServiceIds: ["brand_kit", "prayer_room", "evangelism"],
    };
    expect(selectServicesIUse(viewer).map((service) => service.id)).toEqual(["prayer_room"]);

    const allowed: DepartmentViewer = {
      ...viewer,
      permittedModules: ["evangelism", "brand-kit"],
    };
    expect(selectServicesIUse(allowed).map((service) => service.id)).toEqual([
      "prayer_room",
      "brand_kit",
      "evangelism",
    ]);
  });

  it("includes overdue and soon rocks, and skips done or other ministries", () => {
    const slugs = new Set(["prayer_and_worship", "missio_ministry"]);
    expect(selectRocksDue(ROCKS, slugs, "2026-11-10").map((rock) => rock.id)).toEqual([
      "pw-rota",
      "mc-rota",
      "pw-coverage",
    ]);
    expect(selectRocksDue(ROCKS, slugs, "2026-11-10").some((rock) => rock.status === "done")).toBe(
      false
    );
  });

  it("includes open check-ins inside the window", () => {
    const slugs = new Set(["prayer_and_worship", "missio_ministry"]);
    expect(selectOkrCheckInsDue(OKR_CHECK_INS, slugs, "2026-11-10").map((row) => row.id)).toEqual([
      "mc-open",
      "pw-open",
    ]);
  });

  it("builds a fixture viewer's home from the mocks on 10 Nov 2026", () => {
    const viewer: DepartmentViewer = {
      name: "Test viewer",
      roles: ["staff"],
      permittedModules: ["bookings"],
      memberships: [
        { departmentSlug: "prayer_and_worship", capacity: "leader" },
        { departmentSlug: "missio_ministry", capacity: "member" },
      ],
      usedServiceIds: ["prayer_room", "vehicles", "gear_hire"],
    };
    const home = selectHomeDashboard(viewer, "2026-11-10");
    expect(home.departments.map((department) => department.name)).toEqual([
      "Prayer & Worship",
      "Missio Church",
    ]);
    expect(home.services.map((service) => service.id)).toEqual([
      "prayer_room",
      "vehicles",
      "gear_hire",
    ]);
    expect(home.rocksDue).toHaveLength(3);
    expect(home.okrCheckInsDue).toHaveLength(2);
  });

  it("fail-closes the page viewer", () => {
    const home = selectHomeDashboard(getDepartmentViewer(), "2026-11-10");
    expect(home.departments).toEqual([]);
    expect(home.services).toEqual([]);
    expect(home.rocksDue).toEqual([]);
    expect(home.okrCheckInsDue).toEqual([]);
  });
});
