import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

import { useOutboxPump } from "@/lib/outbox/use-pump";

import type { Outbox } from "./runner";
import type { OutboxItem } from "./state";

type OutboxContextValue = { outbox: Outbox; online: boolean };

const OutboxContext = createContext<OutboxContextValue | null>(null);

/**
 * Keeps the outbox moving: sends on mount, whenever connectivity comes back,
 * whenever the app returns to the foreground, and when the next backoff
 * timer is due (src/lib/outbox/use-pump.ts). Mounted app-wide by
 * app/(app)/_layout.tsx (signed-in area).
 */
export function OutboxProvider({ outbox, children }: { outbox: Outbox; children: ReactNode }) {
  const items = useSyncExternalStore(outbox.subscribe, outbox.getItems, outbox.getItems);
  const online = useOutboxPump(outbox, items);
  return <OutboxContext.Provider value={{ outbox, online }}>{children}</OutboxContext.Provider>;
}

export function useOutbox(): { outbox: Outbox; items: OutboxItem[]; online: boolean } {
  const ctx = useContext(OutboxContext);
  if (!ctx) throw new Error("useOutbox must be used inside OutboxProvider (app/(app)/_layout.tsx)");
  const items = useSyncExternalStore(ctx.outbox.subscribe, ctx.outbox.getItems, ctx.outbox.getItems);
  return { outbox: ctx.outbox, items, online: ctx.online };
}

/** Online as the provider sees it; true outside one (e.g. a list rendered alone in a test). */
export function useOutboxOnline(): boolean {
  return useContext(OutboxContext)?.online ?? true;
}
