// Finance outbox hardening: stored-shape checks, double taps, no Remove
// mid-send, classification of busy servers, and the list's failure UI.

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

import { ApiError } from "@/lib/api";
import { outboxStrings } from "@/lib/outbox/strings";

import { OutboxList } from "../components/OutboxList";
import { discard, enqueue, isOutboxItem } from "../outbox/state";
import { strings } from "../strings";
import { EXPENSE, expenseItem, receiptItem } from "../__fixtures__/fixtures";
import { makeOutbox } from "../__fixtures__/outbox-harness";

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { fetch: async () => ({ isConnected: true }), addEventListener: () => () => {} },
}));
jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("expo-file-system", () => ({}));

// eslint-disable-next-line import/first
import { classifyUpload } from "../outbox/live";

describe("finance outbox state", () => {
  it("the same photo queued twice (double tap) is one receipt", () => {
    const r = receiptItem();
    expect(enqueue([r], receiptItem({ id: "r-2" }))).toHaveLength(1);
    expect(enqueue([r], receiptItem({ id: "r-2", localUri: "file:///other.jpg" }))).toHaveLength(2);
  });

  it("Remove is refused while an item is mid-send", () => {
    const e = expenseItem({ status: "sending" });
    expect(discard([e, receiptItem()], EXPENSE).removed).toEqual([]);
  });

  it("stored-shape check", () => {
    expect(isOutboxItem(expenseItem())).toBe(true);
    expect(isOutboxItem(receiptItem())).toBe(true);
    expect(isOutboxItem({ ...receiptItem(), fileUploaded: "no" } as never)).toBe(false);
    expect(isOutboxItem({ ...expenseItem(), teamId: undefined } as never)).toBe(false);
    expect(isOutboxItem({ ...expenseItem(), payload: null } as never)).toBe(false);
  });
});

describe("classifyUpload", () => {
  it("busy or slow servers retry; refusals need the person", () => {
    expect(classifyUpload(new ApiError("http", "busy", 429)).permanent).toBe(false);
    expect(classifyUpload(new ApiError("http", "slow", 408)).permanent).toBe(false);
    expect(classifyUpload(new ApiError("http", "boom", 502))).toMatchObject({ permanent: false, ambiguous: true });
    expect(classifyUpload(new ApiError("timeout", "slow"))).toMatchObject({ permanent: false, ambiguous: true });
    expect(classifyUpload(new ApiError("http", "bad", 422)).permanent).toBe(true);
    expect(classifyUpload(new ApiError("unauthenticated", "signed out", 401)).permanent).toBe(false);
  });
});

describe("OutboxList failure UI", () => {
  it("empty and no problem: nothing", async () => {
    const { outbox } = makeOutbox();
    await render(<OutboxList items={[]} outbox={outbox} />);
    expect(screen.queryByTestId("outbox-list")).toBeNull();
  });

  it("waiting, with a count and the shared wording", async () => {
    const { outbox } = makeOutbox();
    await render(<OutboxList items={[expenseItem({ lastError: "Server busy." })]} outbox={outbox} />);
    expect(screen.getByText("1 waiting")).toBeTruthy();
    expect(screen.getByText(outboxStrings.state.waiting)).toBeTruthy();
    expect(screen.getByText(`Server busy. ${outboxStrings.next.waiting}`)).toBeTruthy();
  });

  it("sending: no Retry or Remove while it's on the wire", async () => {
    const { outbox } = makeOutbox();
    await render(<OutboxList items={[expenseItem({ status: "sending" })]} outbox={outbox} />);
    expect(screen.getByText(outboxStrings.state.sending)).toBeTruthy();
    expect(screen.queryByText(strings.outbox.retry)).toBeNull();
    expect(screen.queryByText(strings.outbox.discard)).toBeNull();
  });

  it("needs you: reason, next step, last tried; the row reads as one sentence", async () => {
    const { outbox } = makeOutbox();
    const tried = new Date();
    tried.setHours(8, 30, 0, 0);
    await render(<OutboxList items={[expenseItem({ status: "failed", lastError: "No access.", lastTriedAt: tried.getTime() })]} outbox={outbox} />);
    expect(screen.getByText(outboxStrings.state.needsYou)).toBeTruthy();
    expect(screen.getByText("Last tried 08:30")).toBeTruthy();
    expect(screen.getByLabelText(/Needs you\. No access\..*Last tried 08:30/)).toBeTruthy();
  });

  it("Remove asks before deleting", async () => {
    const { outbox } = makeOutbox();
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await render(<OutboxList items={[expenseItem({ status: "failed", lastError: "x" })]} outbox={outbox} />);
    fireEvent.press(screen.getByText(strings.outbox.discard));
    expect(alert).toHaveBeenCalledWith(strings.outbox.discardConfirmTitle, strings.outbox.discardConfirmBody, expect.any(Array));
    alert.mockClear();
  });

  it("a damaged saved list: the notice shows even with nothing to list, and OK hides it", async () => {
    const { outbox, storage } = makeOutbox();
    storage.read = async () => "{broken" as never;
    await outbox.init();
    await render(<OutboxList items={[]} outbox={outbox} />);
    expect(screen.getByText(outboxStrings.problem.corrupt)).toBeTruthy();
    fireEvent.press(screen.getByText(outboxStrings.problem.dismiss));
    await waitFor(() => expect(screen.queryByTestId("outbox-store-problem")).toBeNull());
  });
});
