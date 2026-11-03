import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

import { ApiError } from "@/lib/api";
import { apiFetch } from "@/lib/api-client";

import { takeReceiptPhoto } from "../capture";
import { loadTeam, type TeamMoneyView } from "../data";
import { todayIso } from "../expense-form";
import { takeFlash } from "../flash";
import ExpenseScreen from "../screens/ExpenseScreen";
import { strings } from "../strings";
import { expenseSchema } from "../types";
import { TEAM } from "../__fixtures__/fixtures";
import { makeOutbox } from "../__fixtures__/outbox-harness";

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, back: mockBack }) }));
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
let mockUuid = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, "0")}` }));
jest.mock("../outbox/store", () => ({ fileOutboxStorage: { deleteFile: jest.fn() } }));
jest.mock("../capture", () => ({ takeReceiptPhoto: jest.fn(), chooseReceiptPhotos: jest.fn() }));
jest.mock("../cache", () => ({ readCache: jest.fn(async () => null), writeCache: jest.fn(async () => {}), formatSavedAt: () => "09:05" }));
jest.mock("../data", () => ({ ...jest.requireActual("../data"), loadTeam: jest.fn() }));

const mockLoad = loadTeam as jest.Mock;
const mockApi = apiFetch as unknown as jest.Mock;
const mockTake = takeReceiptPhoto as jest.Mock;

const PHOTO = { localUri: "file:///docs/finance-outbox/p1.jpg", fileName: "IMG_1.jpg", fileSize: 200_000, mimeType: "image/jpeg" as const };
const EXISTING = expenseSchema.parse({
  id: "e1",
  team_id: TEAM,
  category_id: "food",
  expense_date: "2026-11-02",
  description: "Bread",
  payment_method: "cash",
  local_currency: "ZAR",
  local_amount: 250,
  zar_amount: 250,
});

function view(over: Partial<TeamMoneyView> = {}): TeamMoneyView {
  return {
    kind: "money",
    team: { id: TEAM, team_name: "Burundi", location: null, country: "Burundi", status: "active", currency: "ZAR", start_date: null, end_date: null },
    canEdit: true,
    categories: [
      { id: "food", name: "Food", sort_order: 1 },
      { id: "travel", name: "Travel", sort_order: 2 },
    ],
    budgets: [],
    expenses: [EXISTING],
    pulls: [],
    receiptCounts: {},
    ...over,
  };
}

async function fillValidForm() {
  await fireEvent.press(await screen.findByRole("button", { name: `${strings.expense.category}: ${strings.expense.categoryPlaceholder}` }));
  await fireEvent.press(screen.getByRole("radio", { name: "Food" }));
  await fireEvent.changeText(screen.getByLabelText(strings.expense.description), "Bread and milk");
  await fireEvent.changeText(screen.getByLabelText(`${strings.expense.amount} (rand)`), "120,50");
  await fireEvent.press(screen.getByRole("button", { name: strings.expense.takePhoto }));
  await screen.findByRole("imagebutton", { name: strings.expense.viewReceipt(1) });
}

beforeEach(() => {
  mockLoad.mockReset().mockResolvedValue(view());
  mockApi.mockReset();
  mockTake.mockReset().mockResolvedValue([PHOTO]);
  mockBack.mockReset();
  mockPush.mockReset();
  takeFlash(TEAM);
});

describe("Add expense", () => {
  it("shows a skeleton while the team loads", async () => {
    mockLoad.mockReturnValue(new Promise(() => {}));
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    expect(screen.getByLabelText(strings.team.loading)).toBeTruthy();
  });

  it("shows an error with a retry when the team can't load", async () => {
    mockLoad.mockRejectedValue(new Error("x"));
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    expect(await screen.findByText(strings.expense.loadError)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("refuses plain members (no money access) with a friendly message", async () => {
    mockLoad.mockResolvedValue({ kind: "member", overview: {} });
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    expect(await screen.findByText(strings.common.forbidden)).toBeTruthy();
  });

  it("starts on today, says which team it's logging to, and explains every missing field", async () => {
    const { wrap, deps } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    expect(await screen.findByText(strings.expense.loggingTo("Burundi"))).toBeTruthy();
    expect(screen.getByLabelText(strings.expense.date).props.value).toBe(todayIso());
    await fireEvent.press(screen.getByRole("button", { name: strings.expense.save }));
    expect(screen.getByText(strings.validation.category)).toBeTruthy();
    expect(screen.getByText(strings.validation.description)).toBeTruthy();
    expect(screen.getByText(strings.validation.amount)).toBeTruthy();
    expect(screen.getByText(strings.expense.receiptRequired)).toBeTruthy();
    expect(deps.createExpense).not.toHaveBeenCalled();
  });

  it("saves online: expense through the API with its own id, then the receipt; goes back saying so", async () => {
    const { wrap, deps, outbox } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    await fillValidForm();
    await fireEvent.press(screen.getByRole("button", { name: strings.expense.save }));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const [id, payload] = (deps.createExpense as jest.Mock).mock.calls[0];
    expect(id).toMatch(/^00000000-0000-4000-8000-/);
    expect(payload).toMatchObject({ team_id: TEAM, category_id: "food", description: "Bread and milk", zar_amount: 120.5, local_currency: "ZAR", payment_method: "cash" });
    expect(deps.uploadFile).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^${TEAM}/${id}/\\d+_IMG_1\\.jpg$`)), PHOTO.localUri, "image/jpeg");
    expect(deps.registerReceipt).toHaveBeenCalledWith(expect.objectContaining({ expense_id: id, file_name: "IMG_1.jpg" }));
    expect(outbox.getItems()).toEqual([]);
    expect(takeFlash(TEAM)).toEqual({ tone: "positive", message: strings.expense.savedOnline });
  });

  it("offline: keeps it on the phone and says 'saved on this phone, not yet sent'", async () => {
    const { wrap, outbox } = makeOutbox([], { isOnline: async () => false });
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    await fillValidForm();
    await fireEvent.press(screen.getByRole("button", { name: strings.expense.save }));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(outbox.getItems().map((i) => i.kind)).toEqual(["expense", "receipt"]);
    expect(takeFlash(TEAM)).toEqual({ tone: "info", message: strings.expense.savedOffline });
  });

  it("a dropped connection mid-save also stays on the phone (never lost, retried later)", async () => {
    const { wrap, outbox } = makeOutbox([], { createExpense: jest.fn(async () => Promise.reject(new ApiError("network", "Couldn't reach FFSA Hub."))) });
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    await fillValidForm();
    await fireEvent.press(screen.getByRole("button", { name: strings.expense.save }));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(outbox.getItems()[0]).toMatchObject({ kind: "expense", status: "waiting", attempts: 1 });
  });

  it("a 403 keeps the form open with the reason, and nothing left in the outbox", async () => {
    const { wrap, outbox } = makeOutbox([], {
      createExpense: jest.fn(async () => Promise.reject(new ApiError("forbidden", "You don't have access to this.", 403))),
    });
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    await fillValidForm();
    await fireEvent.press(screen.getByRole("button", { name: strings.expense.save }));
    expect(await screen.findByText(strings.common.forbidden)).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    expect(outbox.getItems()).toEqual([]);
    // The photo is still on the form, ready for another try.
    expect(screen.getByRole("imagebutton", { name: strings.expense.viewReceipt(1) })).toBeTruthy();
  });

  it("a card payment abroad asks for the bank-app rand and marks it confirmed", async () => {
    const { wrap, deps } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    await fillValidForm();
    await fireEvent.press(screen.getByRole("radio", { name: "Card" }));
    await fireEvent.changeText(screen.getByLabelText(strings.expense.currency), "usd");
    await fireEvent.changeText(screen.getByLabelText(`${strings.expense.amount} (USD)`), "10");
    await fireEvent.changeText(screen.getByLabelText(strings.expense.zarFromBank), "185");
    expect(screen.getByRole("switch", { name: strings.expense.zarConfirmed }).props.value).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: strings.expense.save }));
    await waitFor(() => expect(deps.createExpense).toHaveBeenCalled());
    expect((deps.createExpense as jest.Mock).mock.calls[0][1]).toMatchObject({
      payment_method: "card",
      local_currency: "USD",
      local_amount: 10,
      zar_amount: 185,
      zar_confirmed: true,
      zar_estimate: null,
    });
  });

  it("a removed draft photo is deleted from the phone", async () => {
    const { fileOutboxStorage } = jest.requireMock("../outbox/store") as { fileOutboxStorage: { deleteFile: jest.Mock } };
    fileOutboxStorage.deleteFile.mockClear();
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} />));
    await fireEvent.press(await screen.findByRole("button", { name: strings.expense.takePhoto }));
    await fireEvent.press(await screen.findByRole("button", { name: strings.expense.removePhoto(1) }));
    expect(fileOutboxStorage.deleteFile).toHaveBeenCalledWith(PHOTO.localUri);
    expect(screen.queryByRole("imagebutton", { name: strings.expense.viewReceipt(1) })).toBeNull();
  });
});

describe("Existing expense", () => {
  const receipts = { data: [{ id: "r1", expense_id: "e1", file_path: "t/e1/1_a.jpg", file_name: "a.jpg", file_size: 1, mime_type: "image/jpeg", uploaded_at: null, signed_url: "https://test-project.supabase.co/storage/v1/object/sign/outreach-receipts/t/e1/1_a.jpg?token=x" }] };

  it("loads its receipts (signed URLs from the API) and opens one full screen", async () => {
    mockApi.mockImplementation(async (_p: string, init?: { schema?: { parse: (v: unknown) => unknown } }) => (init?.schema ? init.schema.parse(receipts) : receipts));
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} expenseId="e1" />));
    expect(mockApi.mock.calls[0][0]).toBe("/api/finance/outreach/receipts?expense_id=e1");
    await fireEvent.press(await screen.findByRole("imagebutton", { name: strings.expense.viewReceipt(1) }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/finance/receipt", params: { uri: receipts.data[0].signed_url, title: "a.jpg" } });
  });

  it("says so when the receipts can't load, with a retry", async () => {
    mockApi.mockRejectedValue(new ApiError("network", "offline"));
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} expenseId="e1" />));
    expect(await screen.findByText(strings.expense.receiptsLoadError)).toBeTruthy();
  });

  it("saves changes with PUT through the API", async () => {
    mockApi.mockImplementation(async (path: string, init?: { method?: string; schema?: { parse: (v: unknown) => unknown } }) => {
      const body = init?.method === "PUT" ? { success: true, data: { ...EXISTING, description: "Bread rolls" } } : { data: [] };
      return init?.schema ? init.schema.parse(body) : body;
    });
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} expenseId="e1" />));
    await fireEvent.changeText(await screen.findByLabelText(strings.expense.description), "Bread rolls");
    await fireEvent.press(screen.getByRole("button", { name: strings.expense.saveChanges }));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    const put = mockApi.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(put?.[0]).toBe("/api/finance/outreach/expenses");
    expect(put?.[1].body).toMatchObject({ id: "e1", description: "Bread rolls", zar_amount: 250 });
  });

  it("deletes after a confirmation", async () => {
    mockApi.mockImplementation(async (_p: string, init?: { method?: string; schema?: { parse: (v: unknown) => unknown } }) => {
      const body = init?.method === "DELETE" ? { success: true } : { data: [] };
      return init?.schema ? init.schema.parse(body) : body;
    });
    const alert = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      void buttons?.find((b) => b.style === "destructive")?.onPress?.();
    });
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} expenseId="e1" />));
    await fireEvent.press(await screen.findByRole("button", { name: strings.expense.delete }));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockApi.mock.calls.find(([, init]) => init?.method === "DELETE")?.[0]).toBe("/api/finance/outreach/expenses?id=e1");
    alert.mockRestore();
  });

  it("a new photo on an existing expense goes straight into the outbox", async () => {
    mockApi.mockImplementation(async (_p: string, init?: { schema?: { parse: (v: unknown) => unknown } }) => (init?.schema ? init.schema.parse({ data: [] }) : { data: [] }));
    const { wrap, deps } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} expenseId="e1" />));
    await fireEvent.press(await screen.findByRole("button", { name: strings.expense.takePhoto }));
    await waitFor(() => expect(deps.registerReceipt).toHaveBeenCalledWith(expect.objectContaining({ expense_id: "e1" })));
  });

  it("is read-only for view-only staff: no Save, no Delete, no camera", async () => {
    mockLoad.mockResolvedValue(view({ canEdit: false }));
    mockApi.mockImplementation(async (_p: string, init?: { schema?: { parse: (v: unknown) => unknown } }) => (init?.schema ? init.schema.parse({ data: [] }) : { data: [] }));
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} expenseId="e1" />));
    expect(await screen.findByText(strings.expense.readOnly)).toBeTruthy();
    expect(screen.queryByRole("button", { name: strings.expense.saveChanges })).toBeNull();
    expect(screen.queryByRole("button", { name: strings.expense.delete })).toBeNull();
    expect(screen.queryByRole("button", { name: strings.expense.takePhoto })).toBeNull();
  });

  it("says so if the expense has gone", async () => {
    const { wrap } = makeOutbox();
    await render(wrap(<ExpenseScreen teamId={TEAM} expenseId="missing" />));
    expect(await screen.findByText(/isn't there any more/)).toBeTruthy();
  });
});
