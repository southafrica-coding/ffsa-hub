// Pure helpers for the Home feed (unit-tested in __tests__/feed-logic.test.ts).

import type { FeedItem } from "./api";

// ── Time ────────────────────────────────────────────────────────────────────

/** "just now", "5m ago", "3h ago", "2d ago", "4w ago"; null if no/invalid time. */
export function timeAgo(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  const m = Math.floor(Math.max(0, now - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

// ── Grouping ────────────────────────────────────────────────────────────────

/** "Needs you" = unread, "Earlier" = read. Server order is kept within each. */
export function groupFeed(items: FeedItem[]): { needsYou: FeedItem[]; earlier: FeedItem[] } {
  return {
    needsYou: items.filter((i) => !i.read),
    earlier: items.filter((i) => i.read),
  };
}

export function unreadCount(items: FeedItem[]): number {
  return items.reduce((n, i) => n + (i.read ? 0 : 1), 0);
}

export function markKeysRead(items: FeedItem[], keys: Iterable<string>): FeedItem[] {
  const set = new Set(keys);
  return items.map((i) => (set.has(i.key) && !i.read ? { ...i, read: true } : i));
}

// ── Where an item goes ──────────────────────────────────────────────────────

export type Target = { kind: "app"; path: string } | { kind: "web"; path: string } | { kind: "none" };

// Website paths that have an in-app screen. Longest prefix wins; the rest of
// the path is dropped, except that `withId` carries the next path segment (an
// id) over to the app path. `app: null` keeps a sub-path on the website.
// Grow this table as slices add screens.
const IN_APP: { web: string; app: string | null; withId?: true }[] = [
  { web: "/my-finance", app: "/finance" },
  { web: "/my-events", app: "/tickets" },
  { web: "/profile", app: "/me" },
  { web: "/dashboard", app: "/" },
  { web: "/bookings", app: "/bookings" },
  { web: "/bookings/requests", app: "/bookings/approvals" },
  { web: "/bookings/spaces/requests", app: "/bookings/approvals" },
  { web: "/bookings/vehicles/requests", app: "/bookings/approvals" },
  { web: "/my-schools", app: "/schools", withId: true },
  { web: "/my-schools/apply", app: null },
  { web: "/my-attendance", app: "/schools/attendance" },
  { web: "/my-history", app: "/history" },
  { web: "/okrs", app: "/okrs", withId: true },
  { web: "/okrs/cycles", app: null },
];

function matchesPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}

/** Decide whether a feed item's website href opens in the app or the browser. */
export function resolveTarget(href: string | null): Target {
  if (!href || !href.startsWith("/") || href.startsWith("//")) return { kind: "none" };
  const hit = IN_APP.filter((r) => matchesPrefix(href, r.web)).sort((a, b) => b.web.length - a.web.length)[0];
  if (!hit || hit.app === null) return { kind: "web", path: href };
  const id = hit.withId ? /^\/([A-Za-z0-9-]+)(?:[/?#]|$)/.exec(href.slice(hit.web.length))?.[1] : undefined;
  return { kind: "app", path: id ? `${hit.app}/${id}` : hit.app };
}
