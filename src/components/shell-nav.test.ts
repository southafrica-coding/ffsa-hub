import { describe, expect, it } from "vitest";
import { ADMIN_MODULES, HIDDEN_FROM_NAV, SYSTEM_MODULES } from "@/config/modules";
import { buildShellNav, flattenShellNav } from "./shell-nav";

describe("buildShellNav", () => {
  it("keeps every live module for a super admin, and drops placeholders", () => {
    const nav = buildShellNav(["super_admin"]);
    const hrefs = new Set(flattenShellNav(nav).map((item) => item.href));

    for (const mod of [...ADMIN_MODULES, ...SYSTEM_MODULES]) {
      if (HIDDEN_FROM_NAV.has(mod.id)) {
        expect(hrefs.has(mod.href)).toBe(false);
        continue;
      }
      if (mod.id === "dashboard") {
        expect(hrefs.has("/home")).toBe(true);
        continue;
      }
      expect(hrefs.has(mod.href), mod.id).toBe(true);
    }
    expect(hrefs.has("/my-schools")).toBe(true);
    expect(hrefs.has("/my-mission")).toBe(false);
    expect(nav.services.map((item) => item.label)).toContain("Prayer room");
    expect(nav.services.map((item) => item.label)).toContain("Hire gear");
    expect(nav.departments).toEqual([]);
  });

  it("shows Ministries to Leadership Team, hides it from a member, and leaves ministry leaders on the permission", () => {
    const hrefs = (roles: string[], permitted?: Set<string>) =>
      buildShellNav(roles, permitted).work.map((item) => item.href);

    expect(hrefs(["leadership_team"])).toContain("/ministry");
    expect(hrefs(["self_service"])).not.toContain("/ministry");
    expect(hrefs(["ministry_leader"], new Set(["ministry"]))).toContain("/ministry");
    expect(hrefs(["ministry_leader"])).not.toContain("/ministry");
  });

  it("hides work tools the viewer cannot open", () => {
    const nav = buildShellNav(["staff"], new Set(["prayer-room"]));
    const labels = flattenShellNav(nav).map((item) => item.label);
    expect(labels).toContain("Prayer room");
    expect(labels).toContain("Home");
    expect(labels).not.toContain("Users");
    expect(labels).not.toContain("Contacts");
    expect(nav.services.find((item) => item.id === "hire-gear")?.href).toBe("/hire");
    const staffGear = buildShellNav(["staff"], new Set(["prayer-room"]), [], { equipmentStaff: true });
    expect(staffGear.services.find((item) => item.id === "hire-gear")?.href).toBe("/bookings/equipment");
  });
});
