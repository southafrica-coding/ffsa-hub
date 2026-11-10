import { afterEach, describe, expect, it, vi } from "vitest";
import type { PresentedTestimony } from "@/services/evangelism";
import {
  TESTIMONY_NETWORK_ERROR,
  applyStoryTakedown,
  deleteStory,
  messageFromResponse,
  patchStory,
  storyListSignature,
  testimonyFailureMessage,
} from "./story-client";

function story(over: Partial<PresentedTestimony> = {}): PresentedTestimony {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    title: "A conversation at the taxi rank",
    body: "We spoke with a man waiting for a taxi and prayed with him before the kombi came.",
    occurred_on: "2026-11-01",
    location_label: "Durban",
    staff_ministry_id: null,
    ministry_name: null,
    people_reached: 4,
    decisions: 1,
    outcome: "decision",
    consent_to_share: true,
    status: "published",
    published_at: "2026-11-02T08:00:00Z",
    updated_at: "2026-11-02T08:00:00Z",
    is_mine: true,
    photo: null,
    ...over,
  };
}

describe("testimonyFailureMessage", () => {
  it("prefers the server's sentence", () => {
    expect(testimonyFailureMessage(403, "Only publishers can publish or withhold.")).toBe(
      "Only publishers can publish or withhold.",
    );
    expect(testimonyFailureMessage(409, "This story has been reviewed and can no longer be edited.")).toBe(
      "This story has been reviewed and can no longer be edited.",
    );
  });

  it("maps the moderator-withheld database error to a friendly sentence", () => {
    expect(
      testimonyFailureMessage(403, "A moderator withheld this story; only a moderator can republish it"),
    ).toBe("A moderator withheld this story. Only a moderator can publish it again or change the reason.");
  });

  it("fills in 403, 404, 409, and a network-shaped fallback", () => {
    expect(testimonyFailureMessage(403, "")).toBe("You don't have permission to do that.");
    expect(testimonyFailureMessage(404, "  ")).toBe("That story isn't here anymore.");
    expect(testimonyFailureMessage(409, null)).toMatch(/isn't available/);
    expect(testimonyFailureMessage(500, "")).toMatch(/Try again/);
    expect(TESTIMONY_NETWORK_ERROR).toMatch(/connection/i);
  });
});

describe("messageFromResponse", () => {
  it("reads a JSON error and falls back when the body isn't JSON", async () => {
    const json = new Response(JSON.stringify({ error: "Story not found." }), { status: 404 });
    expect(await messageFromResponse(json)).toBe("Story not found.");
    const empty = new Response("nope", { status: 409 });
    expect(await messageFromResponse(empty)).toMatch(/isn't available/);
    const forbidden = new Response("{}", { status: 403 });
    expect(await messageFromResponse(forbidden)).toBe("You don't have permission to do that.");
  });
});

describe("patchStory and deleteStory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the updated story", async () => {
    const testimony = story({ status: "withheld", withheld_reason: "Names a minor" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ testimony }), { status: 200 })),
    );
    const result = await patchStory(testimony.id, { status: "withheld", reason: "Names a minor" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.testimony.status).toBe("withheld");
    expect(fetch).toHaveBeenCalledWith(
      `/api/evangelism/testimonies/${testimony.id}`,
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("surfaces 403, 404, and 409 from the server", async () => {
    for (const [status, error] of [
      [403, "Only publishers can publish or withhold."],
      [404, "Story not found."],
      [409, "Only a story that was submitted for review can be published."],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error }), { status })));
      const result = await patchStory("id", { status: "published" });
      expect(result).toEqual({ ok: false, message: error });
    }
  });

  it("turns a network failure into a connection message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await patchStory("id", { status: "withheld" })).toEqual({ ok: false, message: TESTIMONY_NETWORK_ERROR });
    expect(await deleteStory("id")).toEqual({ ok: false, message: TESTIMONY_NETWORK_ERROR });
  });

  it("reports a failed delete with the server's message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Only drafts can be deleted by their author." }), { status: 403 })),
    );
    expect(await deleteStory("id")).toEqual({ ok: false, message: "Only drafts can be deleted by their author." });
  });
});

describe("applyStoryTakedown", () => {
  it("removes a deleted story from the feed and from My stories", () => {
    const mine = story({ status: "draft" });
    const other = story({ id: "44444444-4444-4444-8444-444444444444", is_mine: false });
    const next = applyStoryTakedown({ published: [other], mine: [mine, other] }, { type: "delete", id: mine.id });
    expect(next.mine?.map((item) => item.id)).toEqual([other.id]);
    const fromFeed = applyStoryTakedown({ published: [other], mine: [other] }, { type: "delete", id: other.id });
    expect(fromFeed.published).toEqual([]);
    expect(fromFeed.mine).toEqual([]);
  });

  it("drops a withheld story from the feed and puts the author's copy in My stories", () => {
    const published = story();
    const withheld = story({ status: "withheld", withheld_reason: "Not for the feed", published_at: null });
    const next = applyStoryTakedown({ published: [published], mine: [published] }, { type: "withhold", testimony: withheld });
    expect(next.published).toEqual([]);
    expect(next.mine?.[0]).toMatchObject({ id: published.id, status: "withheld", withheld_reason: "Not for the feed" });
  });

  it("does not add someone else's withheld story to My stories", () => {
    const published = story({ is_mine: false });
    const withheld = { ...published, status: "withheld" as const };
    const next = applyStoryTakedown(
      { published: [published], mine: [] },
      { type: "withhold", testimony: withheld },
    );
    expect(next.published).toEqual([]);
    expect(next.mine).toEqual([]);
  });

  it("puts a republished story back on the feed and updates My stories", () => {
    const withheld = story({ status: "withheld", published_at: null });
    const again = story({ status: "published" });
    const next = applyStoryTakedown({ published: [], mine: [withheld] }, { type: "republish", testimony: again });
    expect(next.published.map((item) => item.id)).toEqual([again.id]);
    expect(next.mine?.[0].status).toBe("published");
  });
});

describe("storyListSignature", () => {
  it("ignores array identity and changes when status or the reason changes", () => {
    const a = story();
    expect(storyListSignature([a])).toBe(storyListSignature([{ ...a }]));
    expect(storyListSignature([a])).not.toBe(storyListSignature([story({ status: "withheld", withheld_reason: "x" })]));
  });
});
