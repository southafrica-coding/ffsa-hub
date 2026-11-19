// The redesigned finance screens (mockup frames 3.1–3.10): the states the
// restyle added or moved, in light and dark. Behaviour tests stay in
// home-screen / team-screen / expense-screen.

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Alert, StyleSheet } from "react-native";

import type { Me } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";
import { auditTappables } from "@/lib/a11y/testing";
import { outboxStrings } from "@/lib/outbox/strings";
import { colors } from "@/theme/tokens";

import { makeMe } from "../../../../test/fixtures";
import { DataError, loadHome, loadTeam, type HomeData, type TeamMoneyView } from "../data";
import { setFlash, takeFlash } from "../flash";
import { formatMoney } from "../money";
import ExpenseScreen from "../screens/ExpenseScreen";
import FinanceHomeScreen from "../screens/HomeScreen";
import TeamScreen from "../screens/TeamScreen";
import { strings } from "../strings";
import { expenseSchema } from "../types";
import { TEAM, expenseItem, receiptItem } from "../__fixtures__/fixtures";
import { makeOutbox } from "../__fixtures__/outbox-harness";

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual("react");
  return { useRouter: () => ({ push: mockPush, back: mockBack }), useFocusEffect: (cb: () => void) => useEffect(cb, [cb]) };
});
let mockScheme: "light" | "dark" = "light";
jest.mock("@/theme/use-theme", () => {
  const actual = jest.requireActual("@/theme/use-theme");
  return { ...actual, useTheme: () => actual.themeFor(mockScheme) };
});
let mockNetListener: ((s: { isConnected: boolean; isInternetReachable: boolean | null }) => void) | null = null;
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    fetch: async () => ({ isConnected: true }),
    addEventListener: (cb: (s: { isConnected: boolean; isInternetReachable: boolean | null }) => void) => {
      mockNetListener = cb;
      return () => {};
    },
  },
}));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
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
let mockMe: Me | null = null;
jest.mock("@/features/shell", () => ({ useMe: () => ({ status: mockMe ? "ready" : "loading", me: mockMe, error: null, refresh: () => {} }) }));

const mockTeam = loadTeam as jest.Mock;
const mockHome = loadHome as jest.Mock;
const mockApi = apiFetch as unknown as jest.Mock;

const flat = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;
const noProblems = () => expect(auditTappables(screen.container as never)).toEqual([]);
/** Where a piece of text sits in the rendered page (for "A comes before B"). */
type Node = { children: (Node | string)[] };
const pageText = (n: Node | string): string => (typeof n === "string" ? n : n.children.map(pageText).join("\n"));
const position = (text: string) => pageText(screen.container as never).indexOf(text);
const goOffline = () => act(async () => mockNetListener?.({ isConnected: false, isInternetReachable: false }));

const HOME: HomeData = {
  teams: [
    {
      membership_id: "m1",
      role: "owner",
      team_id: TEAM,
      team_name: "Mozambique Outreach",
      location: "Maputo",
      country: "Mozambique",
      status: "active",
      start_date: "2026-12-01",
      end_date: "2026-12-21",
      program_name: "School of Missions",
      money: { currency: "MZN", budget: 186400, spent: 92310 },
    },
    {
      membership_id: "m2",
      role: "team_member",
      team_id: "t-2",
      team_name: "Nepal Outreach",
      location: "Kathmandu",
      country: "Nepal",
      status: "closed",
      start_date: null,
      end_date: null,
      program_name: "School of Missions",
      money: null,
    },
  ],
};

const exp = (over: Record<string, unknown>) =>
  expenseSchema.parse({ team_id: TEAM, expense_date: "2026-12-02", payment_method: "cash", zar_amount: 100, ...over });

function money(over: Partial<TeamMoneyView> = {}): TeamMoneyView {
  return {
    kind: "money",
    team: { id: TEAM, team_name: "Mozambique Outreach", location: "Maputo", country: "Mozambique", status: "active", currency: "MZN", start_date: "2026-12-01", end_date: "2026-12-21" },
    canEdit: true,
    categories: [
      { id: "food", name: "Food", sort_order: 1 },
      { id: "travel", name: "Local transport", sort_order: 2 },
    ],
    budgets: [
      { team_id: TEAM, category_id: "food", budget_amount_zar: 1000 },
      { team_id: TEAM, category_id: "travel", budget_amount_zar: 4000 },
    ],
    expenses: [
      exp({ id: "e1", category_id: "food", description: "Groceries", zar_amount: 250.5 }),
      exp({ id: "e2", category_id: "travel", description: "Taxi from airport", zar_amount: 980.4, payment_method: "card", local_currency: "MZN", local_amount: 3420, zar_confirmed: false }),
      exp({ id: "e3", category_id: "travel", description: "Church hall rental", zar_amount: 4500, payment_method: "bank_transfer", source: "slack" }),
    ],
    pulls: [],
    receiptCounts: { e1: 1 },
    ...over,
  };
}

beforeEach(() => {
  mockScheme = "light";
  mockNetListener = null;
  mockTeam.mockReset();
  mockHome.mockReset();
  mockApi.mockReset();
  mockBack.mockReset();
  mockPush.mockReset();
  mockMe = makeMe();
  takeFlash(TEAM);
});

// ── 3.1, 3.5, 3.10 ──────────────────────────────────────────────────────────

describe("My finance (3.1)", () => {
  it("team rows: status in a word, programme · place · role, currency line, unsent count", async () => {
    mockHome.mockResolvedValue(HOME);
    // Not sent yet (the outbox sees no signal), so it stays waiting.
    const { wrap } = makeOutbox([expenseItem()], { isOnline: async () => false });
    await render(wrap(<FinanceHomeScreen />));
    expect(await screen.findByText("Mozambique Outreach")).toBeTruthy();
    expect(screen.getByRole("header", { name: "Outreach teams, 2 teams" })).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getByText("School of Missions · Maputo · Owner")).toBeTruthy();
    expect(screen.getByText(strings.home.spendsIn("MZN"))).toBeTruthy();
    expect(screen.getByText(strings.home.pendingOnPhone(1))).toBeTruthy();
    expect(screen.getByText(strings.home.noMoney)).toBeTruthy();
    // A waiting item is calm: no band.
    expect(screen.queryByTestId("needs-you")).toBeNull();
    noProblems();
  });

  it("the finance-office placeholder: one labelled row, not a link, under the teams", async () => {
    mockHome.mockResolvedValue(HOME);
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    expect(await screen.findByRole("header", { name: strings.home.officeSection })).toBeTruthy();
    expect(screen.getByLabelText("Approvals. For Coreen Steyn and the finance office. Not built yet")).toBeTruthy();
    expect(screen.getByText(strings.home.officeNotBuilt)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approvals/ })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(position(strings.home.officeSection)).toBeGreaterThan(position("Nepal Outreach"));
    noProblems();
  });

  it("finance staff on no team still see the finance-office placeholder", async () => {
    mockMe = makeMe({ roles: [{ name: "finance_admin", scopeType: null, scopeId: null }], permissions: [] });
    mockHome.mockResolvedValue({ teams: [] });
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    expect(await screen.findByTestId("empty-state")).toBeTruthy();
    expect(screen.getByRole("header", { name: strings.home.officeSection })).toBeTruthy();
    expect(screen.getByTestId("finance-office")).toBeTruthy();
    expect(screen.getByText(strings.home.officeNotBuilt)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    noProblems();
  });

  it("finance staff by permission (finance.view) on no team see it too", async () => {
    mockMe = makeMe({ roles: [], permissions: [{ key: "finance.view", scopeType: null, scopeId: null, source: "role" }] });
    mockHome.mockResolvedValue({ teams: [] });
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    expect(await screen.findByTestId("finance-office")).toBeTruthy();
  });

  it("not on a team (3.5): the calm empty card, and no placeholder", async () => {
    mockHome.mockResolvedValue({ teams: [] });
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    expect(await screen.findByTestId("empty-state")).toBeTruthy();
    expect(screen.getByText(strings.home.emptyBody)).toBeTruthy();
    expect(screen.queryByText(strings.home.officeSection)).toBeNull();
  });

  it.each(["light", "dark"] as const)("offline and something couldn't be sent (3.10): the offline note and ONE band (%s)", async (scheme) => {
    mockScheme = scheme;
    mockHome.mockResolvedValue(HOME);
    const { wrap } = makeOutbox([expenseItem({ status: "failed", lastError: "no" })]);
    await render(wrap(<FinanceHomeScreen />));
    await screen.findByText("Mozambique Outreach");
    await goOffline();
    expect(screen.getByText(strings.outbox.offline)).toBeTruthy();
    const bands = screen.getAllByTestId("needs-you");
    expect(bands).toHaveLength(1);
    expect(flat(bands[0].props.style).backgroundColor).toBe(colors[scheme].accent);
    // Yellow is a fill with black text in both schemes.
    expect(flat(screen.getByText(strings.home.couldntSend(1)).props.style).color).toBe(colors[scheme].onAccent);
    // No button in the band: Retry / Remove live on the team screen.
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(position(strings.outbox.offline)).toBeLessThan(position(strings.home.couldntSend(1)));
  });

  it("error: says what happened and offers Try again", async () => {
    mockHome.mockRejectedValue(new DataError("Couldn't reach FFSA Hub. Check your connection and try again.", true));
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(strings.home.errorTitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.common.tryAgain })).toBeTruthy();
  });
});

// ── 3.2, 3.3, 3.6, 3.7 ──────────────────────────────────────────────────────

describe("Team (3.2 / 3.6)", () => {
  it("has a way back to My finance in every state", async () => {
    mockTeam.mockReturnValue(new Promise(() => {}));
    const { wrap } = makeOutbox();
    const loading = await render(wrap(<TeamScreen teamId={TEAM} />));
    await fireEvent.press(screen.getByRole("button", { name: `Back to ${strings.home.title}` }));
    expect(mockBack).toHaveBeenCalledTimes(1);
    await loading.unmount();

    mockTeam.mockRejectedValue(new DataError("FFSA Hub couldn't load this right now.", false));
    const failed = await render(wrap(<TeamScreen teamId={TEAM} />));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: `Back to ${strings.home.title}` })).toBeTruthy();
    await failed.unmount();

    mockTeam.mockResolvedValue(money());
    await render(wrap(<TeamScreen teamId={TEAM} />));
    await screen.findByRole("header", { name: "Mozambique Outreach" });
    await fireEvent.press(screen.getByRole("button", { name: `Back to ${strings.home.title}` }));
    expect(mockBack).toHaveBeenCalledTimes(2);
    noProblems();
  });

  it("one number (left to spend, whole rands), the currency line, and Budget · Spent · Left", async () => {
    mockTeam.mockResolvedValue(money({ expenses: [exp({ id: "e1", category_id: "food", description: "Groceries", zar_amount: 250.5 })] }));
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByText(strings.team.leftToSpend)).toBeTruthy();
    // 5000 − 250.50, shown without cents.
    expect(screen.getAllByText(formatMoney(4749.5, "ZAR", { cents: false })).length).toBeGreaterThan(0);
    expect(screen.getByText(strings.team.teamSpendsIn("MZN"))).toBeTruthy();
    expect(screen.getByText("5% spent")).toBeTruthy();
    expect(screen.getByText("2026-12-01 – 2026-12-21")).toBeTruthy();
    // The single amount keeps its cents (also the section's total).
    expect(screen.getAllByText(formatMoney(250.5, "ZAR")).length).toBeGreaterThan(0);
    expect(screen.getByRole("header", { name: `${strings.team.expenses}, 1 · ${formatMoney(250.5, "ZAR")}` })).toBeTruthy();
  });

  it("the missing-receipt band has the code's wording and no button; the unsent box sits above the budget lines", async () => {
    mockTeam.mockResolvedValue(money());
    const { wrap } = makeOutbox([expenseItem(), receiptItem({ id: "r-9", expenseId: "other", fileName: "IMG_2231.jpg", status: "failed", lastError: "Too big." })], {
      isOnline: async () => false,
    });
    await render(wrap(<TeamScreen teamId={TEAM} />));
    const band = await screen.findByTestId("needs-you");
    expect(screen.getByText(strings.team.missingReceipts(2))).toBeTruthy();
    expect(within(band).queryAllByRole("button")).toHaveLength(0);

    expect(screen.getByText("1 waiting · 1 needs you")).toBeTruthy();
    // "Needs you" twice: the band's eyebrow and the failed item's state. Only one of them is yellow.
    expect(screen.getAllByText(outboxStrings.state.needsYou)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Retry: IMG_2231.jpg" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove: IMG_2231.jpg" })).toBeTruthy();
    const order = [strings.team.addExpense, strings.outbox.savedNotSent, strings.team.budgetLines, strings.team.expenses].map(position);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((p) => p >= 0)).toBe(true);
    noProblems();
  });

  it("Remove asks first", async () => {
    mockTeam.mockResolvedValue(money());
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { wrap, outbox } = makeOutbox([expenseItem({ status: "failed", lastError: "x" })]);
    await render(wrap(<TeamScreen teamId={TEAM} />));
    await fireEvent.press(await screen.findByRole("button", { name: /^Remove: / }));
    expect(alert).toHaveBeenCalledWith(strings.outbox.discardConfirmTitle, strings.outbox.discardConfirmBody, expect.any(Array));
    expect(outbox.getItems()).toHaveLength(1);
    alert.mockClear();
  });

  it("expense rows: category · paid by, Estimate and Slack tags, receipt status in words, amounts with cents", async () => {
    mockTeam.mockResolvedValue(money());
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    await screen.findByTestId("expense-row-e2");
    expect(screen.getByText("Local transport · Card")).toBeTruthy();
    expect(screen.getByText(strings.expense.estimate)).toBeTruthy();
    expect(screen.getByText(strings.team.slack)).toBeTruthy();
    expect(screen.getByText(formatMoney(980.4, "ZAR"))).toBeTruthy();
    expect(screen.getByText(formatMoney(3420, "MZN"))).toBeTruthy();
    expect(screen.getByText(strings.expense.receiptCount(1))).toBeTruthy();
    expect(screen.getAllByText(strings.expense.noReceipt)).toHaveLength(2);
    expect(screen.getByTestId("expense-row-e3").props.accessibilityLabel).toMatch(/Logged from Slack$/);
  });

  it("a long expense list is virtualised: only the first rows render, drawn as one rounded group", async () => {
    const many = Array.from({ length: 150 }, (_, i) => exp({ id: `x${i}`, category_id: "food", description: `Expense ${i}`, zar_amount: 10 + i }));
    mockTeam.mockResolvedValue(money({ expenses: many, receiptCounts: {} }));
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByTestId("expense-row-x0")).toBeTruthy();
    expect(screen.queryByTestId("expense-row-x149")).toBeNull();
    expect(screen.getByRole("header", { name: new RegExp(`^${strings.team.expenses}, 150 · `) })).toBeTruthy();
    // The first row carries the group's top corners and border.
    let node = screen.getByTestId("expense-row-x0").parent;
    while (node && flat(node.props.style).borderLeftWidth === undefined) node = node.parent;
    expect(flat(node?.props.style)).toMatchObject({ borderTopLeftRadius: 8, borderTopWidth: 1, borderBottomWidth: 0 });
  });

  it("the saved-offline note coming back from the form is the calm queued banner, not an alert", async () => {
    setFlash(TEAM, { tone: "info", message: strings.expense.savedOffline });
    mockTeam.mockResolvedValue(money());
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByText(strings.expense.savedOffline)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Team: view only and over budget (3.7)", () => {
  it.each(["light", "dark"] as const)("says 'View only' and 'Over budget' in words; no Add expense, no band (%s)", async (scheme) => {
    mockScheme = scheme;
    mockTeam.mockResolvedValue(money({ canEdit: false, team: { ...money().team, status: "review" } }));
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByText(strings.team.viewOnly)).toBeTruthy();
    expect(screen.getByText("Review")).toBeTruthy();
    // 5730.90 spent of 5000: the overage as a plain amount, under the words.
    expect(screen.getByText(strings.team.over)).toBeTruthy();
    const overage = formatMoney(731, "ZAR", { cents: false });
    const number = screen.getAllByText(overage)[0];
    expect(flat(number.props.style).color).toBe(colors[scheme].danger);
    expect(screen.getByText(`${strings.team.over} by ${overage}`)).toBeTruthy();
    expect(screen.getByLabelText(strings.a11y.overNow("731 rand"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: strings.team.addExpense })).toBeNull();
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });

  it("dark: Add expense is the yellow primary with black text", async () => {
    mockScheme = "dark";
    mockTeam.mockResolvedValue(money());
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    const add = await screen.findByRole("button", { name: strings.team.addExpense });
    expect(flat(add.props.style).backgroundColor).toBe(colors.dark.accent);
    expect(flat(screen.getByText(strings.team.addExpense).props.style).color).toBe(colors.dark.onAccent);
  });
});

describe("Team: member (3.3)", () => {
  it("who's going, no money, the leaders' note; rows are not buttons", async () => {
    mockTeam.mockResolvedValue({
      kind: "member",
      overview: {
        id: TEAM,
        team_name: "Mozambique Outreach",
        location: "Maputo",
        country: "Mozambique",
        status: "active",
        start_date: "2026-12-01",
        end_date: "2026-12-21",
        program_name: "School of Missions",
        my_role: "team_member",
        roster: [
          { id: "p1", role: "owner", name: "Test Leader A" },
          { id: "p2", role: "team_member", name: null },
        ],
      },
    });
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByRole("header", { name: `${strings.team.whoIsGoing}, 2` })).toBeTruthy();
    expect(screen.getByText("School of Missions · Maputo · Mozambique")).toBeTruthy();
    expect(screen.getByText("2026-12-01 – 2026-12-21 · 2 people · you're a team member")).toBeTruthy();
    expect(screen.getByLabelText("Test Leader A, Owner")).toBeTruthy();
    expect(screen.getByLabelText("Unnamed, Team member")).toBeTruthy();
    expect(screen.getByText(strings.team.memberNote)).toBeTruthy();
    expect(screen.queryByText(/R\s\d/)).toBeNull();
    // The only control is the way back.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    noProblems();
  });
});

// ── 3.4, 3.8, 3.9 ───────────────────────────────────────────────────────────

describe("Add expense (3.4 / 3.8)", () => {
  const abroad = (over: Partial<TeamMoneyView> = {}) => money({ expenses: [], ...over });

  it("is a pushed form: Cancel goes back, the title is in the bar, and it says which team", async () => {
    mockTeam.mockResolvedValue(abroad());
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    expect(await screen.findByText(strings.expense.loggingTo("Mozambique Outreach"))).toBeTruthy();
    expect(screen.getByRole("header", { name: strings.expense.newTitle })).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: strings.expense.cancel }));
    expect(mockBack).toHaveBeenCalled();
    noProblems();
  });

  it("Cancel is there while the team loads, too", async () => {
    mockTeam.mockReturnValue(new Promise(() => {}));
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    expect(screen.getByRole("button", { name: strings.expense.cancel })).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: strings.team.loading })).toBeTruthy();
  });

  it("Paid by is five chips; a team abroad gets currency quick chips", async () => {
    mockTeam.mockResolvedValue(abroad());
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    expect(await screen.findByRole("header", { name: strings.expense.paymentMethod })).toBeTruthy();
    for (const m of ["Cash", "Card", "Bank transfer", "Reimbursement", "Prepayment"]) expect(screen.getByRole("radio", { name: m })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Cash" }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByRole("radio", { name: "MZN" }).props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByRole("radio", { name: "ZAR" }));
    expect(screen.getByLabelText(`${strings.expense.amount} (rand)`)).toBeTruthy();
    expect(screen.queryByLabelText(strings.expense.zarAmount)).toBeNull();
  });

  it("foreign cash with a cash pull: the rand is a read-only estimate, with the note and no rate button", async () => {
    mockTeam.mockResolvedValue(abroad({ pulls: [{ batch_date: "2026-12-01", local_currency: "MZN", exchange_rate: 3.5 }] }));
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    await fireEvent.changeText(await screen.findByLabelText(`${strings.expense.amount} (MZN)`), "7600");
    const rand = screen.getByLabelText(strings.expense.zarEstimate);
    expect(rand.props.value).toBe("2171.43");
    expect(rand.props.editable).toBe(false);
    expect(screen.getByText(strings.expense.pullNote("MZN"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: strings.expense.useTodaysRate })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("foreign cash without a pull: type the rand, or use today's rate (and say so if it can't be fetched)", async () => {
    mockTeam.mockResolvedValue(abroad());
    mockApi.mockResolvedValueOnce({ rate: 0.29 }).mockRejectedValueOnce(new ApiError("network", "offline"));
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    await fireEvent.changeText(await screen.findByLabelText(`${strings.expense.amount} (MZN)`), "1000");
    expect(screen.getByText(strings.expense.noPullNote("MZN"))).toBeTruthy();
    expect(screen.getByLabelText(strings.expense.zarAmount).props.editable).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: strings.expense.useTodaysRate }));
    await waitFor(() => expect(screen.getByLabelText(strings.expense.zarAmount).props.value).toBe("290.00"));
    await fireEvent.press(screen.getByRole("button", { name: strings.expense.useTodaysRate }));
    expect(await screen.findByText(strings.expense.rateFailed)).toBeTruthy();
  });

  it("card abroad: 'Rand charged (from your bank app)' with the switch and what it means", async () => {
    mockTeam.mockResolvedValue(abroad());
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    await fireEvent.press(await screen.findByRole("radio", { name: "Card" }));
    expect(screen.getByLabelText(strings.expense.zarFromBank)).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: strings.expense.zarConfirmed });
    expect(toggle.props.value).toBe(false);
    expect(screen.getByText(strings.expense.zarConfirmedHint, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.expense.useTodaysRate })).toBeTruthy();
    await fireEvent(toggle, "valueChange", true);
    expect(screen.getByRole("switch", { name: strings.expense.zarConfirmed }).props.value).toBe(true);
    expect(screen.queryByText(strings.expense.zarConfirmedHint, { includeHiddenElements: true })).toBeNull();
  });

  it("More details opens and closes the extra fields", async () => {
    mockTeam.mockResolvedValue(abroad());
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    expect(await screen.findByRole("button", { name: strings.expense.moreDetails })).toBeTruthy();
    expect(screen.queryByLabelText(strings.expense.vendor)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: strings.expense.moreDetails }));
    for (const f of [strings.expense.vendor, strings.expense.purchaser, strings.expense.receiptCode, strings.expense.country, strings.expense.notes]) {
      expect(screen.getByLabelText(f)).toBeTruthy();
    }
    const fewer = screen.getByRole("button", { name: strings.expense.lessDetails });
    expect(fewer.props.accessibilityState).toMatchObject({ expanded: true });
    await fireEvent.press(fewer);
    expect(screen.queryByLabelText(strings.expense.vendor)).toBeNull();
  });

  it.each(["light", "dark"] as const)("a receipt is required: the message is an alert in the danger colour (%s)", async (scheme) => {
    mockScheme = scheme;
    mockTeam.mockResolvedValue(abroad());
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    await fireEvent.press(await screen.findByRole("button", { name: strings.expense.save }));
    const message = screen.getByText(strings.expense.receiptRequired);
    expect(message.props.accessibilityRole).toBe("alert");
    expect(flat(message.props.style).color).toBe(colors[scheme].danger);
    expect(screen.getByRole("button", { name: strings.expense.takePhoto })).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.expense.chooseLibrary })).toBeTruthy();
  });
});

describe("Expense: view and edit (3.9)", () => {
  const EXISTING = exp({ id: "e1", category_id: "food", description: "Groceries", local_currency: "ZAR", local_amount: 250.5, zar_amount: 250.5 });
  const RECEIPT = {
    id: "r1",
    expense_id: "e1",
    file_path: "t/e1/1_a.jpg",
    file_name: "a.jpg",
    file_size: 1,
    mime_type: "image/jpeg",
    uploaded_at: null,
    signed_url: "https://test-project.supabase.co/storage/v1/object/sign/outreach-receipts/t/e1/1_a.jpg?token=x",
  };
  const receiptsApi = (list: unknown[]) =>
    mockApi.mockImplementation(async (_p: string, init?: { method?: string; schema?: { parse: (v: unknown) => unknown } }) => {
      const body = init?.method === "DELETE" ? { success: true } : { data: list };
      return init?.schema ? init.schema.parse(body) : body;
    });

  it("title 'Expense', back to the team, receipt count, Save changes and Delete expense", async () => {
    mockTeam.mockResolvedValue(money({ expenses: [EXISTING] }));
    receiptsApi([RECEIPT]);
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} expenseId="e1" />));
    expect(await screen.findByRole("header", { name: strings.expense.editTitle })).toBeTruthy();
    expect(screen.getByText(strings.expense.loggingTo("Mozambique Outreach"))).toBeTruthy();
    await screen.findByRole("imagebutton", { name: strings.expense.viewReceipt(1) });
    expect(screen.getByText(strings.expense.receiptCount(1))).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.expense.saveChanges })).toBeTruthy();
    expect(screen.getByRole("button", { name: strings.expense.delete })).toBeTruthy();
    expect(screen.getByText(strings.expense.onHub(formatMoney(250.5, "ZAR")))).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back to Mozambique Outreach" }));
    expect(mockBack).toHaveBeenCalled();
    noProblems();
  });

  it("deleting a receipt asks first, then deletes it through the API", async () => {
    mockTeam.mockResolvedValue(money({ expenses: [EXISTING] }));
    receiptsApi([RECEIPT]);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} expenseId="e1" />));
    await fireEvent.press(await screen.findByRole("button", { name: `${strings.expense.deleteReceipt} 1` }));
    expect(alert).toHaveBeenCalledWith(strings.expense.deleteReceiptConfirm, "a.jpg", expect.any(Array));
    expect(mockApi.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    const buttons = alert.mock.calls[0][2] as { style?: string; onPress?: () => Promise<void> }[];
    await act(async () => {
      await buttons.find((b) => b.style === "destructive")?.onPress?.();
    });
    expect(mockApi.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
    alert.mockClear();
  });

  it("deleting the expense asks first, with the warning about its receipts", async () => {
    mockTeam.mockResolvedValue(money({ expenses: [EXISTING] }));
    receiptsApi([]);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} expenseId="e1" />));
    await fireEvent.press(await screen.findByRole("button", { name: strings.expense.delete }));
    expect(alert).toHaveBeenCalledWith(strings.expense.deleteConfirmTitle, strings.expense.deleteConfirmBody, expect.any(Array));
    expect(mockBack).not.toHaveBeenCalled();
    alert.mockClear();
  });

  it("a photo still waiting to upload shows in the unsent box with Retry / Remove", async () => {
    mockTeam.mockResolvedValue(money({ expenses: [EXISTING] }));
    receiptsApi([]);
    const { wrap } = makeOutbox([receiptItem({ expenseId: "e1", status: "failed", lastError: "Too big." })], { isOnline: async () => false });
    await render(wrap(<ExpenseScreen teamId={TEAM} expenseId="e1" />));
    expect(await screen.findByText(strings.outbox.savedNotSent)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry: receipt.jpg" })).toBeTruthy();
  });

  it("view only: says so, fields are locked, no buttons; back still works while loading and when it has gone", async () => {
    mockTeam.mockResolvedValue(money({ expenses: [EXISTING], canEdit: false }));
    receiptsApi([RECEIPT]);
    const { wrap } = makeOutbox();
    const first = await render(wrap(<ExpenseScreen teamId={TEAM} expenseId="e1" />));
    expect(await screen.findByText(strings.expense.readOnly)).toBeTruthy();
    expect(screen.getByLabelText(strings.expense.description).props.editable).toBe(false);
    expect(screen.getByRole("button", { name: `${strings.expense.category}: Food` }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByRole("radio", { name: "Card" }).props.accessibilityState).toMatchObject({ disabled: true });
    await screen.findByRole("imagebutton", { name: strings.expense.viewReceipt(1) });
    expect(screen.queryByRole("button", { name: `${strings.expense.deleteReceipt} 1` })).toBeNull();
    expect(screen.queryByRole("button", { name: strings.expense.today })).toBeNull();
    await first.unmount();

    await render(wrap(<ExpenseScreen teamId={TEAM} expenseId="missing" />));
    expect(await screen.findByText(strings.expense.gone)).toBeTruthy();
    expect(screen.getByRole("button", { name: `Back to ${strings.expense.backToTeam}` })).toBeTruthy();
  });
});
