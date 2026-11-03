import { describe, expect, it } from "vitest";
import { toFeedItem, toFeedPayload } from "./notifications-feed";
import type { AppNotification } from "@/services/notifications";

const base: AppNotification = {
  key: "booking:1",
  kind: "booking",
  title: "New booking request",
  body: "Hall",
  href: "/bookings/requests",
  when: "2h ago",
  ts: Date.parse("2026-11-03T08:00:00.000Z"),
  read: false,
};

describe("toFeedItem", () => {
  it("keeps the stable key and turns ts into an ISO createdAt", () => {
    expect(toFeedItem(base)).toEqual({
      key: "booking:1",
      kind: "booking",
      title: "New booking request",
      body: "Hall",
      href: "/bookings/requests",
      read: false,
      createdAt: "2026-11-03T08:00:00.000Z",
    });
  });

  it("no time when the provider has none (ts 0)", () => {
    expect(toFeedItem({ ...base, when: "", ts: 0 }).createdAt).toBeNull();
  });

  it("no time when ts is only a sort key (insurance: empty `when`, ts may be in the future)", () => {
    const sortOnly = { ...base, kind: "insurance" as const, when: "", ts: Date.now() + 7 * 86_400_000 };
    expect(toFeedItem(sortOnly).createdAt).toBeNull();
  });
});

describe("toFeedPayload", () => {
  it("keeps order and the unread count", () => {
    const read = { ...base, key: "booking:2", read: true };
    expect(toFeedPayload({ notifications: [base, read], unreadCount: 1 })).toMatchObject({
      items: [{ key: "booking:1" }, { key: "booking:2", read: true }],
      unreadCount: 1,
    });
  });
});
