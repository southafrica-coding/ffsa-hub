import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

import { useOutboxPump } from "@/lib/outbox/use-pump";

import type { BookingsOutbox } from "./runner";
import type { QueueItem } from "./state";

type Ctx = { outbox: BookingsOutbox; online: boolean };

const BookingsOutboxContext = createContext<Ctx | null>(null);

/**
 * Keeps the vehicle-check outbox moving: on mount, when connectivity comes
 * back, when the app returns to the front, and when the next backoff is due
 * (src/lib/outbox/use-pump.ts). Mounted by app/(app)/bookings/_layout.tsx,
 * so it sends while Bookings is open; anything left is picked up the next
 * time Bookings opens. Moving it next to the finance OutboxProvider in
 * app/(app)/_layout.tsx is a one-line follow-up.
 */
export function BookingsOutboxProvider({ outbox, children }: { outbox: BookingsOutbox; children: ReactNode }) {
  const items = useSyncExternalStore(outbox.subscribe, outbox.getItems, outbox.getItems);
  const online = useOutboxPump(outbox, items);
  return <BookingsOutboxContext.Provider value={{ outbox, online }}>{children}</BookingsOutboxContext.Provider>;
}

export function useBookingsOutbox(): { outbox: BookingsOutbox; items: QueueItem[]; online: boolean } {
  const ctx = useContext(BookingsOutboxContext);
  if (!ctx) throw new Error("useBookingsOutbox must be used inside BookingsOutboxProvider (app/(app)/bookings/_layout.tsx)");
  const items = useSyncExternalStore(ctx.outbox.subscribe, ctx.outbox.getItems, ctx.outbox.getItems);
  return { outbox: ctx.outbox, items, online: ctx.online };
}
