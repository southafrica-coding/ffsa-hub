import { fireEvent, render, screen, within } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { auditTappables } from "@/lib/a11y/testing";
import { colors } from "@/theme/tokens";

import { document, emptyHistory, history } from "../__fixtures__/fixtures";
import { DataError, loadHistory } from "../data";
import HistoryScreen from "../screens/HistoryScreen";
import { strings } from "../strings";

let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@/features/finance/cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../data", () => ({ ...jest.requireActual("../data"), loadHistory: jest.fn() }));

const load = loadHistory as jest.Mock;
const cache = jest.requireMock("@/features/finance/cache") as { readCache: jest.Mock; writeCache: jest.Mock };
const openBrowser = WebBrowser.openBrowserAsync as jest.Mock;

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = (ui: ReactElement) => render(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
const audit = () => auditTappables(screen.container as never);
const s = strings.list;

beforeEach(() => {
  mockScheme = "light";
  [load, openBrowser].forEach((m) => m.mockReset());
  cache.readCache.mockReset().mockResolvedValue(null);
  cache.writeCache.mockClear();
});

describe("My History", () => {
  it("loading: a skeleton with a spoken label", async () => {
    load.mockReturnValue(new Promise(() => undefined));
    await show(<HistoryScreen />);
    expect(screen.getByRole("progressbar", { name: s.loading })).toBeTruthy();
    expect(screen.getByText(s.title)).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("empty: explains that staff link past records here; no sections", async () => {
    load.mockResolvedValue(emptyHistory());
    await show(<HistoryScreen />);
    expect(await screen.findByText(s.emptyTitle)).toBeTruthy();
    expect(screen.getByText(s.emptyBody)).toBeTruthy();
    expect(screen.getByText("Personal · 0 records on file")).toBeTruthy();
    expect(screen.queryByTestId("section-applications")).toBeNull();
  });

  it("error: the message and a retry that loads again", async () => {
    load.mockRejectedValueOnce(new DataError(strings.common.network)).mockResolvedValue(history());
    await show(<HistoryScreen />);
    expect(await screen.findByText(s.errorTitle)).toBeTruthy();
    expect(screen.getByText(strings.common.network)).toBeTruthy();
    expect(audit()).toEqual([]);
    await fireEvent.press(screen.getByRole("button", { name: strings.common.tryAgain }));
    expect(await screen.findByText("DTS Cape Town")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("permission denied: says it isn't available on this account", async () => {
    load.mockRejectedValue(new DataError(strings.common.forbidden));
    await show(<HistoryScreen />);
    expect(await screen.findByText(strings.common.forbidden)).toBeTruthy();
  });

  it("success: four sections with counts, in the web's order; total in the masthead; saved for offline", async () => {
    load.mockResolvedValue(history());
    await show(<HistoryScreen />);
    expect(await screen.findByText("Personal · 4 records on file")).toBeTruthy();
    expect(load).toHaveBeenCalledWith("user-1");
    for (const [kind, title] of [
      ["applications", "Applications, 1"],
      ["enrollments", "Training attended, 1"],
      ["payments", "Payments, 1"],
      ["documents", "Documents, 1"],
    ]) {
      expect(within(screen.getByTestId(`section-${kind}`)).getByRole("header", { name: title })).toBeTruthy();
    }
    expect(screen.getByText("ZAR 1,500.00")).toBeTruthy();
    expect(screen.getByText("1 Jul 2019 – 13 Dec 2019")).toBeTruthy();
    expect(screen.queryByText(s.emptyTitle)).toBeNull();
    expect(cache.writeCache).toHaveBeenCalledWith("user-1", "history.list", history());
    // Nothing here asks anything of the person, so there's no yellow band.
    expect(screen.queryByTestId("needs-you")).toBeNull();
    expect(audit()).toEqual([]);
  });

  it("rows: one spoken label with the date and a hint", async () => {
    load.mockResolvedValue(history());
    await show(<HistoryScreen />);
    const row = await screen.findByRole("button", { name: "DTS. 2019 Winter · accepted. Submitted 12 Mar 2019" });
    expect(row.props.accessibilityHint).toBe(s.rowHint);
  });

  it("detail: tapping a row shows the raw fields in a sheet, and Close hides it", async () => {
    load.mockResolvedValue(history());
    await show(<HistoryScreen />);
    await fireEvent.press(await screen.findByTestId("record-applications-a1"));
    const sheet = screen.getByTestId("record-sheet");
    expect(within(sheet).getByText(strings.detail.more)).toBeTruthy();
    expect(within(sheet).getByLabelText("Home church: Grace")).toBeTruthy();
    expect(within(sheet).getByLabelText("Phone: blank")).toBeTruthy();
    expect(within(sheet).getByText("Submitted 12 Mar 2019")).toBeTruthy();
    expect(within(sheet).queryByTestId("open-file")).toBeNull();
    await fireEvent.press(screen.getAllByRole("button", { name: strings.detail.close })[0]);
    expect(screen.queryByTestId("record-sheet")).toBeNull();
  });

  it("detail: a record with no extra fields says so", async () => {
    load.mockResolvedValue(history());
    await show(<HistoryScreen />);
    await fireEvent.press(await screen.findByTestId("record-enrollments-e1"));
    expect(screen.getByText(strings.detail.nothingMore)).toBeTruthy();
  });

  it("document: Open file opens it in the in-app browser", async () => {
    load.mockResolvedValue(history());
    await show(<HistoryScreen />);
    await fireEvent.press(await screen.findByTestId("record-documents-d1"));
    await fireEvent.press(screen.getByRole("button", { name: strings.detail.openFile }));
    expect(openBrowser).toHaveBeenCalledWith("https://files.example.test/passport.pdf", expect.anything());
  });

  it("document: an unsafe link is not offered", async () => {
    load.mockResolvedValue(history({ documents: [document({ file_url: "javascript:alert(1)" })] }));
    await show(<HistoryScreen />);
    await fireEvent.press(await screen.findByTestId("record-documents-d1"));
    expect(screen.queryByTestId("open-file")).toBeNull();
  });

  it("offline: the saved copy shows at once with when it was saved", async () => {
    cache.readCache.mockResolvedValue({ savedAt: 1, data: history() });
    load.mockRejectedValue(new DataError(strings.common.network));
    await show(<HistoryScreen />);
    expect(await screen.findByText(strings.common.refreshFailed("09:05"))).toBeTruthy();
    expect(screen.getByText("DTS Cape Town")).toBeTruthy();
    expect(cache.readCache).toHaveBeenCalledWith("user-1", "history.list");
  });

  it("dark mode: section bars and the sheet use the dark tokens", async () => {
    mockScheme = "dark";
    load.mockResolvedValue(history());
    await show(<HistoryScreen />);
    const bar = within(await screen.findByTestId("section-applications")).getByRole("header", { name: "Applications, 1" });
    expect(StyleSheet.flatten(bar.props.style).backgroundColor).toBe(colors.dark.inverse);
    await fireEvent.press(screen.getByTestId("record-applications-a1"));
    expect(screen.getByTestId("record-sheet")).toBeTruthy();
  });
});
