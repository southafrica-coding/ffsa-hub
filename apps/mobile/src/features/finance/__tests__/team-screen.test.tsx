import { fireEvent, render, screen } from "@testing-library/react-native";

import { DataError, loadTeam, type TeamMoneyView } from "../data";
import { setFlash } from "../flash";
import TeamScreen from "../screens/TeamScreen";
import { strings } from "../strings";
import { expenseSchema } from "../types";
import { TEAM, receiptItem } from "../__fixtures__/fixtures";
import { makeOutbox } from "../__fixtures__/outbox-harness";

const mockPush = jest.fn();
jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual("react");
  return { useRouter: () => ({ push: mockPush, back: jest.fn() }), useFocusEffect: (cb: () => void) => useEffect(cb, [cb]) };
});
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("@react-native-community/netinfo", () => ({ __esModule: true, default: { fetch: async () => ({ isConnected: true }), addEventListener: () => () => {} } }));
jest.mock("../cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../data", () => ({ ...jest.requireActual("../data"), loadTeam: jest.fn() }));

const mockLoad = loadTeam as jest.Mock;

const exp = (over: Record<string, unknown>) =>
  expenseSchema.parse({ team_id: TEAM, expense_date: "2026-11-02", payment_method: "cash", zar_amount: 100, ...over });

function money(over: Partial<TeamMoneyView> = {}): TeamMoneyView {
  return {
    kind: "money",
    team: { id: TEAM, team_name: "Burundi", location: "Bujumbura", country: "Burundi", status: "active", currency: "ZAR", start_date: "2026-11-01", end_date: null },
    canEdit: true,
    categories: [
      { id: "food", name: "Food", sort_order: 1 },
      { id: "travel", name: "Travel", sort_order: 2 },
    ],
    budgets: [
      { team_id: TEAM, category_id: "food", budget_amount_zar: 1000 },
      { team_id: TEAM, category_id: "travel", budget_amount_zar: 4000 },
    ],
    expenses: [
      exp({ id: "e1", category_id: "food", description: "Bread", zar_amount: 250 }),
      exp({ id: "e2", category_id: "travel", description: "Taxi", zar_amount: 600, payment_method: "card", local_currency: "USD", local_amount: 32, zar_confirmed: false }),
    ],
    pulls: [],
    receiptCounts: { e1: 2 },
    ...over,
  };
}

beforeEach(() => {
  mockLoad.mockReset();
  mockPush.mockReset();
});

describe("Team screen", () => {
  it("shows a skeleton while loading", async () => {
    mockLoad.mockReturnValue(new Promise(() => {}));
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(screen.getByLabelText(strings.team.loading)).toBeTruthy();
  });

  it("shows an error with a retry", async () => {
    mockLoad.mockRejectedValueOnce(new DataError("FFSA Hub couldn't load this right now. Try again in a moment.", false)).mockResolvedValueOnce(money());
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByText(/couldn't load this right now/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("header", { name: "Burundi" })).toBeTruthy();
  });

  it("says plainly when you can't see the team (permission denied)", async () => {
    mockLoad.mockResolvedValue({ kind: "none" });
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByText(strings.team.notFound)).toBeTruthy();
    expect(screen.queryByRole("button", { name: strings.team.addExpense })).toBeNull();
  });

  it("gives a plain member the trip, not the money", async () => {
    mockLoad.mockResolvedValue({
      kind: "member",
      overview: {
        id: TEAM,
        team_name: "Burundi",
        location: null,
        country: null,
        status: "active",
        start_date: null,
        end_date: null,
        program_name: "DTS",
        my_role: "team_member",
        roster: [
          { id: "p1", role: "owner", name: "Thandi" },
          { id: "p2", role: "team_member", name: "Sipho" },
        ],
      },
    });
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByText("Thandi")).toBeTruthy();
    expect(screen.getByText(strings.team.memberNote)).toBeTruthy();
    expect(screen.queryByText(/rand/)).toBeNull();
    expect(screen.queryByRole("button", { name: strings.team.addExpense })).toBeNull();
  });

  it("shows budget, spent and left, budget lines and expenses for a leader", async () => {
    mockLoad.mockResolvedValue(money());
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByLabelText("Left: 4150 rand")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: /Budget 5000 rand, Spent 850 rand, Left 4150 rand\. 17 percent spent/ })).toBeTruthy();
    expect(screen.getByLabelText(/^Food\. Budget 1000 rand, Spent 250 rand, Left 750 rand$/)).toBeTruthy();
    const taxi = screen.getByTestId("expense-row-e2");
    expect(taxi.props.accessibilityLabel).toMatch(/Taxi.*600 rand.*Travel.*Card.*Estimate.*No receipt/);
    expect(screen.getByTestId("expense-row-e1").props.accessibilityLabel).toMatch(/2 receipts/);
  });

  it("raises one yellow band for expenses missing a receipt", async () => {
    mockLoad.mockResolvedValue(money());
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findAllByTestId("needs-you")).toHaveLength(1);
    expect(screen.getByText(strings.team.missingReceipts(1))).toBeTruthy();
  });

  it("filters the expenses by budget line", async () => {
    mockLoad.mockResolvedValue(money());
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    await screen.findByTestId("expense-row-e2");
    await fireEvent.press(screen.getByRole("radio", { name: "Food (1)" }));
    expect(screen.queryByTestId("expense-row-e2")).toBeNull();
    expect(screen.getByTestId("expense-row-e1")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Food (1)" }).props.accessibilityState).toMatchObject({ selected: true });
  });

  it("opens Add expense and an expense", async () => {
    mockLoad.mockResolvedValue(money());
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    await fireEvent.press(await screen.findByRole("button", { name: strings.team.addExpense }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/finance/[teamId]/new", params: { teamId: TEAM } });
    await fireEvent.press(screen.getByTestId("expense-row-e1"));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/finance/[teamId]/expense/[expenseId]", params: { teamId: TEAM, expenseId: "e1" } });
  });

  it("is view-only for finance viewers: no Add, no band, says so", async () => {
    mockLoad.mockResolvedValue(money({ canEdit: false }));
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByText(strings.team.viewOnly)).toBeTruthy();
    expect(screen.queryByRole("button", { name: strings.team.addExpense })).toBeNull();
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });

  it("shows the empty state", async () => {
    mockLoad.mockResolvedValue(money({ expenses: [], budgets: [] }));
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByText(strings.team.noExpenses)).toBeTruthy();
  });

  it("shows what's saved on this phone with Retry, and counts it as a waiting receipt", async () => {
    mockLoad.mockResolvedValue(money());
    const { wrap, deps } = makeOutbox([receiptItem({ expenseId: "e2", status: "failed", lastError: "You don't have permission." })]);
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByText(strings.outbox.savedNotSent)).toBeTruthy();
    expect(screen.getByText("You don't have permission.")).toBeTruthy();
    expect(screen.getByTestId("expense-row-e2").props.accessibilityLabel).toMatch(/1 receipt waiting to upload/);
    // No band: the only expense without a receipt has one waiting.
    expect(screen.queryByTestId("needs-you")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /^Retry: receipt\.jpg$/ }));
    expect(deps.uploadFile).toHaveBeenCalled();
  });

  it("announces what happened when coming back from the form", async () => {
    setFlash(TEAM, { tone: "info", message: strings.expense.savedOffline });
    mockLoad.mockResolvedValue(money());
    const { wrap } = makeOutbox();
    await render(wrap(<TeamScreen teamId={TEAM} />));
    expect(await screen.findByText(strings.expense.savedOffline)).toBeTruthy();
  });
});
