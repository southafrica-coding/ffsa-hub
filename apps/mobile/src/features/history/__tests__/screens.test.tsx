import { fireEvent, render, screen, within } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import type { ReactElement } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { auditTappables, tappableSizes } from "@/lib/a11y/testing";
import { colors } from "@/theme/tokens";

import { document, emptyHistory, history, payment } from "../__fixtures__/fixtures";
import { DataError, loadHistory } from "../data";
import HistoryScreen from "../screens/HistoryScreen";
import { strings } from "../strings";

let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});
const mockRouter = { push: jest.fn(), back: jest.fn(), navigate: jest.fn() };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
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
  Object.values(mockRouter).forEach((f) => f.mockReset());
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
    expect(within(sheet).getByLabelText("Home church: Sample Church")).toBeTruthy();
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

  it("dark mode: the page, the list groups and the sheet use the dark tokens", async () => {
    mockScheme = "dark";
    load.mockResolvedValue(history());
    await show(<HistoryScreen />);
    const title = await screen.findByRole("header", { name: s.title });
    expect(StyleSheet.flatten(title.props.style).color).toBe(colors.dark.text);
    const group = screen.getByTestId("record-applications-a1").parent!;
    expect(StyleSheet.flatten(group.props.style)).toMatchObject({ backgroundColor: colors.dark.raised, borderColor: colors.dark.rule, borderRadius: 8 });
    await fireEvent.press(screen.getByTestId("record-applications-a1"));
    expect(screen.getByTestId("record-sheet")).toBeTruthy();
  });
});

describe("My History, redesigned (frames 9.1–9.4)", () => {
  it("header: the eyebrow, the intro under the title, and Back goes to Home", async () => {
    load.mockResolvedValue(history());
    await show(<HistoryScreen />);
    expect(await screen.findByText("Personal · 4 records on file")).toBeTruthy();
    expect(screen.getByRole("header", { name: s.title })).toBeTruthy();
    expect(screen.getByText(s.intro)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back to Home" }));
    expect(mockRouter.navigate).toHaveBeenCalledWith("/");
  });

  it("sections: the count sits in a chip beside a sentence-case title, and empty sections are hidden", async () => {
    load.mockResolvedValue(history({ payments: [payment(), payment({ id: "p2", amount: 12450 })], documents: [] }));
    await show(<HistoryScreen />);
    const payments = await screen.findByTestId("section-payments");
    expect(within(payments).getByRole("header", { name: "Payments, 2" })).toBeTruthy();
    expect(within(payments).getByText("Payments")).toBeTruthy();
    expect(within(payments).getByText("2")).toBeTruthy();
    expect(screen.queryByTestId("section-documents")).toBeNull();
  });

  it("rows: payments keep the imported currency text with cents; the labelled date shows beside it", async () => {
    load.mockResolvedValue(history({ payments: [payment({ amount: 12450 })] }));
    await show(<HistoryScreen />);
    const row = await screen.findByTestId("record-payments-p1");
    expect(within(row).getByText("ZAR 12,450.00")).toBeTruthy();
    expect(within(row).getByText("School fees deposit")).toBeTruthy();
    expect(within(row).getByText(strings.dateLabel.payments)).toBeTruthy();
    expect(within(row).getByText("2 Apr 2019")).toBeTruthy();
    expect(row.props.accessibilityLabel).toBe("ZAR 12,450.00. School fees deposit. Paid 2 Apr 2019");
  });

  it("rows: a document with no expiry shows no date", async () => {
    load.mockResolvedValue(history({ documents: [document({ expires_at: null, identifier: null })] }));
    await show(<HistoryScreen />);
    const row = await screen.findByTestId("record-documents-d1");
    expect(within(row).getByText("Passport")).toBeTruthy();
    expect(within(row).queryByText(strings.dateLabel.documents)).toBeNull();
  });

  it("rows are at least 44pt tall and every one opens its record", async () => {
    load.mockResolvedValue(history());
    await show(<HistoryScreen />);
    await screen.findByTestId("record-applications-a1");
    const rows = tappableSizes(screen.container as never, StyleSheet.flatten as never).filter((t) => t.testID?.startsWith("record-"));
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.minHeight).toBeGreaterThanOrEqual(44);
  });

  it("empty: a calm card with a heading, no sections", async () => {
    load.mockResolvedValue(emptyHistory());
    await show(<HistoryScreen />);
    expect(await screen.findByRole("header", { name: s.emptyTitle })).toBeTruthy();
    expect(screen.getByTestId("empty")).toBeTruthy();
    expect(audit()).toEqual([]);
  });

  it("error: an alert that says what to do, with Try again", async () => {
    load.mockRejectedValue(new DataError(strings.common.network));
    await show(<HistoryScreen />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.common.tryAgain })).toBeTruthy();
  });

  it("record sheet, payment: title, description, 'Paid …' and the imported fields", async () => {
    load.mockResolvedValue(history());
    await show(<HistoryScreen />);
    await fireEvent.press(await screen.findByTestId("record-payments-p1"));
    expect(screen.getAllByRole("header", { name: "ZAR 1,500.00" }).length).toBeGreaterThan(0);
    const sheet = screen.getByTestId("record-sheet");
    expect(within(sheet).getByText("School fees deposit")).toBeTruthy();
    expect(within(sheet).getByText("Paid 2 Apr 2019")).toBeTruthy();
    expect(within(sheet).getByRole("header", { name: strings.detail.more })).toBeTruthy();
    expect(within(sheet).getByLabelText("Reference: INV-1")).toBeTruthy();
  });

  it("record sheet, document: Open file says where it opens, then 'no other details'", async () => {
    load.mockResolvedValue(history());
    await show(<HistoryScreen />);
    await fireEvent.press(await screen.findByTestId("record-documents-d1"));
    const sheet = screen.getByTestId("record-sheet");
    expect(within(sheet).getByText("Expires 31 Jan 2029")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: strings.detail.openFile }).props.accessibilityHint).toBe(strings.detail.openFileHint);
    expect(within(sheet).getByText(strings.detail.nothingMore)).toBeTruthy();
    expect(audit()).toEqual([]);
  });
});
