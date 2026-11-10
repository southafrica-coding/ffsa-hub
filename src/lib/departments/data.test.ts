import { describe, expect, it } from "vitest";
import { ADMIN_MODULES } from "@/config/modules";
import type { DepartmentViewer, HubService } from "@/types/departments";
import {
  describeOwner,
  filterServices,
  getDepartmentPage,
  listDepartmentHomes,
  listServicesForViewer,
  resolveDepartment,
} from "./data";
import { formatZar } from "./money";
import {
  CLUSTER_LABEL,
  EXCLUDED_DEPARTMENT_SLUGS,
  MINISTRY_HOMES,
  SERVICES,
  STAFF_LANGUAGE,
} from "./mocks";

const staff: DepartmentViewer = {
  name: "Staff member",
  roles: ["staff"],
  permittedModules: [],
  memberships: [],
  usedServiceIds: [],
};

const admin: DepartmentViewer = {
  ...staff,
  name: "Admin",
  roles: ["admin"],
};

function withPermissions(modules: string[]): DepartmentViewer {
  return { ...staff, permittedModules: modules };
}

describe("department slug allow-list", () => {
  it("gives a home to every active staff ministry the plan keeps", () => {
    expect(listDepartmentHomes().map((home) => home.slug)).toEqual([
      "leadership-team",
      "prayer-worship",
      "training",
      "ed-for-life",
      "hulc",
      "project-54",
      "1040",
      "events",
      "operations",
      "finances-legal",
      "media",
      "donors-dev",
      "missio-church",
    ]);
  });

  it("resolves the URL slug and the live ministry slug to the same home", () => {
    const byUrl = resolveDepartment("prayer-worship");
    const byMinistry = resolveDepartment("prayer_and_worship");
    expect(byUrl?.name).toBe("Prayer & Worship");
    expect(byMinistry).toEqual(byUrl);
    expect(resolveDepartment("missio_ministry")?.slug).toBe("missio-church");
    expect(resolveDepartment("hulk")?.name).toBe("HULC");
    expect(resolveDepartment("education")?.name).toBe("Ed for Life");
  });

  it("404s part-time ministries, RCA, No Ministry, Woven and unknown slugs", () => {
    for (const slug of EXCLUDED_DEPARTMENT_SLUGS) {
      expect(resolveDepartment(slug), slug).toBeNull();
      expect(getDepartmentPage(slug, admin), slug).toBeNull();
    }
    expect(resolveDepartment("be-free")).toBeNull();
    expect(resolveDepartment("")).toBeNull();
  });

  it("keeps Missio Church as a full home and Ed for Life under Training", () => {
    const missio = getDepartmentPage("missio-church", admin);
    expect(missio?.tabs.map((tab) => tab.key)).toEqual([
      "overview",
      "people",
      "okrs",
      "rocks",
      "budget",
      "tools",
    ]);
    expect(missio?.department.cluster).toBe("alongside");
    const ed = getDepartmentPage("ed-for-life", admin);
    expect(ed?.parent?.slug).toBe("training");
  });

  it("does not use Inside or Outside ministry as a name", () => {
    const blob = JSON.stringify({
      CLUSTER_LABEL,
      MINISTRY_HOMES,
      SERVICES,
      STAFF_LANGUAGE,
    });
    expect(blob).not.toMatch(/inside ministry/i);
    expect(blob).not.toMatch(/outside ministry/i);
    expect(STAFF_LANGUAGE).toBe("FFSA staff with ministries under them");
  });
});

describe("services catalogue data", () => {
  it("deep-links prayer room, bookings, brand, comms, contacts and evangelism", () => {
    const href = (id: string) => SERVICES.find((service) => service.id === id)?.href;
    const moduleHref = (id: string) => ADMIN_MODULES.find((mod) => mod.id === id)?.href;
    expect(href("prayer-room")).toBe(moduleHref("prayer-room"));
    expect(href("brand-kit")).toBe(moduleHref("brand-kit"));
    expect(href("communications")).toBe(moduleHref("communications"));
    expect(href("contacts")).toBe(moduleHref("contacts"));
    expect(href("evangelism")).toBe(moduleHref("evangelism"));
    const bookings = moduleHref("bookings");
    expect(href("spaces")).toBe(`${bookings}/spaces`);
    expect(href("vehicles")).toBe(`${bookings}/vehicles`);
    expect(href("gear")).toBe(`${bookings}/equipment`);
  });

  it("badges the owning department, and says when that owner is still assumed", () => {
    const prayer = SERVICES.find((service) => service.id === "prayer-room")!;
    expect(describeOwner(prayer)).toBe("Prayer & Worship");
    expect(describeOwner(SERVICES.find((service) => service.id === "spaces")!)).toBe(
      "Operations (to confirm)"
    );
    expect(describeOwner(SERVICES.find((service) => service.id === "contacts")!)).toBe(
      "Owner to confirm"
    );
  });

  it("hides a service the viewer cannot open, including evangelism", () => {
    expect(listServicesForViewer(staff).map((service) => service.id)).toEqual(["prayer-room"]);
    expect(listServicesForViewer(withPermissions(["bookings", "evangelism"])).map((s) => s.id)).toEqual(
      ["prayer-room", "spaces", "vehicles", "gear", "evangelism"]
    );
    expect(listServicesForViewer(admin).map((service) => service.id)).toContain("evangelism");
    expect(filterServices(SERVICES, admin, false).map((service) => service.id)).not.toContain(
      "evangelism"
    );
  });

  it("hides a service whose module is flag-hidden", () => {
    const hidden: HubService = {
      id: "mission",
      name: "Mission",
      summary: "Placeholder",
      href: "/mission",
      moduleId: "mission",
      ownerSlug: null,
      ownerAssumed: false,
    };
    expect(filterServices([hidden], admin)).toEqual([]);
  });
});

describe("department page model", () => {
  it("lists services Prayer & Worship runs, and filters tools by access", () => {
    const page = getDepartmentPage("prayer-worship", staff);
    expect(page?.services.map((service) => service.id)).toEqual(["prayer-room"]);
    expect(page?.tabs.map((tab) => tab.label)).toContain("Services we run");
    expect(page?.tools.map((tool) => tool.label)).toEqual(["Prayer room", "OKRs"]);
    expect(page?.leaders.map((person) => person.name)).toEqual([
      "Davis Crouch",
      "Jack Kilman",
      "Jolizna Roestorf",
    ]);
    expect(page?.department.memberCount).toBe(16);
  });

  it("leaves rocks and budget empty where nothing is linked yet", () => {
    const page = getDepartmentPage("donors-dev", admin);
    expect(page?.leaders).toEqual([]);
    expect(page?.people).toEqual([]);
    expect(page?.rocks).toEqual([]);
    expect(page?.budget.project).toBeNull();
    expect(page?.okrs.objectives).toEqual([]);
    expect(page?.okrs.href).toBe("/okrs?cycle=2026");
  });

  it("formats budget amounts in rand", () => {
    expect(formatZar(186_000)).toBe("R\u00a0186\u00a0000");
    expect(formatZar(74_200)).toBe("R\u00a074\u00a0200");
    const page = getDepartmentPage("prayer-worship", admin);
    expect(page?.budget.project?.budgetRand).toBe(186_000);
  });
});
