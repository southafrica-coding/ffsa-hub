import { act, renderHook } from "@testing-library/react-native";
import { House } from "lucide-react-native";

import { makeMe } from "../../../../test/fixtures";
import { can, hasRole, isAdmin, roleLabel, roleLabels } from "../access";
import { badgeText, getTabBadge, setTabBadge, useTabBadge } from "../badges";
import { routeSegment, TABS, tabForRoute, visibleTabs, type TabDef } from "../tabs";

describe("access (UX gates from /api/me)", () => {
  const staff = makeMe();
  const admin = makeMe({ roles: [{ name: "admin", scopeType: null, scopeId: null }], permissions: [] });

  it("can() is true for a held permission, any scope", () => {
    expect(can(staff, "events.view")).toBe(true);
    expect(can(makeMe({ permissions: [{ key: "x.y", scopeType: "event", scopeId: "e1", source: "direct" }] }), "x.y")).toBe(true);
  });

  it("can() is false for a missing permission and while /api/me is loading", () => {
    expect(can(staff, "events.manage_attendance")).toBe(false);
    expect(can(null, "events.view")).toBe(false);
  });

  it("admins pass every gate, like the web", () => {
    expect(isAdmin(admin)).toBe(true);
    expect(can(admin, "events.manage_attendance")).toBe(true);
    expect(isAdmin(staff)).toBe(false);
  });

  it("hasRole matches by name", () => {
    expect(hasRole(staff, "staff")).toBe(true);
    expect(hasRole(staff, "admin")).toBe(false);
    expect(hasRole(null, "staff")).toBe(false);
  });

  it("role labels are readable and de-duplicated", () => {
    expect(roleLabel("team_leader")).toBe("Team leader");
    expect(roleLabel("super_admin")).toBe("Super admin");
    const me = makeMe({
      roles: [
        { name: "team_leader", scopeType: "outreach_team", scopeId: "t1" },
        { name: "team_leader", scopeType: "outreach_team", scopeId: "t2" },
        { name: "staff", scopeType: null, scopeId: null },
      ],
    });
    expect(roleLabels(me)).toEqual(["Team leader", "Staff"]);
    expect(roleLabels(null)).toEqual([]);
  });
});

describe("tabs", () => {
  it("are Home · Finance · Tickets · Me, for everyone", () => {
    expect(TABS.map((t) => t.label)).toEqual(["Home", "Finance", "Tickets", "Me"]);
    expect(visibleTabs(null).map((t) => t.id)).toEqual(["home", "finance", "tickets", "me"]);
    expect(visibleTabs(makeMe({ roles: [], permissions: [] })).map((t) => t.id)).toEqual([
      "home",
      "finance",
      "tickets",
      "me",
    ]);
  });

  it("match routes on the first segment, so placeholders and real slices are the same tab", () => {
    expect(routeSegment("finance/index")).toBe("finance");
    expect(tabForRoute("finance")?.id).toBe("finance");
    expect(tabForRoute("finance/index")?.id).toBe("finance");
    expect(tabForRoute("tickets/check-in/[id]")?.id).toBe("tickets");
    expect(tabForRoute("index")?.id).toBe("home");
    expect(tabForRoute("me")?.id).toBe("me");
    expect(tabForRoute("+not-found")).toBeUndefined();
  });

  it("a gated tab shows only to people who pass its gate", () => {
    const gated: TabDef[] = [
      ...TABS,
      { id: "me", segment: "door", label: "Door", icon: House, visible: (me) => can(me, "events.manage_attendance") },
    ];
    const door = (me: ReturnType<typeof makeMe> | null) => visibleTabs(me, gated).some((t) => t.label === "Door");
    expect(door(makeMe())).toBe(false);
    expect(door(null)).toBe(false);
    expect(
      door(makeMe({ permissions: [{ key: "events.manage_attendance", scopeType: null, scopeId: null, source: "role" }] })),
    ).toBe(true);
  });
});

describe("tab badges", () => {
  it("store counts per tab and notify subscribers", async () => {
    const { result } = await renderHook(() => useTabBadge("home"));
    expect(result.current).toBe(0);
    await act(async () => setTabBadge("home", 3));
    expect(result.current).toBe(3);
    expect(getTabBadge("finance")).toBe(0);
    await act(async () => setTabBadge("home", 0));
  });

  it("never go negative or fractional", () => {
    setTabBadge("home", -2);
    expect(getTabBadge("home")).toBe(0);
    setTabBadge("home", 2.7);
    expect(getTabBadge("home")).toBe(2);
    setTabBadge("home", 0);
  });

  it("cap the text at 99+", () => {
    expect(badgeText(7)).toBe("7");
    expect(badgeText(150)).toBe("99+");
  });
});
