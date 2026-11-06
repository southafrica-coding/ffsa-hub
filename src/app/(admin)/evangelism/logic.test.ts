import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyFeed,
  classifyFile,
  emptyStory,
  expiryFromPayload,
  feedUrl,
  johannesburgDate,
  mediaLimitMessage,
  mergeTestimonies,
  nextReplaceDelay,
  pruneExpiredStories,
  readCanPublish,
  removedIdsFromFeed,
  stripTvAuthors,
  testimoniesUrl,
  tvStoryLine,
  validateStory,
  validateWithheldReason,
  visibleIdsForPoll,
  waitingCopy,
  MEDIA_TTL_MS,
  REPLACE_RETRY_MS,
  FEED_URL_REFRESH_MS,
  type Testimony,
} from "./logic";

function story(over: Partial<ReturnType<typeof emptyStory>> = {}) {
  return {
    ...emptyStory("2026-11-06"),
    title: "Evening on the beach",
    body: "We spoke with a group leaving the water and prayed with two of them.",
    location_label: "Durban beach",
    people_reached: "6",
    decisions: "1",
    outcome: "prayer" as const,
    consent_to_share: true,
    ...over,
  };
}

function row(id: string, title: string): Testimony {
  return {
    id,
    title,
    body: "A story long enough to be a testimony for the people who were there.",
    occurred_on: "2026-11-06",
    location_label: "Durban base",
    people_reached: 1,
    decisions: 0,
    outcome: "conversation",
    consent_to_share: true,
    status: "published",
    published_at: "2026-11-06T12:00:00.000Z",
    author_user_id: "a",
    author_name: "Thandi M",
    created_at: "2026-11-06T12:00:00.000Z",
    updated_at: "2026-11-06T12:00:00.000Z",
    media: [],
  };
}

describe("evangelism story validation", () => {
  it("accepts a complete story and keeps counts as integers", () => {
    const parsed = validateStory(story(), { intent: "submit", today: "2026-11-06" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.people_reached).toBe(6);
    expect(parsed.value.status).toBe("submitted");
  });

  it("lets a draft through without consent", () => {
    const parsed = validateStory(story({ consent_to_share: false }), {
      intent: "draft",
      today: "2026-11-06",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.status).toBe("draft");
  });

  it("blocks submit without consent, a future day, and decisions above people reached", () => {
    const parsed = validateStory(
      story({
        consent_to_share: false,
        occurred_on: "2026-11-07",
        people_reached: "1",
        decisions: "2",
        title: "No",
      }),
      { intent: "submit", today: "2026-11-06" }
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const fields = parsed.errors.map((error) => error.field);
    expect(fields).toEqual(
      expect.arrayContaining(["title", "occurred_on", "decisions", "consent_to_share"])
    );
  });

  it("requires a withhold reason and caps it at 500 characters", () => {
    expect(validateWithheldReason("  ")?.field).toBe("withheld_reason");
    expect(validateWithheldReason("x".repeat(501))?.message).toMatch(/500/);
    expect(validateWithheldReason("Names of minors in the video.")).toBeNull();
  });
});

describe("evangelism files and feed helpers", () => {
  it("uses the Johannesburg calendar, including just after midnight there", () => {
    expect(johannesburgDate(new Date("2026-11-06T22:30:00.000Z"))).toBe("2026-11-07");
    expect(johannesburgDate(new Date("2026-11-06T21:30:00.000Z"))).toBe("2026-11-06");
  });

  it("classifies photos and videos and rejects svg and oversized files", () => {
    expect(classifyFile({ name: "a.heic", type: "", size: 1000 })).toEqual({
      ok: true,
      kind: "photo",
      contentType: "image/heic",
    });
    expect(classifyFile({ name: "clip.mov", type: "video/quicktime", size: 10 }).ok).toBe(true);
    expect(classifyFile({ name: "mark.svg", type: "image/svg+xml", size: 10 }).ok).toBe(false);
    expect(classifyFile({ name: "big.jpg", type: "image/jpeg", size: 16 * 1024 * 1024 }).ok).toBe(false);
  });

  it("caps attachments at 8 files and 4 videos", () => {
    const videos = Array.from({ length: 5 }, () => ({ kind: "video" as const }));
    expect(mediaLimitMessage(videos)).toMatch(/4 videos/);
    const mixed = [
      ...Array.from({ length: 5 }, () => ({ kind: "photo" as const })),
      ...Array.from({ length: 4 }, () => ({ kind: "video" as const })),
    ];
    expect(mediaLimitMessage(mixed)).toMatch(/8 files/);
  });

  it("builds the feed and list URLs the API documents", () => {
    const visible = "33333333-3333-4333-8333-333333333333";
    expect(feedUrl(null)).toBe("/api/evangelism/feed");
    expect(feedUrl("not-a-date")).toBe("/api/evangelism/feed");
    expect(feedUrl("2026-11-06T12:00:00.000Z")).toBe(
      "/api/evangelism/feed?since=2026-11-06T12%3A00%3A00.000Z"
    );
    expect(feedUrl("2026-11-06T12:00:00.000Z", [visible, "not-a-uuid"])).toBe(
      `/api/evangelism/feed?since=2026-11-06T12%3A00%3A00.000Z&visible=${visible}`
    );
    expect(testimoniesUrl({ status: "submitted", limit: 100 })).toBe(
      "/api/evangelism/testimonies?status=submitted&limit=100"
    );
    expect(testimoniesUrl({ mine: true })).toBe("/api/evangelism/testimonies?mine=1");
  });

  it("appends new feed rows in order and replaces the window on a refresh", () => {
    const older = row("old", "Older");
    const newer = row("new", "Newer");
    expect(mergeTestimonies([older], [newer], "append").map((item) => item.id)).toEqual(["old", "new"]);
    const refreshed = { ...newer, title: "Newer title" };
    expect(mergeTestimonies([older, newer], [refreshed], "append")[1].title).toBe("Newer title");
    expect(mergeTestimonies([older], [newer], "replace")).toEqual([newer]);
  });

  it("drops withheld and deleted ids on an append, after new rows are added", () => {
    const older = row("old", "Older");
    const newer = row("new", "Newer");
    const kept = applyFeed([older, newer], {
      mode: "append",
      testimonies: [],
      removedIds: ["old", "missing"],
    });
    expect(kept.map((item) => item.id)).toEqual(["new"]);

    const returned = applyFeed([older], {
      mode: "append",
      testimonies: [{ ...older, title: "Still here" }],
      removedIds: ["old"],
    });
    expect(returned).toEqual([]);
  });

  it("refreshes a story that stayed on screen, then still honours a removal", () => {
    const older = row("old", "Older");
    older.media = [
      { id: "m", kind: "photo", content_type: "image/jpeg", size_bytes: 10, sort_order: 0, url: "old-url" },
    ];
    const refreshed = {
      ...older,
      media: [{ ...older.media[0], url: "new-url" }],
    };
    const updated = applyFeed([older], {
      mode: "append",
      testimonies: [],
      refreshed: [refreshed],
      removedIds: [],
    });
    expect(updated[0].media[0].url).toBe("new-url");
    expect(
      applyFeed(updated, { mode: "append", testimonies: [], refreshed: [refreshed], removedIds: ["old"] })
    ).toEqual([]);
  });

  it("reads only top-level can_publish and ignores a successful list", () => {
    expect(readCanPublish({ can_publish: true, testimonies: [] })).toBe(true);
    expect(readCanPublish({ can_publish: false, testimonies: [{ id: "x" }] })).toBe(false);
    expect(readCanPublish({ testimonies: [{ withheld_reason: "secret", title: "A story" }] })).toBe(false);
    expect(readCanPublish({ testimonies: [{ can_publish: true }] })).toBe(false);
    expect(readCanPublish({ access: { publish: true }, testimonies: [] })).toBe(false);
    expect(readCanPublish({ testimony: { can_publish: true } })).toBe(false);
    expect(readCanPublish({})).toBe(false);
  });

  it("drops feed removed_ids on an append, and an empty first paint removes nothing", () => {
    const older = row("old", "Older");
    const newer = row("new", "Newer");
    expect(removedIdsFromFeed({ removed_ids: [] })).toEqual([]);
    expect(removedIdsFromFeed({})).toEqual([]);
    expect(removedIdsFromFeed({ removed_ids: ["old", 3, ""] })).toEqual(["old"]);
    expect(
      applyFeed([older, newer], { mode: "append", testimonies: [], removedIds: removedIdsFromFeed({ removed_ids: [] }) }).map(
        (item) => item.id
      )
    ).toEqual(["old", "new"]);
    expect(
      applyFeed([older, newer], {
        mode: "append",
        testimonies: [],
        removedIds: removedIdsFromFeed({ removed_ids: ["old", "gone"] }),
      }).map((item) => item.id)
    ).toEqual(["new"]);
  });

  it("leaves names off the TV line and retries a failed replace on the poll interval", () => {
    const named = row("old", "Older");
    const stripped = stripTvAuthors([named])[0];
    expect(stripped.author_name).toBeNull();
    expect(stripped.author_user_id).toBe("");
    expect(tvStoryLine(named)).toBe("6 Nov 2026 · Durban base");
    expect(tvStoryLine(named)).not.toContain("Thandi");
    expect(tvStoryLine(named)).not.toContain("team member");
    expect(nextReplaceDelay(true)).toBe(REPLACE_RETRY_MS);
    expect(nextReplaceDelay(false)).toBe(FEED_URL_REFRESH_MS);
  });

  it("drops a story once its signed URL may have expired", () => {
    const older = row("old", "Older");
    const now = Date.parse("2026-11-06T12:10:00.000Z");
    const fresh = expiryFromPayload("2026-11-06T12:20:00.000Z");
    const stale = expiryFromPayload("2026-11-06T12:00:00.000Z");
    expect(fresh - Date.parse("2026-11-06T12:10:00.000Z")).toBe(10 * 60 * 1000);
    expect(expiryFromPayload(undefined, now) - now).toBe(MEDIA_TTL_MS);
    const expiry = new Map<string, number>([["old", stale]]);
    expect(pruneExpiredStories([older], expiry, now)).toEqual([]);
    expiry.set("old", fresh);
    expect(pruneExpiredStories([older], expiry, now)).toEqual([older]);
    expect(pruneExpiredStories([older], new Map(), now)).toEqual([]);
  });

  it("sends at most 40 visible uuids", () => {
    const ids = Array.from({ length: 45 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    );
    const first = visibleIdsForPoll(ids, 0);
    expect(first.ids).toHaveLength(40);
    expect(first.nextOffset).toBe(40);
    const second = visibleIdsForPoll(ids, first.nextOffset);
    expect(second.ids[0]).toBe(ids[40]);
    expect(visibleIdsForPoll(["nope", ids[0]]).ids).toEqual([ids[0]]);
  });

  it("does not redirect the evangelism pages while the module stays hidden", () => {
    for (const name of ["page.tsx", "queue/page.tsx", "screen/page.tsx"]) {
      const source = readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
      expect(source).not.toContain("isHiddenFromNav");
      expect(source).not.toContain('redirect("/dashboard")');
    }
  });

  it("only writes the yellow-band sentence when stories are actually waiting", () => {
    expect(waitingCopy(0)).toBeNull();
    expect(waitingCopy(1)).toBe("1 story is waiting to be published");
    expect(waitingCopy(4)).toBe("4 stories are waiting to be published");
    expect(waitingCopy(100)).toMatch(/At least 100/);
  });
});
