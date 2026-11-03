// Stand-ins shared by the Bookings screen tests (not a test file). Each test
// file still declares its own jest.mock calls (they're hoisted per file);
// these are the objects those mocks hand back.

import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { QueueItem } from "../outbox/state";

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

/** Screens (and the bottom sheet) read safe-area insets. */
export function inSafeArea(ui: ReactElement) {
  return <SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>;
}

export function fakeOutbox(initial: QueueItem[] = []) {
  let items = initial;
  const listeners = new Set<() => void>();
  const outbox = {
    getItems: () => items,
    getProblem: () => null as "corrupt" | "partial" | null,
    dismissProblem: jest.fn(),
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    add: jest.fn(async (...added: QueueItem[]) => {
      items = [...items, ...added];
    }),
    discard: jest.fn(async (id: string) => {
      items = items.filter((i) => i.id !== id);
    }),
    retry: jest.fn(async () => {}),
    /** What process() does to the queue; default: everything gets through. */
    onProcess: (current: QueueItem[]) => current.filter(() => false),
    process: jest.fn(async () => {
      items = outbox.onProcess(items);
    }),
    wake: jest.fn(async () => {}),
    init: jest.fn(async () => {}),
    nextWake: jest.fn(async () => null),
  };
  return outbox;
}

export type FakeOutbox = ReturnType<typeof fakeOutbox>;

export const perm = (key: string) => ({ key, scopeType: null, scopeId: null, source: "role" });
