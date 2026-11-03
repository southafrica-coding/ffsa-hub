import NetInfo from "@react-native-community/netinfo";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";

import type { BookingsOutbox } from "./runner";
import type { QueueItem } from "./state";

type Ctx = { outbox: BookingsOutbox; online: boolean };

const BookingsOutboxContext = createContext<Ctx | null>(null);

/**
 * Keeps the vehicle-check outbox moving: on mount, when connectivity comes
 * back, when the app returns to the front, and when the next backoff is due.
 * Mounted by app/(app)/bookings/_layout.tsx (this slice may not edit the
 * signed-in layout), so it sends while Bookings is open; anything left is
 * picked up the next time Bookings opens. Moving it next to the finance
 * OutboxProvider in app/(app)/_layout.tsx is a one-line follow-up.
 */
export function BookingsOutboxProvider({ outbox, children }: { outbox: BookingsOutbox; children: ReactNode }) {
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

  return <BookingsOutboxContext.Provider value={{ outbox, online }}>{children}</BookingsOutboxContext.Provider>;
}

export function useBookingsOutbox(): { outbox: BookingsOutbox; items: QueueItem[]; online: boolean } {
  const ctx = useContext(BookingsOutboxContext);
  if (!ctx) throw new Error("useBookingsOutbox must be used inside BookingsOutboxProvider (app/(app)/bookings/_layout.tsx)");
  const items = useSyncExternalStore(ctx.outbox.subscribe, ctx.outbox.getItems, ctx.outbox.getItems);
  return { outbox: ctx.outbox, items, online: ctx.online };
}
