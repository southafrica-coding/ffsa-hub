// Tab badges: a tiny shared store, so a screen can put a count on its own
// tab (Home shows unread notifications). Any slice may call setTabBadge for
// its tab id; 0 hides the badge.

import { useSyncExternalStore } from "react";

import type { TabId } from "./tabs";

const counts = new Map<TabId, number>();
const listeners = new Set<() => void>();

export function setTabBadge(tab: TabId, count: number) {
  const next = Math.max(0, Math.floor(count) || 0);
  if ((counts.get(tab) ?? 0) === next) return;
  counts.set(tab, next);
  for (const l of listeners) l();
}

export function getTabBadge(tab: TabId): number {
  return counts.get(tab) ?? 0;
}

export function useTabBadge(tab: TabId): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => getTabBadge(tab),
  );
}

/** Badge text: never wider than "99+". */
export function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}
