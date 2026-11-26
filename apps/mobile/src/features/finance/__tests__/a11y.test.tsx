// Accessibility checks for the finance screens (docs/accessibility.md):
// every tappable has a role and a name, headings are headings, the main
// controls are reachable by role/label, and async results are announced.

import { fireEvent, render, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Platform, StyleSheet } from "react-native";

import type { Me } from "@/lib/api";
import { auditTappables, largeTextProblems, wordBreakRisks } from "@/lib/a11y/testing";

import { makeMe } from "../../../../test/fixtures";
import { DataError, loadHome, loadTeam, type HomeData, type TeamMoneyView } from "../data";
import { setFlash, takeFlash } from "../flash";
import ExpenseScreen from "../screens/ExpenseScreen";
import FinanceHomeScreen from "../screens/HomeScreen";
import ReceiptViewerScreen from "../screens/ReceiptViewerScreen";
import TeamScreen from "../screens/TeamScreen";
import { strings } from "../strings";
import { expenseSchema } from "../types";
import { TEAM, expenseItem } from "../__fixtures__/fixtures";
import { makeOutbox } from "../__fixtures__/outbox-harness";

jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
  };
});
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("@react-native-community/netinfo", () => ({ __esModule: true, default: { fetch: async () => ({ isConnected: true }), addEventListener: () => () => {} } }));
jest.mock("react-native-safe-area-context", () => {
  const actual = jest.requireActual("react-native-safe-area-context");
  return { ...actual, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));
jest.mock("expo-file-system", () => ({ Paths: { document: { uri: "file:///docs/" } } }));
jest.mock("../outbox/store", () => ({ fileOutboxStorage: { deleteFile: jest.fn() } }));
jest.mock("../capture", () => ({ takeReceiptPhoto: jest.fn(), chooseReceiptPhotos: jest.fn() }));
jest.mock("../cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../data", () => ({ ...jest.requireActual("../data"), loadTeam: jest.fn(), loadHome: jest.fn() }));
jest.mock("../components/ZoomableImage", () => {
  const { Image } = jest.requireActual("react-native");
  return { ZoomableImage: ({ uri, label }: { uri: string; label: string }) => <Image source={{ uri }} accessible accessibilityRole="image" accessibilityLabel={label} /> };
});
let mockMe: Me | null = null;
jest.mock("@/features/shell", () => ({ useMe: () => ({ status: mockMe ? "ready" : "loading", me: mockMe, error: null, refresh: () => {} }) }));

const mockTeam = loadTeam as jest.Mock;
const mockHome = loadHome as jest.Mock;

const exp = (over: Record<string, unknown>) =>
  expenseSchema.parse({ team_id: TEAM, expense_date: "2026-11-02", payment_method: "cash", zar_amount: 100, ...over });

function money(over: Partial<TeamMoneyView> = {}): TeamMoneyView {
  return {
    kind: "money",
    team: { id: TEAM, team_name: "Burundi", location: "Bujumbura", country: "Burundi", status: "active", currency: "ZAR", start_date: null, end_date: null },
    canEdit: true,
    categories: [
      { id: "food", name: "Food", sort_order: 1 },
      { id: "travel", name: "Travel", sort_order: 2 },
    ],
    budgets: [
      { team_id: TEAM, category_id: "food", budget_amount_zar: 100 },
      { team_id: TEAM, category_id: "travel", budget_amount_zar: 400 },
    ],
    expenses: [
      exp({ id: "e1", category_id: "food", description: "Bread", zar_amount: 250 }),
      exp({ id: "e2", category_id: "travel", description: "Taxi", zar_amount: 600 }),
    ],
    pulls: [],
    receiptCounts: { e1: 2 },
    ...over,
  };
}

const HOME: HomeData = {
  teams: [
    {
      membership_id: "m1",
      role: "owner",
      team_id: TEAM,
      team_name: "Burundi",
      location: "Bujumbura",
      country: "Burundi",
      status: "active",
      start_date: null,
      end_date: null,
      program_name: "DTS",
      money: { currency: "ZAR", budget: 10000, spent: 2500 },
    },
  ],
};

const noProblems = () => expect(auditTappables(screen.container as never)).toEqual([]);

beforeEach(() => {
  mockTeam.mockReset();
  mockHome.mockReset();
  mockMe = makeMe();
  takeFlash(TEAM);
});

describe("My Finance home", () => {
  it("loading: one labelled progress element", async () => {
    mockHome.mockReturnValue(new Promise(() => {}));
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    expect(screen.getByRole("progressbar", { name: strings.home.loading })).toBeTruthy();
    noProblems();
  });

  it("error: the message in words with a reachable retry", async () => {
    mockHome.mockRejectedValue(new DataError("FFSA Hub couldn't load this right now.", false));
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    expect(await screen.findByText(/couldn't load this right now/)).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.common.tryAgain })).toBeTruthy();
    noProblems();
  });

  it("empty: the title is a heading", async () => {
    mockHome.mockResolvedValue({ teams: [] });
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    expect(await screen.findByRole("header", { name: strings.home.emptyTitle })).toBeTruthy();
    noProblems();
  });

  it("success: masthead heading, team section header, team rows are named buttons with a hint", async () => {
    mockHome.mockResolvedValue(HOME);
    const { wrap } = makeOutbox([{ ...expenseItem(), status: "failed" }]);
    await render(wrap(<FinanceHomeScreen />));
    expect(await screen.findByRole("header", { name: strings.home.title })).toBeTruthy();
    expect(screen.getByRole("header", { name: `${strings.home.teamsSection}, 1 team` })).toBeTruthy();
    const row = screen.getByRole("button", { name: /^Burundi\. Active/ });
    expect(row.props.accessibilityHint).toBeTruthy();
    // The band is a summary read as one unit, in words.
    expect(screen.getByRole("summary")).toBeTruthy();
    noProblems();
  });
});

describe("Team", () => {
  it("permission denied: an alert in words", async () => {
    mockTeam.mockResolvedValue({ kind: "none" });
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByRole("alert")).toBeTruthy();
    noProblems();
  });

  it("success: the big number says 'over budget' in words when over", async () => {
    mockTeam.mockResolvedValue(money());
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByLabelText(/^Over budget: /)).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.team.addExpense }).props.accessibilityHint).toBe(strings.team.addExpenseHint);
    expect(screen.getByRole("progressbar")).toBeTruthy();
    // Filter chips are radios with checked state; the group label is read.
    expect(screen.getByRole("radio", { name: strings.team.allLines }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByRole("header", { name: strings.a11y.expensesFilter })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bread/ }).props.accessibilityLabel).toMatch(/2 receipts/);
    noProblems();
  });

  it("announces the result of the form when coming back", async () => {
    Platform.OS = "ios";
    const spy = jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});
    setFlash(TEAM, { tone: "positive", message: strings.expense.savedOnline });
    mockTeam.mockResolvedValue(money());
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    await screen.findByText(strings.expense.savedOnline);
    expect(spy).toHaveBeenCalledWith(strings.expense.savedOnline, { queue: true });
    spy.mockRestore();
  });
});

describe("Expense form", () => {
  it("every control is named, and validation errors are announced", async () => {
    Platform.OS = "ios";
    const spy = jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});
    mockTeam.mockResolvedValue(money({ expenses: [] }));
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    const category = await screen.findByRole("button", { name: `${strings.expense.category}: ${strings.expense.categoryPlaceholder}` });
    expect(screen.getByRole("button", { name: strings.expense.today }).props.accessibilityHint).toBe(strings.a11y.todayHint);
    expect(screen.getByRole("button", { name: strings.expense.moreDetails }).props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.getByRole("radio", { name: strings.paymentMethods.cash })).toBeTruthy();
    expect(screen.getByLabelText(strings.expense.description)).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.expense.takePhoto }).props.accessibilityHint).toBe(strings.expense.takePhotoHint);
    noProblems();

    await fireEvent.press(screen.getByRole("button", { name: strings.expense.save }));
    expect(spy).toHaveBeenCalledWith(strings.validation.category, { queue: true });
    expect(category.props.accessibilityHint).toBeDefined();
    expect(
      screen.getByRole("button", { name: `${strings.expense.category}: ${strings.expense.categoryPlaceholder}` }).props.accessibilityHint,
    ).toMatch(strings.validation.category);
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it("the budget line sheet is a radio group with a close button", async () => {
    mockTeam.mockResolvedValue(money({ expenses: [] }));
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    await fireEvent.press(await screen.findByRole("button", { name: `${strings.expense.category}: ${strings.expense.categoryPlaceholder}` }));
    expect(screen.getByRole("header", { name: strings.expense.categorySheetTitle })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Food" }).props.accessibilityState).toMatchObject({ checked: false });
    expect(screen.getAllByRole("button", { name: strings.common.close }).length).toBeGreaterThan(0);
    noProblems();
  });

  it("permission denied (plain member): no unlabelled controls", async () => {
    mockTeam.mockResolvedValue({ kind: "member", overview: {} });
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    expect(await screen.findByText(strings.common.forbidden)).toBeTruthy();
    noProblems();
  });
});

describe("Receipt viewer", () => {
  it("has a heading, a labelled image and a close button", async () => {
    const uri = "https://test-project.supabase.co/storage/v1/object/sign/outreach-receipts/t/e/1_a.jpg?token=abc";
    await render(<ReceiptViewerScreen uri={uri} title="a.jpg" />);
    expect(screen.getByRole("header", { name: "a.jpg" })).toBeTruthy();
    expect(screen.getByRole("image", { name: `${strings.viewer.title}: a.jpg` })).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.common.close })).toBeTruthy();
    noProblems();
  });

  it("a refused link is an alert", async () => {
    await render(<ReceiptViewerScreen uri="https://evil.example/x.jpg" />);
    expect(screen.getByRole("alert")).toHaveTextContent(strings.viewer.loadFailed);
  });
});

// The largest accessibility text size on a 360pt-wide phone (design-spec §6).
function atLargestText() {
  return jest.spyOn(jest.requireActual<typeof import("react-native")>("react-native"), "useWindowDimensions").mockReturnValue({ width: 360, height: 780, scale: 3, fontScale: 3.1 });
}

describe("largest text: nothing is capped or clipped", () => {
  it("My finance", async () => {
    const dims = atLargestText();
    mockHome.mockResolvedValue(HOME);
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    expect(await screen.findByRole("header", { name: strings.home.title })).toBeTruthy();
    expect(largeTextProblems(screen.container as never)).toEqual([]);
    // The team name keeps its words whole: the Active chip goes under it (QA: "Leadershi/p").
    expect(wordBreakRisks(screen.container as never, (st) => StyleSheet.flatten(st as never) ?? {})).toEqual([]);
    noProblems();
    dims.mockRestore();
  });

  it("Team", async () => {
    const dims = atLargestText();
    mockTeam.mockResolvedValue(money());
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByLabelText(/^Over budget: /)).toBeTruthy();
    expect(largeTextProblems(screen.container as never)).toEqual([]);
    noProblems();
    dims.mockRestore();
  });

  it("Add expense", async () => {
    const dims = atLargestText();
    mockTeam.mockResolvedValue(money({ expenses: [] }));
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    await screen.findByRole("button", { name: `${strings.expense.category}: ${strings.expense.categoryPlaceholder}` });
    expect(largeTextProblems(screen.container as never)).toEqual([]);
    noProblems();
    dims.mockRestore();
  });
});
