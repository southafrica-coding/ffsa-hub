import AsyncStorage from "@react-native-async-storage/async-storage";

import { feedSchema, markRead, type FeedItem } from "../api";
import { clearFeedCaches, readFeedCache, writeFeedCache } from "../feed-cache";
import { groupFeed, markKeysRead, resolveTarget, timeAgo, unreadCount } from "../feed-logic";

const item = (key: string, read = false, extra: Partial<FeedItem> = {}): FeedItem => ({
  key,
  kind: "booking",
  title: `Title ${key}`,
  body: "",
  href: "/bookings",
  read,
  createdAt: null,
  ...extra,
});

describe("timeAgo", () => {
  const now = Date.parse("2026-11-03T12:00:00.000Z");
  it.each([
    ["2026-11-03T11:59:40.000Z", "just now"],
    ["2026-11-03T11:55:00.000Z", "5m ago"],
    ["2026-11-03T09:00:00.000Z", "3h ago"],
    ["2026-11-01T12:00:00.000Z", "2d ago"],
    ["2026-10-06T12:00:00.000Z", "4w ago"],
  ])("%s -> %s", (iso, label) => {
    expect(timeAgo(iso, now)).toBe(label);
  });

  it("no time, bad time, or a future time", () => {
    expect(timeAgo(null, now)).toBeNull();
    expect(timeAgo("not a date", now)).toBeNull();
    expect(timeAgo("2026-11-04T12:00:00.000Z", now)).toBe("just now");
  });
});

describe("grouping and read state", () => {
  const items = [item("a"), item("b", true), item("c")];

  it("Needs you = unread, Earlier = read, server order kept", () => {
    const g = groupFeed(items);
    expect(g.needsYou.map((i) => i.key)).toEqual(["a", "c"]);
    expect(g.earlier.map((i) => i.key)).toEqual(["b"]);
    expect(unreadCount(items)).toBe(2);
  });

  it("markKeysRead flips only the given keys and doesn't mutate", () => {
    const next = markKeysRead(items, ["a", "missing"]);
    expect(next.map((i) => i.read)).toEqual([true, true, false]);
    expect(items[0].read).toBe(false);
  });
});

describe("resolveTarget", () => {
  it("in-app screens for pages the app has", () => {
    expect(resolveTarget("/my-finance")).toEqual({ kind: "app", path: "/finance" });
    expect(resolveTarget("/my-finance/outreach/t1")).toEqual({ kind: "app", path: "/finance" });
    expect(resolveTarget("/my-events?tab=tickets")).toEqual({ kind: "app", path: "/tickets" });
    expect(resolveTarget("/profile")).toEqual({ kind: "app", path: "/me" });
  });

  it("booking feed items open the Bookings screens", () => {
    expect(resolveTarget("/bookings")).toEqual({ kind: "app", path: "/bookings" });
    expect(resolveTarget("/bookings/requests")).toEqual({ kind: "app", path: "/bookings/approvals" });
    expect(resolveTarget("/bookings/spaces/requests")).toEqual({ kind: "app", path: "/bookings/approvals" });
    expect(resolveTarget("/bookings/vehicles/requests")).toEqual({ kind: "app", path: "/bookings/approvals" });
    expect(resolveTarget("/bookings/spaces/abc")).toEqual({ kind: "app", path: "/bookings" });
  });

  it("school items open My Schools; the apply form stays on the website", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(resolveTarget("/my-schools")).toEqual({ kind: "app", path: "/schools" });
    expect(resolveTarget("/my-schools?tab=x")).toEqual({ kind: "app", path: "/schools" });
    expect(resolveTarget(`/my-schools/${id}`)).toEqual({ kind: "app", path: `/schools/${id}` });
    expect(resolveTarget(`/my-schools/${id}?from=email`)).toEqual({ kind: "app", path: `/schools/${id}` });
    expect(resolveTarget("/my-attendance")).toEqual({ kind: "app", path: "/schools/attendance" });
    expect(resolveTarget("/my-schools/apply/p1")).toEqual({ kind: "web", path: "/my-schools/apply/p1" });
    expect(resolveTarget("/my-schools-old")).toEqual({ kind: "web", path: "/my-schools-old" });
  });

  it("OKRs: the wall and one group open in the app; the cycles manager stays on the website", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(resolveTarget("/okrs")).toEqual({ kind: "app", path: "/okrs" });
    expect(resolveTarget("/okrs?cycle=2025")).toEqual({ kind: "app", path: "/okrs" });
    expect(resolveTarget(`/okrs/${id}`)).toEqual({ kind: "app", path: `/okrs/${id}` });
    expect(resolveTarget(`/okrs/${id}?cycle=2026`)).toEqual({ kind: "app", path: `/okrs/${id}` });
    expect(resolveTarget("/okrs/cycles")).toEqual({ kind: "web", path: "/okrs/cycles" });
    expect(resolveTarget("/okrs-archive")).toEqual({ kind: "web", path: "/okrs-archive" });
  });

  it("history items open My History", () => {
    expect(resolveTarget("/my-history")).toEqual({ kind: "app", path: "/history" });
    expect(resolveTarget("/my-history?from=email")).toEqual({ kind: "app", path: "/history" });
    expect(resolveTarget("/my-history/anything")).toEqual({ kind: "app", path: "/history" });
    expect(resolveTarget("/my-history-old")).toEqual({ kind: "web", path: "/my-history-old" });
  });

  it("ministry items open Ministries; a staff profile stays on the website", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(resolveTarget("/ministry")).toEqual({ kind: "app", path: "/ministries" });
    expect(resolveTarget("/ministry?tab=x")).toEqual({ kind: "app", path: "/ministries" });
    expect(resolveTarget(`/ministry/${id}`)).toEqual({ kind: "app", path: `/ministries/${id}` });
    expect(resolveTarget(`/ministry/${id}?from=email`)).toEqual({ kind: "app", path: `/ministries/${id}` });
    expect(resolveTarget("/ministry/staff/u1")).toEqual({ kind: "web", path: "/ministry/staff/u1" });
    expect(resolveTarget("/ministry-old")).toEqual({ kind: "web", path: "/ministry-old" });
  });

  it("staff decisions: the list and a school's staff_decision tab open in the app; other school tabs stay on the website", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(resolveTarget("/staff-decisions")).toEqual({ kind: "app", path: "/staff-decisions" });
    expect(resolveTarget("/staff-decisions?from=email")).toEqual({ kind: "app", path: "/staff-decisions" });
    expect(resolveTarget(`/schools/${id}?tab=staff_decision`)).toEqual({ kind: "app", path: `/staff-decisions/${id}` });
    expect(resolveTarget(`/schools/${id}?from=slack&tab=staff_decision`)).toEqual({ kind: "app", path: `/staff-decisions/${id}` });
    expect(resolveTarget(`/schools/${id}?tab=staff_decision_x`)).toEqual({ kind: "web", path: `/schools/${id}?tab=staff_decision_x` });
    expect(resolveTarget(`/schools/${id}?tab=arrival`)).toEqual({ kind: "web", path: `/schools/${id}?tab=arrival` });
    expect(resolveTarget(`/schools/${id}`)).toEqual({ kind: "web", path: `/schools/${id}` });
    expect(resolveTarget("/staff-decisions-old")).toEqual({ kind: "web", path: "/staff-decisions-old" });
  });

  it("the browser for everything else (today's feed items all go here)", () => {
    for (const href of ["/users?filter=pending", "/prayer-room?tab=practice", "/records-library/match-queue"]) {
      expect(resolveTarget(href)).toEqual({ kind: "web", path: href });
    }
  });

  it("doesn't match on a shared prefix that isn't a path segment", () => {
    expect(resolveTarget("/profiles-export")).toEqual({ kind: "web", path: "/profiles-export" });
  });

  it("nowhere for missing or off-site links", () => {
    expect(resolveTarget(null)).toEqual({ kind: "none" });
    expect(resolveTarget("https://evil.example/x")).toEqual({ kind: "none" });
    expect(resolveTarget("//evil.example/x")).toEqual({ kind: "none" });
  });
});

describe("feedSchema", () => {
  it("accepts the server contract and ignores extra fields", () => {
    const parsed = feedSchema.parse({
      items: [{ key: "booking:1", kind: "booking", title: "T", body: "B", href: "/b", read: false, createdAt: null, extra: 1 }],
      unreadCount: 1,
      somethingNew: true,
    });
    expect(parsed.items).toEqual([{ key: "booking:1", kind: "booking", title: "T", body: "B", href: "/b", read: false, createdAt: null }]);
  });

  it("drops a malformed item instead of failing the whole feed", () => {
    const parsed = feedSchema.parse({ items: [{ nope: true }, { key: "k", title: "ok" }] });
    expect(parsed.items).toEqual([{ key: "k", kind: "other", title: "ok", body: "", href: null, read: false, createdAt: null }]);
  });
});

describe("markRead", () => {
  it("posts keys in batches of 200 (the server's cap)", async () => {
    const fetch = jest.fn().mockResolvedValue({ ok: true });
    const keys = Array.from({ length: 450 }, (_, i) => `k${i}`);
    await markRead(fetch as never, keys);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0]).toEqual(["/api/notifications/read", { method: "POST", body: { keys: keys.slice(0, 200) } }]);
    expect(fetch.mock.calls[2][1].body.keys).toHaveLength(50);
  });
});

describe("feed cache", () => {
  beforeEach(() => AsyncStorage.clear());

  it("round-trips per user and never crosses users", async () => {
    await writeFeedCache("u1", [item("a")], new Date("2026-11-03T08:00:00.000Z"));
    expect(await readFeedCache("u1")).toEqual({ savedAt: "2026-11-03T08:00:00.000Z", items: [item("a")] });
    expect(await readFeedCache("u2")).toBeNull();
  });

  it("treats corrupt data as nothing saved", async () => {
    await AsyncStorage.setItem("ffsa:home-feed:v1:u1", "{not json");
    expect(await readFeedCache("u1")).toBeNull();
    await AsyncStorage.setItem("ffsa:home-feed:v1:u1", JSON.stringify({ savedAt: 1, items: "x" }));
    expect(await readFeedCache("u1")).toBeNull();
  });

  it("clearFeedCaches removes every saved feed but nothing else", async () => {
    await writeFeedCache("u1", [item("a")]);
    await writeFeedCache("u2", [item("b")]);
    await AsyncStorage.setItem("other-key", "keep");
    await clearFeedCaches();
    expect(await readFeedCache("u1")).toBeNull();
    expect(await readFeedCache("u2")).toBeNull();
    expect(await AsyncStorage.getItem("other-key")).toBe("keep");
  });
});
