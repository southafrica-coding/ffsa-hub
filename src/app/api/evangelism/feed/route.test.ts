import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u" } as { id: string } | null,
  access: { view: true, submit: false, publish: false },
  feed: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
  }),
}));
vi.mock("@/lib/auth/check-evangelism-access", () => ({
  getEvangelismAccess: async () => h.access,
}));
vi.mock("@/lib/evangelism/signed-media", () => ({
  signTestimonyMedia: async () => new Map(),
  loadAuthorNames: async () => new Map(),
}));
vi.mock("@/services/evangelism", () => ({
  STATS_ROW_CAP: 5000,
  listPublishedFeed: async () => ({ data: h.feed, error: null }),
  listPublishedForStats: async () => ({ data: [], error: null }),
}));

import { GET } from "./route";

beforeEach(() => {
  h.user = { id: "u" };
  h.access = { view: true, submit: false, publish: false };
  h.feed = [
    {
      id: "new",
      author_user_id: "a",
      title: "Newer",
      body: "A story long enough to be a testimony for the people who were there that afternoon.",
      occurred_on: "2026-11-06",
      location_label: "Durban base",
      people_reached: 2,
      decisions: 0,
      outcome: "conversation",
      consent_to_share: true,
      status: "published",
      published_at: "2026-11-06T12:00:00.000Z",
      published_by: "a",
      withheld_reason: "keep this private",
      created_at: "2026-11-06T12:00:00.000Z",
      updated_at: "2026-11-06T12:00:00.000Z",
      evangelism_media: [],
    },
    {
      id: "old",
      author_user_id: "a",
      title: "Older",
      body: "An earlier story long enough to be a testimony for the people who were there that afternoon.",
      occurred_on: "2026-11-05",
      location_label: "Durban base",
      people_reached: 1,
      decisions: 0,
      outcome: "prayer",
      consent_to_share: true,
      status: "published",
      published_at: "2026-11-05T12:00:00.000Z",
      published_by: "a",
      withheld_reason: null,
      created_at: "2026-11-05T12:00:00.000Z",
      updated_at: "2026-11-05T12:00:00.000Z",
      evangelism_media: [],
    },
  ];
});

describe("GET /api/evangelism/feed", () => {
  it("is a poll payload, newest page flipped into chronological order, with no private notes", async () => {
    const res = await GET(new Request("http://x/api/evangelism/feed"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.transport).toBe("poll");
    expect(body.poll_after_seconds).toBe(15);
    expect(body.testimonies.map((row: { id: string }) => row.id)).toEqual(["old", "new"]);
    expect(body.cursor).toBe("2026-11-06T12:00:00.000Z");
    expect(body.testimonies[0].withheld_reason).toBeUndefined();
    expect(body.stats.range).toBe("month");
  });

  it("rejects a bad cursor and a viewer with no access", async () => {
    expect((await GET(new Request("http://x/api/evangelism/feed?since=yesterday"))).status).toBe(400);
    h.access = { view: false, submit: false, publish: false };
    expect((await GET(new Request("http://x/api/evangelism/feed"))).status).toBe(403);
    h.user = null;
    expect((await GET(new Request("http://x/api/evangelism/feed"))).status).toBe(401);
  });
});
