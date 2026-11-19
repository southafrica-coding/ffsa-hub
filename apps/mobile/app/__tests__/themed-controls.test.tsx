import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { homeStrings } from "@/features/home/strings";
import { MeProvider } from "@/features/shell";
import { ENROLMENT_ID, enrolmentData, record, schoolsList } from "@/features/schools/__fixtures__/fixtures";
import { loadAttendance, loadEnrolment, loadSchools } from "@/features/schools/data";
import AttendanceScreen from "@/features/schools/screens/AttendanceScreen";
import EnrolmentScreen from "@/features/schools/screens/EnrolmentScreen";
import SchoolsListScreen from "@/features/schools/screens/SchoolsListScreen";
import { apiFetch } from "@/lib/api-client";
import { colors } from "@/theme/tokens";

import { apiRoutes, makeMe } from "../../test/fixtures";
import HomeScreen from "../(app)/index";
import NotificationPrefsScreen from "../(app)/me/notifications";

// Native controls take colours as props, so they don't follow the theme by
// themselves. These screens must hand them the themed set from
// @/theme/styles (dark: the Android refresh disc and the Switch thumb would
// otherwise vanish). Rendered in dark, where the difference shows.

let mockScheme: "light" | "dark" = "dark";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/auth/session-provider", () => ({
  useSession: () => ({ status: "signedIn", session: { user: { id: "u1" } } }),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ navigate: jest.fn(), push: jest.fn(), back: jest.fn() }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@/features/schools/shortcut", () => ({ useSchoolsShortcut: () => false }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("@/lib/saved-at", () => ({ formatSavedAt: () => "09:05" }));
jest.mock("@/features/schools/data", () => ({
  ...jest.requireActual("@/features/schools/data"),
  loadSchools: jest.fn(),
  loadEnrolment: jest.fn(),
  loadAttendance: jest.fn(),
}));

const mockFetch = apiFetch as unknown as jest.Mock;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

type Host = { props: Record<string, unknown>; parent: Host | null };

/** The RefreshControl element handed to the scroll view that holds `el`. */
function refreshControlAround(el: Host) {
  for (let n: Host | null = el; n; n = n.parent) {
    const rc = n.props.refreshControl as ReactElement<Record<string, unknown>> | undefined;
    if (rc) return rc.props;
  }
  throw new Error("no RefreshControl above this element");
}

const dark = colors.dark;
const themedRefresh = { tintColor: dark.text, colors: [dark.text], progressBackgroundColor: dark.surface };

beforeEach(async () => {
  mockScheme = "dark";
  mockFetch.mockReset();
  [loadSchools, loadEnrolment, loadAttendance].forEach((m) => (m as jest.Mock).mockReset());
  await AsyncStorage.clear();
});

describe("pull-to-refresh uses the themed colours", () => {
  it("Home", async () => {
    mockFetch.mockImplementation(apiRoutes({ "/api/me": makeMe(), "/api/notifications": { items: [], unreadCount: 0 } }));
    await render(
      <MeProvider>
        <HomeScreen />
      </MeProvider>,
    );
    const el = await screen.findByText(homeStrings.empty.title);
    expect(refreshControlAround(el as unknown as Host)).toMatchObject(themedRefresh);
  });

  it("My Schools list", async () => {
    (loadSchools as jest.Mock).mockResolvedValue(schoolsList());
    await show(<SchoolsListScreen />);
    const el = await screen.findByText("DTS Winter");
    expect(refreshControlAround(el as unknown as Host)).toMatchObject(themedRefresh);
  });

  it("Enrolment detail", async () => {
    (loadEnrolment as jest.Mock).mockResolvedValue(enrolmentData());
    await show(<EnrolmentScreen id={ENROLMENT_ID} />);
    const el = (await screen.findAllByText("DTS Winter"))[0];
    expect(refreshControlAround(el as unknown as Host)).toMatchObject(themedRefresh);
  });

  it("Attendance", async () => {
    (loadAttendance as jest.Mock).mockResolvedValue([record()]);
    await show(<AttendanceScreen />);
    const el = await screen.findByText("Morning lecture");
    expect(refreshControlAround(el as unknown as Host)).toMatchObject(themedRefresh);
  });
});

describe("notification switches use the themed colours", () => {
  const PREFS = {
    modules: [
      { key: "prayer_room", label: "Prayer Room", description: "" },
      { key: "finance", label: "Finance", description: "" },
    ],
    mutedModules: ["finance"],
  };

  it.each(["light", "dark"] as const)("%s: on and off thumbs stand out from the screen", async (scheme) => {
    mockScheme = scheme;
    const c = colors[scheme];
    mockFetch.mockImplementation(apiRoutes({ "/api/profile/notification-preferences": PREFS }));
    await render(<NotificationPrefsScreen />);
    const on = await screen.findByRole("switch", { name: "Prayer Room" });
    const off = screen.getByRole("switch", { name: "Finance" });
    // Host props: trackColor.true → onTintColor, trackColor.false → tintColor, thumbColor → thumbTintColor.
    expect(on.props).toMatchObject({ onTintColor: c.primary, tintColor: c.ruleStrong });
    expect(on.props.thumbTintColor).toBe(scheme === "dark" ? c.onPrimary : c.bg);
    expect(off.props.thumbTintColor).toBe(scheme === "dark" ? c.textSecondary : c.bg);
  });
});
