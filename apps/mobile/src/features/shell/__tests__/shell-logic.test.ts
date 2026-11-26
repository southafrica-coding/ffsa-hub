import { act, renderHook } from "@testing-library/react-native";
import { House } from "lucide-react-native";

import { makeMe } from "../../../../test/fixtures";
import { can, hasRole, isAdmin, roleLabel, roleLabels } from "../access";
import { badgeText, getTabBadge, setTabBadge, useTabBadge } from "../badges";
import { TAB_LABEL_MAX_SCALE } from "../TabBar";
import { ROBOTO_EXTRABOLD, ROBOTO_MEDIUM, textWidth } from "../__fixtures__/font-metrics";
import {
  focusedPath,
  hidesTabBar,
  HOME_ROUTES,
  isTabRoot,
  routeSegment,
  TAB_BAR_HIDDEN_ROUTES,
  TABS,
  tabForRoute,
  visibleTabs,
  type TabDef,
} from "../tabs";

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
  it("are Home · Finance · Prayer · Tickets · Me for everyone, plus Training for Training staff", () => {
    expect(TABS.map((t) => t.label)).toEqual(["Home", "Training", "Finance", "Prayer", "Tickets", "Me"]);
    expect(visibleTabs(null).map((t) => t.id)).toEqual(["home", "finance", "prayer", "tickets", "me"]);
    expect(visibleTabs(makeMe({ roles: [], permissions: [] })).map((t) => t.id)).toEqual([
      "home",
      "finance",
      "prayer",
      "tickets",
      "me",
    ]);
  });

  // Labels are Roboto 500 (inactive) / 800 (active), 11pt growing to 13pt at
  // the largest text sizes (TAB_LABEL_MAX_SCALE). Widths come from the real
  // font files. Each tab is 1/n of a 360pt phone, minus 2pt padding a side.
  it.each([
    ["five tabs (everyone)", makeMe()],
    ["six tabs (Training staff)", makeMe({ training: { walkingWith: 1, programStaff: 0 } })],
  ])("%s: every label fits a 360pt phone at the largest tab size, in the bold active weight", (_name, me) => {
    const shown = visibleTabs(me);
    const slot = 360 / shown.length - 4;
    for (const t of shown) {
      const widest = 11 * TAB_LABEL_MAX_SCALE; // 13pt
      expect([t.label, textWidth(t.label, widest, ROBOTO_EXTRABOLD) <= slot]).toEqual([t.label, true]);
      expect(textWidth(t.label, widest, ROBOTO_MEDIUM)).toBeLessThanOrEqual(slot);
    }
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

  it("hidden routes (Bookings, Schools, History, OKRs, Ministries, Staff decisions) mark Home", () => {
    for (const route of ["bookings", "schools", "history", "okrs", "ministries", "staff-decisions", "bookings/index"]) {
      expect([route, tabForRoute(route)?.id]).toEqual([route, "home"]);
    }
    expect(HOME_ROUTES).toHaveLength(6);
    // …but they are never a tab's own root.
    const home = TABS.find((t) => t.id === "home")!;
    expect(isTabRoot("bookings", home)).toBe(false);
    expect(isTabRoot("index", home)).toBe(true);
  });

  it("focusedPath reads the focused screen through nested stacks", () => {
    const state = (tab: string, nested?: string[], index?: number) => ({
      index: 0,
      routes: [{ name: tab, state: nested ? { index: index ?? nested.length - 1, routes: nested.map((name) => ({ name })) } : undefined }],
    });
    expect(focusedPath(state("index"))).toBe("index");
    expect(focusedPath(state("tickets", ["index"]))).toBe("tickets");
    expect(focusedPath(state("tickets", ["index", "ticket/[id]"]))).toBe("tickets/ticket/[id]");
    expect(focusedPath(state("tickets", ["index", "ticket/[id]"], 0))).toBe("tickets");
    expect(focusedPath(state("bookings", ["index", "vehicle/[id]/[kind]"]))).toBe("bookings/vehicle/[id]/[kind]");
    // Before a nested navigator mounts there is no nested state.
    expect(focusedPath(state("finance"))).toBe("finance");
  });

  it("the tab bar hides on the ticket QR, the door scanner and full-height forms only", () => {
    for (const path of [
      "tickets/ticket/[id]",
      "tickets/check-in/[eventId]",
      "finance/[teamId]/new",
      "finance/receipt",
      "bookings/new",
      "bookings/vehicle/[id]/[kind]",
      "me/edit",
      "me/household-member",
    ]) {
      expect([path, hidesTabBar(path)]).toEqual([path, true]);
    }
    for (const path of ["index", "tickets", "tickets/check-in/index", "finance", "finance/[teamId]/index", "bookings", "me", "prayer"]) {
      expect([path, hidesTabBar(path)]).toEqual([path, false]);
    }
    expect(TAB_BAR_HIDDEN_ROUTES).toHaveLength(8);
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
