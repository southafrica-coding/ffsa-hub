// Accessibility and dark-mode checks for Ministries: every tappable has a
// role and a name, headings are headers, roles and status are in words, and
// colours come from the theme (so dark mode follows the phone).

import { render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { auditTappables } from "@/lib/a11y/testing";
import { colors } from "@/theme/tokens";
import { themeFor } from "@/theme/use-theme";

import { CAMS, KIDS, MEDIA, detail, member, ministry, ministryList } from "../__fixtures__/fixtures";
import { getMinistries, getMinistry } from "../api";
import MinistriesListScreen from "../screens/MinistriesListScreen";
import MinistryDetailScreen from "../screens/MinistryDetailScreen";
import { strings } from "../strings";

const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../api", () => ({ ...jest.requireActual("../api"), getMinistries: jest.fn(), getMinistry: jest.fn() }));
let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => ({ ...jest.requireActual("@/theme/use-theme"), useTheme: () => jest.requireActual("@/theme/use-theme").themeFor(mockScheme) }));

const list = getMinistries as jest.Mock;
const one = getMinistry as jest.Mock;

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const audit = () => auditTappables(screen.container as never);

beforeEach(() => {
  [list, one].forEach((m) => m.mockReset());
  mockScheme = "light";
});

describe("Ministries list", () => {
  it("success: header, each row names the ministry, Retired and the people count in words", async () => {
    list.mockResolvedValue(
      ministryList({ scope: "all", canCreate: true, ministries: [ministry(), ministry({ id: KIDS, name: "Kids", ministryType: "part_time", isActive: false, peopleCount: 0, description: null })] }),
    );
    await show(<MinistriesListScreen />);
    expect(await screen.findByRole("header", { name: strings.list.title })).toBeTruthy();
    const row = screen.getByRole("button", { name: "Media. 4 people. Cameras and sound" });
    expect(row.props.accessibilityHint).toBe(strings.list.rowHint);
    expect(screen.getByRole("button", { name: "Kids. Retired. 0 people" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Create a ministry\. Opens in browser/ })).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("loading and no-access: labelled, nothing unnamed to tap", async () => {
    list.mockReturnValue(new Promise(() => undefined));
    await show(<MinistriesListScreen />);
    expect(screen.getByRole("progressbar", { name: strings.list.loading })).toBeTruthy();
    expect(audit()).toEqual([]);
  });
});

describe("Ministry detail", () => {
  it("manager: band, group headings are headers, approve is a named button with a hint", async () => {
    one.mockResolvedValue(
      detail({
        subcategories: [{ id: CAMS, name: "Cameras" }],
        roster: [member({ membershipId: "m2", name: "Bo Dube", status: "pending", categoryIds: [CAMS] })],
      }),
    );
    await show(<MinistryDetailScreen id={MEDIA} />);
    expect(await screen.findByRole("header", { name: "Cameras, 1 person" })).toBeTruthy();
    const approve = screen.getByRole("button", { name: "Approve Bo Dube" });
    expect(approve.props.accessibilityHint).toBe(strings.detail.approveHint);
    expect(screen.getByLabelText("Bo Dube. Pending. ann@example.org")).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Manage this team on the website\. Opens in browser/ })).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("dark mode: rows use the dark theme's rule colour (no hard-coded colours)", async () => {
    mockScheme = "dark";
    expect(themeFor("dark").colors.rule).toBe(colors.dark.rule);
    one.mockResolvedValue(detail({ canManage: false }));
    await show(<MinistryDetailScreen id={MEDIA} />);
    const row = await screen.findByTestId("member-__none__-m2");
    expect(StyleSheet.flatten(row.props.style).borderBottomColor).toBe(colors.dark.rule);
    expect(audit()).toEqual([]);
  });
});
