import { describe, expect, it } from "vitest";
import { ADMIN_MODULES, HIDDEN_FROM_NAV, SYSTEM_MODULES } from "@/config/modules";
import { buildShellNav, flattenShellNav, PORTAL_SHELL_LINKS, shellVariantForRoles } from "./shell-nav";

describe("shellVariantForRoles", () => {
  it("treats membership roles as portal-only and any other role as staff", () => {
    expect(shellVariantForRoles(["student"])).toBe("portal");
    expect(shellVariantForRoles(["community_member", "self_service"])).toBe("portal");
    expect(shellVariantForRoles([])).toBe("portal");
    expect(shellVariantForRoles(["staff"])).toBe("staff");
    expect(shellVariantForRoles(["student", "staff"])).toBe("staff");
    expect(shellVariantForRoles(["ministry_leader"])).toBe("staff");
  });

  it("gives a student with a direct module grant the staff shell", () => {
    expect(shellVariantForRoles(["student"], { permittedModules: new Set(["schools"]) })).toBe("staff");
    expect(shellVariantForRoles(["self_service"], { permittedModules: ["bookings"] })).toBe("staff");
  });

  it("gives a student with a scoped role the staff shell", () => {
    expect(shellVariantForRoles(["student", "program_leader"])).toBe("staff");
  });

  it("gives a student with a department the staff shell", () => {
    expect(shellVariantForRoles(["student"], { departments: [{ slug: "media" }] })).toBe("staff");
  });

  it("keeps a student, and a person with no roles, on the portal", () => {
    expect(shellVariantForRoles(["student"], { permittedModules: new Set(), departments: [] })).toBe("portal");
    expect(shellVariantForRoles([], { permittedModules: new Set(), departments: [] })).toBe("portal");
  });
});

describe("buildShellNav", () => {
  it("keeps every live module for a super admin, and drops placeholders", () => {
    const nav = buildShellNav(["super_admin"]);
    const hrefs = new Set(flattenShellNav(nav).map((item) => item.href));

    for (const mod of [...ADMIN_MODULES, ...SYSTEM_MODULES]) {
      if (HIDDEN_FROM_NAV.has(mod.id)) {
        expect(hrefs.has(mod.href)).toBe(false);
        continue;
      }
      expect(hrefs.has(mod.href), mod.id).toBe(true);
    }
    expect(hrefs.has("/home")).toBe(true);
    expect(hrefs.has("/my-schools")).toBe(true);
    expect(hrefs.has("/my-mission")).toBe(false);
    expect(nav.services.map((item) => item.label)).toContain("Prayer room");
    expect(nav.services.map((item) => item.label)).toContain("Hire gear");
    expect(nav.departments).toEqual([]);
    expect(nav.portalLinks).toEqual([]);
  });

  it("keeps Home on /home and puts Dashboard under Work tools", () => {
    const nav = buildShellNav(["super_admin"]);
    expect(nav.home).toMatchObject({ label: "Home", href: "/home" });
    expect(nav.work[0]).toMatchObject({ id: "dashboard", label: "Dashboard", href: "/dashboard" });
    expect(nav.work.some((item) => item.label === "Home")).toBe(false);
    expect(flattenShellNav(nav).filter((item) => item.label === "Home").map((item) => item.href)).toEqual(["/home"]);
  });

  it("uses Finance for the staff office and keeps My finance in the avatar menu", () => {
    const nav = buildShellNav(["staff"], new Set(["prayer-room"]));
    expect(nav.work.some((item) => item.label === "Finance" && item.href === "/finance")).toBe(true);
    expect(nav.me).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "My finance", href: "/my-finance" }),
        expect.objectContaining({ label: "Finance", href: "/finance" }),
      ])
    );
  });

  it("gives the portal shell the phone tabs and keeps staff Finance off it", () => {
    const nav = buildShellNav(["finance_admin"], new Set(["finance"]), [], { variant: "portal" });
    expect(nav.portalLinks.map((item) => [item.label, item.href])).toEqual(
      PORTAL_SHELL_LINKS.map((item) => [item.label, item.href])
    );
    expect(nav.services).toEqual([]);
    expect(nav.work).toEqual([]);
    expect(nav.system).toEqual([]);
    expect(nav.departments).toEqual([]);
    expect(nav.home).toBeNull();
    const finance = nav.me.filter((item) => item.label === "Finance");
    expect(finance.map((item) => item.href)).toEqual(["/my-finance"]);
    expect(flattenShellNav(nav).some((item) => item.href === "/finance" || item.href === "/dashboard")).toBe(false);
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
