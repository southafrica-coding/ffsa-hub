import { describe, expect, it } from "vitest";
import {
  ACCESS_LIST_MODULES,
  ADMIN_MODULES,
  HIDDEN_FROM_NAV,
  PORTAL_TABS,
  SYSTEM_MODULES,
  getAccessibleModules,
  getVisiblePortalTabs,
  isHiddenFromNav,
} from "./modules";

// The unbuilt placeholder pages (Teams, Mission, My Mission) stay
// out of every menu for every role; everything that works stays put.

const PLACEHOLDERS = ["teams", "mission", "my-mission"];

const ids = (mods: { id: string }[]) => mods.map((m) => m.id);

describe("placeholder pages are hidden from navigation", () => {
  it("hides exactly the three placeholders", () => {
    expect([...HIDDEN_FROM_NAV].sort()).toEqual([...PLACEHOLDERS].sort());
    for (const id of PLACEHOLDERS) expect(isHiddenFromNav(id)).toBe(true);
    expect(isHiddenFromNav("finance")).toBe(false);
  });

  it.each([
    ["Super Admin", ["super_admin"]],
    ["General Admin", ["admin"]],
    ["Team Leader", ["team_leader"]],
    ["Mission Leader", ["mission_leader"]],
    ["Staff", ["staff"]],
  ])("%s never sees them in the admin menu", (_label, roles) => {
    // Even with a permission grant for every placeholder module.
    const permitted = new Set(["teams", "mission", "evangelism"]);
    const visible = ids(getAccessibleModules(ADMIN_MODULES, roles, permitted));
    for (const id of PLACEHOLDERS) expect(visible).not.toContain(id);
  });

  it("leaves the personal menu without My Mission but with every working tab", () => {
    const tabs = ids(getVisiblePortalTabs());
    expect(tabs).not.toContain("my-mission");
    expect(tabs).toEqual(ids(PORTAL_TABS).filter((id) => id !== "my-mission"));
    expect(tabs).toEqual(
      expect.arrayContaining(["profile", "my-events", "my-finance", "my-schools", "my-history"])
    );
  });

  it("keeps every working module for a Super Admin", () => {
    const visible = ids(getAccessibleModules(ADMIN_MODULES, ["super_admin"]));
    const working = ids(ADMIN_MODULES).filter((id) => !PLACEHOLDERS.includes(id));
    expect(visible).toEqual(working);
    expect(ids(getAccessibleModules(SYSTEM_MODULES, ["super_admin"]))).toEqual(
      ids(SYSTEM_MODULES).filter((id) => !ACCESS_LIST_MODULES.has(id))
    );
  });

  it("shows Legal → Documents only to people on its access list, whatever their role", () => {
    const has = (roles: string[], permitted: string[]) =>
      ids(getAccessibleModules(SYSTEM_MODULES, roles, new Set(permitted))).includes("legal-documents");
    expect(has(["super_admin"], [])).toBe(false);
    expect(has(["admin"], [])).toBe(false);
    expect(has(["legal_admin"], ["legal"])).toBe(false);
    expect(has(["staff"], ["legal-documents"])).toBe(true);
    expect(has(["super_admin"], ["legal-documents"])).toBe(true);
  });

  it("shows Staff decisions to Leadership Team and Super Admin, never to a plain admin", () => {
    const has = (roles: string[]) =>
      ids(getAccessibleModules(ADMIN_MODULES, roles, new Set())).includes("staff-decisions");
    expect(has(["leadership_team"])).toBe(true);
    expect(has(["super_admin"])).toBe(true);
    expect(has(["admin"])).toBe(false);
    expect(has(["staff"])).toBe(false);
  });

  it("still gives everyone the always-open modules", () => {
    const visible = ids(getAccessibleModules(ADMIN_MODULES, ["staff"], new Set()));
    expect(visible).toEqual(expect.arrayContaining(["dashboard", "finance", "prayer-room", "okrs"]));
  });

  it("shows Evangelism to admins and to anyone with an evangelism permission", () => {
    const has = (roles: string[], permitted: string[] = []) =>
      ids(getAccessibleModules(ADMIN_MODULES, roles, new Set(permitted))).includes("evangelism");
    expect(isHiddenFromNav("evangelism")).toBe(false);
    expect(has(["super_admin"])).toBe(true);
    expect(has(["admin"])).toBe(true);
    expect(has(["staff"], ["evangelism"])).toBe(true);
    expect(has(["staff"])).toBe(false);
  });

  it("does not change permission-based access to working modules", () => {
    const visible = ids(getAccessibleModules(ADMIN_MODULES, ["staff"], new Set(["events", "teams"])));
    expect(visible).toContain("events");
    expect(visible).not.toContain("teams");
  });
});
