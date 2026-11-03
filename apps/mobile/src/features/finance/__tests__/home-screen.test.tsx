import { fireEvent, render, screen } from "@testing-library/react-native";

import { readCache } from "../cache";
import { DataError, loadHome, type HomeData } from "../data";
import FinanceHomeScreen from "../screens/HomeScreen";
import { strings } from "../strings";
import { TEAM, expenseItem } from "../__fixtures__/fixtures";
import { makeOutbox } from "../__fixtures__/outbox-harness";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("@/lib/api-client", () => ({ apiFetch: jest.fn() }));
jest.mock("@/auth/session-provider", () => ({ useSession: () => ({ status: "signedIn", session: { user: { id: "user-1" } } }) }));
jest.mock("@react-native-community/netinfo", () => ({ __esModule: true, default: { fetch: async () => ({ isConnected: true }), addEventListener: () => () => {} } }));
jest.mock("../use-me", () => ({ useMe: () => null, isFinanceStaff: () => false }));
jest.mock("../cache", () => ({
  readCache: jest.fn(async () => null),
  writeCache: jest.fn(async () => {}),
  formatSavedAt: () => "09:05",
}));
jest.mock("../data", () => ({ ...jest.requireActual("../data"), loadHome: jest.fn() }));

const mockLoad = loadHome as jest.Mock;
const mockRead = readCache as jest.Mock;

const DATA: HomeData = {
  teams: [
    {
      membership_id: "m1",
      role: "owner",
      team_id: TEAM,
      team_name: "Burundi",
      location: "Bujumbura",
      country: "Burundi",
      status: "active",
      start_date: "2026-11-01",
      end_date: "2026-12-01",
      program_name: "DTS",
      money: { currency: "ZAR", budget: 10000, spent: 2500 },
    },
    {
      membership_id: "m2",
      role: "team_member",
      team_id: "t-2",
      team_name: "Malawi",
      location: null,
      country: null,
      status: "planning",
      start_date: null,
      end_date: null,
      program_name: null,
      money: null,
    },
  ],
};

beforeEach(() => {
  mockLoad.mockReset();
  mockRead.mockReset().mockResolvedValue(null);
  mockPush.mockReset();
});

describe("My Finance home", () => {
  it("shows a skeleton while loading", async () => {
    mockLoad.mockReturnValue(new Promise(() => {}));
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    expect(screen.getByLabelText(strings.home.loading)).toBeTruthy();
    expect(screen.getByRole("header", { name: "My finance" })).toBeTruthy();
  });

  it("shows the empty state when you're on no team", async () => {
    mockLoad.mockResolvedValue({ teams: [] });
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    expect(await screen.findByText(strings.home.emptyTitle)).toBeTruthy();
    expect(screen.queryByTestId("needs-you")).toBeNull();
  });

  it("shows an error with a working retry", async () => {
    mockLoad.mockRejectedValueOnce(new DataError("Couldn't reach FFSA Hub. Check your connection and try again.", true)).mockResolvedValueOnce(DATA);
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    expect(await screen.findByText("Couldn't reach FFSA Hub. Check your connection and try again.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Burundi")).toBeTruthy();
  });

  it("lists teams: figures in words for a leader, none for a plain member", async () => {
    mockLoad.mockResolvedValue(DATA);
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    const leader = await screen.findByTestId(`team-row-${TEAM}`);
    expect(leader.props.accessibilityLabel).toContain("Spent 2500 rand of 10000 rand, Left 7500 rand");
    // The bar itself is hidden from screen readers (the row says it in words).
    expect(screen.getByText(/25% spent/, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("team-row-t-2").props.accessibilityLabel).toContain(strings.home.noMoney);
    expect(screen.getByText(strings.home.noMoney)).toBeTruthy();
  });

  it("opens a team", async () => {
    mockLoad.mockResolvedValue(DATA);
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    await fireEvent.press(await screen.findByTestId(`team-row-${TEAM}`));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/finance/[teamId]", params: { teamId: TEAM } });
  });

  it("keeps showing the saved copy when a refresh fails (offline)", async () => {
    mockRead.mockResolvedValue({ savedAt: 1, data: DATA });
    mockLoad.mockRejectedValue(new DataError("Couldn't reach FFSA Hub.", true));
    const { wrap } = makeOutbox();
    await render(wrap(<FinanceHomeScreen />));
    expect(await screen.findByText(strings.common.refreshFailed("09:05"))).toBeTruthy();
    expect(screen.getByText("Burundi")).toBeTruthy();
  });

  it("raises the one yellow band only for items that couldn't be sent", async () => {
    mockLoad.mockResolvedValue(DATA);
    const { wrap } = makeOutbox([expenseItem({ status: "failed", lastError: "no" })]);
    await render(wrap(<FinanceHomeScreen />));
    await screen.findByText("Burundi");
    expect(await screen.findAllByTestId("needs-you")).toHaveLength(1);
    expect(screen.getByText(/1 saved on this phone, not yet sent/)).toBeTruthy();
  });
});
