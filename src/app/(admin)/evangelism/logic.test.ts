import { describe, expect, it } from "vitest";
import {
  classifyFile,
  emptyStory,
  feedUrl,
  johannesburgDate,
  mediaLimitMessage,
  mergeTestimonies,
  testimoniesUrl,
  validateStory,
  validateWithheldReason,
  waitingCopy,
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
    expect(feedUrl(null)).toBe("/api/evangelism/feed");
    expect(feedUrl("not-a-date")).toBe("/api/evangelism/feed");
    expect(feedUrl("2026-11-06T12:00:00.000Z")).toBe(
      "/api/evangelism/feed?since=2026-11-06T12%3A00%3A00.000Z"
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

  it("only writes the yellow-band sentence when stories are actually waiting", () => {
    expect(waitingCopy(0)).toBeNull();
    expect(waitingCopy(1)).toBe("1 story is waiting to be published");
    expect(waitingCopy(4)).toBe("4 stories are waiting to be published");
    expect(waitingCopy(100)).toMatch(/At least 100/);
  });
});
