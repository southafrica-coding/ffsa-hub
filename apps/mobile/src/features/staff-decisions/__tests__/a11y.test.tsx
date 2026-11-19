// Accessibility and dark-mode checks for Staff decisions: every tappable has
// a role and a name, headings are headers, decisions are in words, and
// colours come from the theme (so dark mode follows the phone).

import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { auditTappables } from "@/lib/a11y/testing";
import { colors } from "@/theme/tokens";
import { themeFor } from "@/theme/use-theme";

import { LT_2026, detail, schoolList } from "../__fixtures__/fixtures";
import { getSchool, getSchools } from "../api";
import SchoolDetailScreen from "../screens/SchoolDetailScreen";
import SchoolsListScreen from "../screens/SchoolsListScreen";
import { strings } from "../strings";

const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../api", () => ({ ...jest.requireActual("../api"), getSchools: jest.fn(), getSchool: jest.fn() }));
let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => ({ ...jest.requireActual("@/theme/use-theme"), useTheme: () => jest.requireActual("@/theme/use-theme").themeFor(mockScheme) }));

const list = getSchools as jest.Mock;
const one = getSchool as jest.Mock;

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const audit = () => auditTappables(screen.container as never);

beforeEach(() => {
  [list, one].forEach((m) => m.mockReset());
  mockScheme = "light";
});

describe("Schools list", () => {
  it("success: header, each row a named button with a hint, counts in words", async () => {
    list.mockResolvedValue(schoolList());
    await show(<SchoolsListScreen />);
    expect(await screen.findByRole("header", { name: strings.list.title })).toBeTruthy();
    const row = screen.getByRole("button", { name: "Leadership Track 2026. 3 students. 1 yes, 1 no, 1 undecided" });
    expect(row.props.accessibilityHint).toBe(strings.list.rowHint);
    expect(screen.getByRole("button", { name: "Leadership Track 2025. Archived. 1 student. 0 yes, 0 no, 1 undecided" })).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("loading: labelled progress, nothing unnamed to tap", async () => {
    list.mockReturnValue(new Promise(() => undefined));
    await show(<SchoolsListScreen />);
    expect(screen.getByRole("progressbar", { name: strings.list.loading })).toBeTruthy();
    expect(audit()).toEqual([]);
  });
});

describe("School detail", () => {
  it("rows read as one sentence; buttons are named with hints; the website link is a link", async () => {
    one.mockResolvedValue(detail());
    await show(<SchoolDetailScreen programId={LT_2026} />);
    expect(await screen.findByLabelText("Ben Cole. ben@example.org. Staff. Accepted: no. Note: Not this year. Decided 2 Oct 2026 by Lee Team")).toBeTruthy();
    expect(screen.getByRole("header", { name: "Leadership Track 2026" })).toBeTruthy();
    expect(screen.getByRole("header", { name: "Students · 3" })).toBeTruthy();
    const makeStaff = screen.getByRole("button", { name: "Make Ann Bell staff" });
    expect(makeStaff.props.accessibilityHint).toBe(strings.detail.makeStaffHint);
    expect(screen.getByRole("link", { name: /^Open this school on the website\. Opens in browser/ })).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("the sheet: the question is a header, then named radios and a labelled note", async () => {
    one.mockResolvedValue(detail());
    await show(<SchoolDetailScreen programId={LT_2026} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Decide on Cara Lee" }));
    expect(screen.getByRole("header", { name: strings.sheet.acceptedLabel })).toBeTruthy();
    // Nothing is chosen until the person chooses.
    expect(screen.getByRole("radio", { name: "Yes", checked: false })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "No", checked: false })).toBeTruthy();
    await fireEvent.press(screen.getByRole("radio", { name: "Yes" }));
    expect(screen.getByRole("radio", { name: "Yes", checked: true })).toBeTruthy();
    // Chosen is the yellow underline and the bold label, not colour alone.
    const chosen = StyleSheet.flatten(screen.getByTestId("choice-yes").props.style);
    expect(chosen.borderBottomWidth).toBe(2);
    expect(chosen.borderBottomColor).toBe(colors.light.accent);
    expect(chosen.minHeight).toBeGreaterThanOrEqual(44);
    expect(screen.getByLabelText(strings.sheet.noteLabelOptional)).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("dark mode: the list uses the dark theme's colours (no hard-coded colours)", async () => {
    mockScheme = "dark";
    expect(themeFor("dark").colors.rule).toBe(colors.dark.rule);
    one.mockResolvedValue(detail());
    await show(<SchoolDetailScreen programId={LT_2026} />);
    const group = StyleSheet.flatten((await screen.findByTestId("students")).props.style);
    expect(group.borderColor).toBe(colors.dark.rule);
    expect(group.backgroundColor).toBe(colors.dark.raised);
    expect(StyleSheet.flatten(screen.getByTestId("needs-you").props.style).backgroundColor).toBe(colors.dark.accent);
    expect(audit()).toEqual([]);
  });
});
