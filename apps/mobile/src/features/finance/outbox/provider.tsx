import NetInfo from "@react-native-community/netinfo";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";

import type { Outbox } from "./runner";
import type { OutboxItem } from "./state";

type OutboxContextValue = { outbox: Outbox; online: boolean };

const OutboxContext = createContext<OutboxContextValue | null>(null);

/**
 * Keeps the outbox moving: sends on mount, whenever connectivity comes back,
 * whenever the app returns to the foreground, and when the next backoff
 * timer is due. Mounted by the finance stack's layout.
 */
export function OutboxProvider({ outbox, children }: { outbox: Outbox; children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const items = useSyncExternalStore(outbox.subscribe, outbox.getItems, outbox.getItems);

  useEffect(() => {
    void outbox.init().then(() => outbox.process());
    const unsubNet = NetInfo.addEventListener((s) => {
      const isOnline = s.isConnected !== false && s.isInternetReachable !== false;
      setOnline(isOnline);
      if (isOnline) void outbox.wake();
    });
    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") void outbox.wake();
    });
    return () => {
      unsubNet();
      appSub.remove();
    };
  }, [outbox]);

  // One timer for the earliest backoff, re-armed whenever the queue changes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    void outbox.nextWake().then((at) => {
      if (cancelled || at === null) return;
      timer = setTimeout(() => void outbox.process(), Math.max(0, at - Date.now()) + 50);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [outbox, items]);

  return <OutboxContext.Provider value={{ outbox, online }}>{children}</OutboxContext.Provider>;
}

export function useOutbox(): { outbox: Outbox; items: OutboxItem[]; online: boolean } {
  const ctx = useContext(OutboxContext);
  if (!ctx) throw new Error("useOutbox must be used inside OutboxProvider (app/(app)/finance/_layout.tsx)");
  const items = useSyncExternalStore(ctx.outbox.subscribe, ctx.outbox.getItems, ctx.outbox.getItems);
  return { outbox: ctx.outbox, items, online: ctx.online };
}
