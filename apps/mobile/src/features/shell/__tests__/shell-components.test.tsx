import type { BottomTabBarProps } from "expo-router/js-tabs";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import { Ticket } from "lucide-react-native";
import type { ReactNode } from "react";

import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

import { apiRoutes, makeMe } from "../../../../test/fixtures";
import { can } from "../access";
import { setTabBadge } from "../badges";
import { MeProvider, useCan, useHasRole, useMe } from "../me-context";
import { TabBar } from "../TabBar";
import { TABS, type TabDef } from "../tabs";

jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
const mockFetch = apiFetch as unknown as jest.Mock;

const wrapper = ({ children }: { children: ReactNode }) => <MeProvider>{children}</MeProvider>;

beforeEach(() => mockFetch.mockReset());

describe("useMe / useCan", () => {
  it("loads GET /api/me once and answers permission checks", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe() }));
    const { result } = await renderHook(
      () => ({ me: useMe(), canView: useCan("events.view"), canDoor: useCan("events.manage_attendance"), staff: useHasRole("staff") }),
      { wrapper },
    );
    expect(result.current.me.status).toBe("ready");
    expect(result.current.me.me?.user.email).toBe("sample@example.org");
    expect(result.current.canView).toBe(true);
    expect(result.current.canDoor).toBe(false);
    expect(result.current.staff).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("is 'loading' with every gate closed until /api/me answers", async () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const { result } = await renderHook(() => ({ me: useMe(), can: useCan("events.view") }), { wrapper });
    expect(result.current.me.status).toBe("loading");
    expect(result.current.can).toBe(false);
  });

  it("reports a plain error, and refresh() tries again", async () => {
    mockFetch.mockRejectedValueOnce(new ApiError("network", "Couldn't reach FFSA Hub. Check your connection and try again."));
    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe() }));
    const { result } = await renderHook(() => useMe(), { wrapper });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatch(/Couldn't reach FFSA Hub/);
    await act(async () => result.current.refresh());
    expect(result.current.status).toBe("ready");
  });

  it("stays quiet when the API has signed the user out (the auth gate takes over)", async () => {
    mockFetch.mockRejectedValue(new ApiError("unauthenticated", "x", 401));
    const { result } = await renderHook(() => useMe(), { wrapper });
    expect(result.current.status).toBe("loading");
    expect(result.current.error).toBeNull();
  });

  it("throws a clear message when used outside the signed-in area", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(renderHook(() => useMe())).rejects.toThrow(/MeProvider/);
    (console.error as jest.Mock).mockRestore();
  });
});

// A minimal stand-in for the navigator's tab-bar props.
function barProps(routeNames: string[], index = 0) {
  const routes = routeNames.map((name) => ({ key: `${name}-key`, name }));
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  const navigateToTab = jest.fn();
  return {
    props: {
      state: { index, routes },
      descriptors: {},
      emitter: { emit },
      navigateToTab,
      insets: { top: 0, bottom: 20, left: 0, right: 0 },
    } as unknown as BottomTabBarProps,
    emit,
    navigateToTab,
  };
}

describe("TabBar", () => {
  afterEach(() => act(() => setTabBadge("home", 0)));

  it("shows the five labelled tabs in order, whatever the route names look like", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe() }));
    // Placeholder-style names ("finance/index") and real-slice names ("tickets") mixed, shuffled.
    const { props } = barProps(["me", "prayer", "tickets", "index", "finance/index"], 3);
    await render(<TabBar {...props} />, { wrapper });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(["Home", "Finance", "Prayer", "Tickets", "Me"]);
    expect(screen.getByRole("tab", { name: "Prayer" }).props.accessibilityHint).toBe("Tab 3 of 5");
    // Large Dynamic Type: the label shrinks to fit its fifth of the bar rather than truncating.
    const label = screen.getByText("Tickets");
    expect(label.props.adjustsFontSizeToFit).toBe(true);
    expect(label.props.numberOfLines).toBe(1);
    expect(screen.getByRole("tab", { name: "Home" }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole("tab", { name: "Me" }).props.accessibilityState).toMatchObject({ selected: false });
  });

  it("has 48dp+ targets", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe() }));
    const { props } = barProps(["index", "finance", "tickets", "me"]);
    await render(<TabBar {...props} />, { wrapper });
    const style = screen.getByTestId("tab-me").props.style;
    const flat = typeof style === "function" ? style({ pressed: false }) : style;
    expect(flat.minHeight).toBeGreaterThanOrEqual(48);
  });

  it("emits tabPress and navigates to an unfocused tab only", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe() }));
    const { props, emit, navigateToTab } = barProps(["index", "finance", "tickets", "me"], 0);
    await render(<TabBar {...props} />, { wrapper });
    await fireEvent.press(screen.getByRole("tab", { name: "Me" }));
    expect(emit).toHaveBeenCalledWith({ type: "tabPress", target: "me-key", canPreventDefault: true });
    expect(navigateToTab).toHaveBeenCalledWith("me-key");
    navigateToTab.mockClear();
    await fireEvent.press(screen.getByRole("tab", { name: "Home" }));
    expect(navigateToTab).not.toHaveBeenCalled();
  });

  it("shows a badge with a spoken count, not colour alone", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe() }));
    const { props } = barProps(["index", "finance", "tickets", "me"]);
    await render(<TabBar {...props} />, { wrapper });
    expect(screen.queryByTestId("tab-badge-home", { includeHiddenElements: true })).toBeNull();
    await act(async () => setTabBadge("home", 4));
    expect(screen.getByTestId("tab-badge-home", { includeHiddenElements: true })).toHaveTextContent("4");
    expect(screen.getByRole("tab", { name: "Home, 4 unread" })).toBeTruthy();
  });

  it("shows or hides a permission-gated tab from /api/me", async () => {
    const gated: TabDef[] = [
      ...TABS,
      { id: "tickets", segment: "door", label: "Door", icon: Ticket, visible: (me) => can(me, "events.manage_attendance") },
    ];
    const { props } = barProps(["index", "finance", "tickets", "me", "door"]);

    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe() }));
    const first = await render(<TabBar {...props} tabs={gated} />, { wrapper });
    expect(screen.queryByRole("tab", { name: "Door" })).toBeNull();
    await first.unmount();

    mockFetch.mockImplementation(
      apiRoutes({
        "/api/me": makeMe({
          permissions: [{ key: "events.manage_attendance", scopeType: null, scopeId: null, source: "role" }],
        }),
      }),
    );
    await render(<TabBar {...props} tabs={gated} />, { wrapper });
    expect(await screen.findByRole("tab", { name: "Door" })).toBeTruthy();
  });
});
