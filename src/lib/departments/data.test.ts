import { describe, expect, it } from "vitest";
import type { DepartmentAccess, DepartmentHome, HubService } from "@/lib/departments/ui-contract";
import { managingLabel, visibleTabs } from "./data";
import { formatZarFromCents } from "./money";
import { SERVICES } from "./mocks";

const flags = (overrides: Partial<DepartmentAccess> = {}): DepartmentAccess => ({
  canSeeDepartmentDetail: true,
  canSeeBudget: false,
  canEditBudget: false,
  canEditRocks: false,
  canSeePeopleEmails: false,
  ...overrides,
});

function home(access: DepartmentAccess, servicesRun: DepartmentHome["servicesRun"] = []): DepartmentHome {
  return {
    department: {
      slug: "prayer_and_worship",
      name: "Prayer & Worship",
      cluster: "inward",
      parentSlug: null,
      parentName: null,
      purpose: null,
      memberCount: access.canSeeDepartmentDetail ? 2 : null,
      active: true,
      budgetOnly: access.canSeeBudget && !access.canSeeDepartmentDetail,
      viewerMembership: "none",
      access,
    },
    access,
    viewerMemberships: [],
    people: null,
    okrs: null,
    rocks: null,
    budget: null,
    servicesRun,
    subMinistries: null,
  };
}

describe("tabs follow the API access object", () => {
  it("hides budget when the payload says so", () => {
    const page = home(flags());
    expect(visibleTabs(page)).toEqual(["overview", "people", "okrs", "rocks"]);
    expect(visibleTabs(page)).not.toContain("budget");
  });

  it("shows only budget for a finance-only payload", () => {
    const page = home(flags({ canSeeDepartmentDetail: false, canSeeBudget: true }));
    expect(page.department.budgetOnly).toBe(true);
    expect(page.department.memberCount).toBeNull();
    expect(visibleTabs(page)).toEqual(["budget"]);
  });

  it("shows budget for a leader payload", () => {
    const page = home(
      flags({ canSeeBudget: true, canEditBudget: true, canEditRocks: true, canSeePeopleEmails: true }),
      [{ serviceId: "prayer_room", role: "owner" }]
    );
    expect(visibleTabs(page)).toEqual(["overview", "people", "okrs", "rocks", "services", "budget"]);
  });
});

describe("service labels", () => {
  it("uses department names from the API list and keeps the evangelism line", () => {
    const names = new Map([
      ["prayer_and_worship", "Prayer & Worship"],
      ["media", "Media"],
      ["hulk", "HULC"],
    ]);
    expect(managingLabel(SERVICES.find((service) => service.id === "prayer_room")!, names)).toBe(
      "Prayer & Worship"
    );
    expect(managingLabel(SERVICES.find((service) => service.id === "evangelism")!, names)).toBe(
      "Moderated by Media, HULC and anyone with evangelism moderation"
    );
  });

  it("does not invent a name the API list did not send", () => {
    const service: HubService = {
      id: "brand_kit",
      name: "Brand kit",
      summary: "",
      href: "/brand-kit",
      moduleId: "brand-kit",
      owners: [{ slug: "media", role: "owner" }],
      audience: "all_signed_in",
    };
    expect(managingLabel(service)).toBe("media");
  });
});

describe("money", () => {
  it("formats budget cents as whole rands", () => {
    expect(formatZarFromCents(1_234_500)).toBe("R 12 345");
    expect(formatZarFromCents(0)).toBe("R 0");
    expect(formatZarFromCents(-100)).toBe("-R 1");
  });
});
