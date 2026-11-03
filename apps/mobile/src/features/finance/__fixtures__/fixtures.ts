// Shared test data for the finance slice. Not a test file itself.

import type { ExpensePayload } from "../expense-form";
import type { ExpenseItem, OutboxItem, ReceiptItem } from "../outbox/state";

export const USER = "user-1";
export const TEAM = "7f1d2c3b-4a59-4e8d-8c7b-6a5f4e3d2c1b";
export const EXPENSE = "0b6c8a62-3c1e-4d2a-9f43-5e6f7a8b9c0d";

export const payload: ExpensePayload = {
  team_id: TEAM,
  category_id: "cat-food",
  expense_date: "2026-11-03",
  receipt_code: null,
  vendor: null,
  description: "Bread and milk",
  purchaser: null,
  payment_method: "cash",
  country: null,
  local_currency: "ZAR",
  local_amount: 120.5,
  zar_amount: 120.5,
  exchange_rate: 1,
  zar_confirmed: true,
  zar_estimate: null,
  zar_confirmed_at: null,
  cash_batch_id: null,
  notes: null,
};

export function expenseItem(over: Partial<ExpenseItem> = {}): ExpenseItem {
  return {
    kind: "expense",
    id: EXPENSE,
    userId: USER,
    teamId: TEAM,
    status: "waiting",
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    createdAt: 1000,
    payload,
    ...over,
  };
}

export function receiptItem(over: Partial<ReceiptItem> = {}): ReceiptItem {
  return {
    kind: "receipt",
    id: "r-1",
    userId: USER,
    teamId: TEAM,
    expenseId: EXPENSE,
    status: "waiting",
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    createdAt: 1001,
    localUri: "file:///docs/finance-outbox/r-1.jpg",
    fileName: "receipt.jpg",
    fileSize: 245_000,
    mimeType: "image/jpeg",
    filePath: `${TEAM}/${EXPENSE}/1762160000000_receipt.jpg`,
    fileUploaded: false,
    ...over,
  };
}

/** An in-memory OutboxStorage that also tracks which photo files exist. */
export function memoryStorage(initial: OutboxItem[] = [], files: string[] = []) {
  const store = {
    saved: JSON.parse(JSON.stringify(initial)) as OutboxItem[],
    files: new Map(files.map((f) => [f, 0])),
    writes: 0,
    async read() {
      return JSON.parse(JSON.stringify(store.saved)) as OutboxItem[];
    },
    async write(items: OutboxItem[]) {
      store.writes++;
      store.saved = JSON.parse(JSON.stringify(items));
    },
    deleteFile(uri: string) {
      store.files.delete(uri);
    },
    fileExists(uri: string) {
      return store.files.has(uri);
    },
    listFiles() {
      return [...store.files.entries()].map(([uri, modifiedAt]) => ({ uri, modifiedAt }));
    },
  };
  return store;
}
