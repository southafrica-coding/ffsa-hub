import { describe, expect, it } from "vitest";
import { ADMIN_MODULES } from "@/config/modules";
import type { DepartmentViewer, HubService } from "@/types/departments";
import { DEPARTMENT_HOME_SLUGS, FOLDED_INTO, NON_HOME_SLUGS } from "./allow-list";
import {
  filterServices,
  foldTarget,
  getDepartmentHome,
  getDepartmentPage,
  getDepartmentViewer,
  listDepartmentHomes,
  listServicesForViewer,
  managingLabel,
  resolveDepartment,
  subMinistriesOf,
} from "./data";
import { formatZarFromCents } from "./money";
import { CLUSTER_LABEL, FOLDED_MINISTRIES, MINISTRY_HOMES, SERVICES, STAFF_LANGUAGE } from "./mocks";

const staff: DepartmentViewer = {
  name: "Test viewer",
  roles: ["staff"],
  permittedModules: [],
  memberships: [],
  usedServiceIds: [],
};

const admin: DepartmentViewer = {
  ...staff,
  name: "Test admin",
  roles: ["admin"],
};

function withPermissions(modules: string[]): DepartmentViewer {
  return { ...staff, permittedModules: modules };
}

describe("department slug allow-list", () => {
  it("is the one home list, using staff_ministries slugs", () => {
    expect(listDepartmentHomes().map((home) => home.slug)).toEqual([...DEPARTMENT_HOME_SLUGS]);
    expect(DEPARTMENT_HOME_SLUGS).not.toContain("donors_dev");
  });

  it("resolves the stored slug and nothing hyphenated", () => {
    expect(resolveDepartment("prayer_and_worship")?.name).toBe("Prayer & Worship");
    expect(resolveDepartment("missio_ministry")?.name).toBe("Missio Church");
    expect(resolveDepartment("hulk")?.name).toBe("HULC");
    expect(resolveDepartment("education")?.name).toBe("Ed for Life");
    expect(resolveDepartment("prayer-worship")).toBeNull();
    expect(resolveDepartment("missio-church")).toBeNull();
    expect(resolveDepartment("ed-for-life")).toBeNull();
    expect(getDepartmentPage("prayer-worship", admin)).toBeNull();
  });

  it("404s part-time ministries, RCA, No Ministry, and inactive slugs", () => {
    for (const slug of NON_HOME_SLUGS) {
      expect(resolveDepartment(slug), slug).toBeNull();
      expect(foldTarget(slug), slug).toBeNull();
      expect(getDepartmentPage(slug, admin), slug).toBeNull();
    }
    expect(resolveDepartment("be-free")).toBeNull();
    expect(resolveDepartment("")).toBeNull();
  });

  it("folds only donors_dev, and prefers parent_id when it is set", () => {
    expect(FOLDED_INTO).toEqual({ donors_dev: "finances_legal" });
    expect(foldTarget("donors_dev")).toBe("finances_legal");
    expect(resolveDepartment("donors_dev")).toBeNull();
    expect(getDepartmentPage("donors_dev", admin)).toBeNull();
    expect(
      foldTarget("donors_dev", [{ slug: "donors_dev", parentSlug: "finances_legal" }])
    ).toBe("finances_legal");
    expect(foldTarget("donors_dev", [{ slug: "donors_dev", parentSlug: "media" }])).toBe("media");
    expect(foldTarget("education")).toBeNull();
    expect(resolveDepartment("education")?.parentSlug).toBe("training");
    expect(foldTarget("rooted_christian_academy")).toBeNull();
  });

  it("lists Donors & Dev under Finances & Legal and keeps Ed for Life a home", () => {
    const finances = getDepartmentPage("finances_legal", admin);
    expect(finances?.subMinistries.map((ministry) => ministry.slug)).toEqual(["donors_dev"]);
    expect(finances?.subMinistries[0]?.name).toBe("Donors & Dev");
    expect(getDepartmentHome("finances_legal")?.subMinistries).toEqual(subMinistriesOf("finances_legal"));
    expect(getDepartmentPage("education", admin)?.parent?.slug).toBe("training");
    expect(getDepartmentPage("missio_ministry", admin)?.tabs.map((tab) => tab.key)).not.toContain(
      "services"
    );
  });

  it("does not use Inside or Outside ministry as a name, or real staff names", () => {
    const blob = JSON.stringify({
      CLUSTER_LABEL,
      MINISTRY_HOMES,
      FOLDED_MINISTRIES,
      SERVICES,
      STAFF_LANGUAGE,
    });
    expect(blob).not.toMatch(/inside ministry/i);
    expect(blob).not.toMatch(/outside ministry/i);
    expect(blob).not.toMatch(/Jack|Gabriël|Gabriel|Davis|Allyson|Coreen|Tosca|Dwayne|Caleb/);
    expect(STAFF_LANGUAGE).toBe("FFSA staff with ministries under them");
  });
});

describe("services catalogue data", () => {
  it("uses gear_hire and the confirmed relationships", () => {
    const byId = Object.fromEntries(SERVICES.map((service) => [service.id, service]));
    expect(byId.gear_hire.owners.map((link) => link.slug)).toEqual([
      "prayer_and_worship",
      "operations",
      "media",
    ]);
    expect(byId.prayer_room.owners).toEqual([{ slug: "prayer_and_worship", role: "owner" }]);
    expect(byId.spaces.owners).toEqual([{ slug: "operations", role: "owner" }]);
    expect(byId.vehicles.owners).toEqual([{ slug: "operations", role: "owner" }]);
    expect(byId.brand_kit.owners).toEqual([{ slug: "media", role: "owner" }]);
    expect(byId.communications.owners).toEqual([
      { slug: "media", role: "manager" },
      { slug: "hulk", role: "access" },
      { slug: "leadership_team", role: "access" },
    ]);
    expect(byId.communications.audience).toBe("owners_only");
    expect(byId.contacts.audience).toBe("ministry_leaders");
    expect(byId.contacts.owners.every((link) => link.role === "manager")).toBe(true);
    expect(byId.evangelism.audience).toBe("all_signed_in");
    expect(byId.evangelism.owners).toEqual([
      { slug: "media", role: "moderator" },
      { slug: "hulk", role: "moderator" },
    ]);
    expect(byId.prayer_room.href).toBe(ADMIN_MODULES.find((mod) => mod.id === "prayer-room")?.href);
    const bookings = ADMIN_MODULES.find((mod) => mod.id === "bookings")?.href;
    expect(byId.gear_hire.href).toBe(`${bookings}/equipment`);
  });

  it("names managing departments without a to-confirm line", () => {
    expect(managingLabel(SERVICES.find((service) => service.id === "prayer_room")!)).toBe(
      "Prayer & Worship"
    );
    expect(managingLabel(SERVICES.find((service) => service.id === "communications")!)).toBe("Media");
    expect(managingLabel(SERVICES.find((service) => service.id === "contacts")!)).toBe(
      "Media, HULC, Leadership Team"
    );
    expect(managingLabel(SERVICES.find((service) => service.id === "evangelism")!)).toBe(
      "Moderators: Media, HULC"
    );
    expect(JSON.stringify(SERVICES)).not.toMatch(/to confirm/i);
  });

  it("hides a service the viewer cannot open, including evangelism", () => {
    expect(listServicesForViewer(staff).map((service) => service.id)).toEqual(["prayer_room"]);
    expect(listServicesForViewer(getDepartmentViewer()).map((service) => service.id)).toEqual([
      "prayer_room",
    ]);
    expect(
      listServicesForViewer(withPermissions(["bookings", "evangelism"])).map((service) => service.id)
    ).toEqual(["prayer_room", "spaces", "vehicles", "gear_hire", "evangelism"]);
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
      owners: [],
      audience: "all_signed_in",
    };
    expect(filterServices([hidden], admin)).toEqual([]);
  });
});

describe("department page model", () => {
  it("labels the roles Prayer & Worship runs, and filters tools by access", () => {
    const page = getDepartmentPage("prayer_and_worship", staff);
    expect(page?.services.map((service) => [service.id, service.role])).toEqual([
      ["prayer_room", "owner"],
      ["gear_hire", "owner"],
    ]);
    expect(page?.tools.map((tool) => tool.label)).toEqual(["Prayer room", "OKRs"]);
    expect(page?.leaders.map((person) => person.name)).toEqual(["Test Leader A", "Test Leader B"]);
  });

  it("shows manager and moderator roles, and leaves access off the tab", () => {
    const media = getDepartmentPage("media", admin);
    expect(media?.services.map((service) => [service.id, service.role])).toEqual([
      ["gear_hire", "owner"],
      ["brand_kit", "owner"],
      ["communications", "manager"],
      ["contacts", "manager"],
      ["evangelism", "moderator"],
    ]);
    const hulc = getDepartmentPage("hulk", admin);
    expect(hulc?.services.map((service) => service.id)).toEqual(["contacts", "evangelism"]);
    expect(hulc?.services.map((service) => service.id)).not.toContain("communications");
  });

  it("leaves rocks and budget empty where nothing is linked yet", () => {
    const page = getDepartmentPage("leadership_team", admin);
    expect(page?.budget.project).toBeNull();
    expect(page?.okrs.href).toBe("/okrs?cycle=2026");
  });

  it("formats budget cents as whole rands", () => {
    expect(formatZarFromCents(1_234_500)).toBe("R 12 345");
    expect(formatZarFromCents(1_000_000)).toBe("R 10 000");
    expect(formatZarFromCents(0)).toBe("R 0");
    expect(formatZarFromCents(-100)).toBe("-R 1");
    const page = getDepartmentPage("prayer_and_worship", admin);
    expect(page?.budget.project?.budgetCents).toBe(1_000_000);
    expect(page?.budget.project?.spentCents).toBe(500_000);
  });

  it("returns no access from the page viewer", () => {
    const viewer = getDepartmentViewer();
    expect(viewer.roles).toEqual([]);
    expect(viewer.permittedModules).toEqual([]);
    expect(viewer.memberships).toEqual([]);
    expect(viewer.usedServiceIds).toEqual([]);
  });
});
