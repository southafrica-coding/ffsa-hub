// ────────────────────────────────────────────────────────────
// GET /api/notifications payload (the phone app's "needs you" feed)
// ────────────────────────────────────────────────────────────
// The dashboard renders AppNotification as-is. The app gets the same items
// (same stable keys, same order: unread first, newest first) in a shape that
// doesn't depend on server-formatted text like "2h ago":
//
//   { items: [{ key, kind, title, body, href, read, createdAt }], unreadCount }
//
// `createdAt` is an ISO time, or null when the item has no real time. Some
// providers use `ts` only as a sort key (insurance expiry sorts by days left,
// which can be in the future); those have an empty `when`, so `when` decides.
// ────────────────────────────────────────────────────────────

import type { AppNotification } from "@/services/notifications";

export type FeedItem = {
  key: string;
  kind: AppNotification["kind"];
  title: string;
  body: string;
  /** Path on the website, e.g. "/bookings/requests". */
  href: string;
  read: boolean;
  createdAt: string | null;
};

export type FeedPayload = { items: FeedItem[]; unreadCount: number };

export function toFeedItem(n: AppNotification): FeedItem {
  const hasTime = n.when !== "" && n.ts > 0;
  return {
    key: n.key,
    kind: n.kind,
    title: n.title,
    body: n.body,
    href: n.href,
    read: n.read,
    createdAt: hasTime ? new Date(n.ts).toISOString() : null,
  };
}

export function toFeedPayload(feed: {
  notifications: AppNotification[];
  unreadCount: number;
}): FeedPayload {
  return {
    items: feed.notifications.map(toFeedItem),
    unreadCount: feed.unreadCount,
  };
}
