// A real Outbox with fake I/O, wrapped in its provider, for screen tests.

import type { ReactNode } from "react";

import { classify } from "../api";
import { OutboxProvider } from "../outbox/provider";
import { Outbox, type OutboxDeps } from "../outbox/runner";
import type { OutboxItem } from "../outbox/state";

import { USER, memoryStorage } from "./fixtures";

export function makeOutbox(initial: OutboxItem[] = [], over: Partial<OutboxDeps> = {}) {
  const storage = memoryStorage(initial, initial.flatMap((i) => (i.kind === "receipt" ? [i.localUri] : [])));
  // Photos the screen captured (mocked) count as present on the phone.
  storage.fileExists = () => true;
  const deps: OutboxDeps = {
    storage,
    createExpense: jest.fn(async () => ({})),
    registerReceipt: jest.fn(async () => ({})),
    uploadFile: jest.fn(async () => {}),
    classify,
    getUserId: async () => USER,
    isOnline: async () => true,
    now: () => Date.now(),
    ...over,
  };
  const outbox = new Outbox(deps);
  const wrap = (ui: ReactNode) => <OutboxProvider outbox={outbox}>{ui}</OutboxProvider>;
  return { outbox, deps, storage, wrap };
}
