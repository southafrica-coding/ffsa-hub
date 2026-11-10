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

  it("hides work tools the viewer cannot open", () => {
    const nav = buildShellNav(["staff"], new Set(["prayer-room"]));
    const labels = flattenShellNav(nav).map((item) => item.label);
    expect(labels).toContain("Prayer room");
    expect(labels).toContain("Home");
    expect(labels).not.toContain("Users");
    expect(labels).not.toContain("Contacts");
    expect(labels).toContain("Hire gear");
  });
});
