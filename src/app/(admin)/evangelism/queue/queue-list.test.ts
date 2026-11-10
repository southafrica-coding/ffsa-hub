import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PresentedTestimony } from "@/services/evangelism";
import { WithheldQueue, afterWithheldSuccess, withheldCapNote, withoutStory } from "./queue-list";
import { WITHHELD_QUEUE_LIMIT, showWithheldQueue } from "./withheld-queue-rules";

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const moderator = { submit: true, publish: true, moderate: true, unscopedAdmin: false };
const publisher = { submit: true, publish: true, moderate: false, unscopedAdmin: false };

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
    status: "withheld",
    published_at: null,
    updated_at: "2026-11-02T08:00:00Z",
    is_mine: false,
    photo: null,
    withheld_reason: "Names a minor",
    ...over,
  };
}

describe("showWithheldQueue", () => {
  it("is only for moderators and unscoped admins", () => {
    expect(showWithheldQueue(moderator)).toBe(true);
    expect(showWithheldQueue({ ...publisher, unscopedAdmin: true })).toBe(true);
    expect(showWithheldQueue(publisher)).toBe(false);
    expect(showWithheldQueue({ submit: true, publish: false, moderate: false })).toBe(false);
  });
});

describe("withoutStory", () => {
  it("drops the story that was published or deleted", () => {
    const other = story({ id: "44444444-4444-4444-8444-444444444444" });
    expect(withoutStory([story(), other], story().id)).toEqual([other]);
  });
});

describe("withheldCapNote", () => {
  it("appears only once the list reaches the fetch limit", () => {
    expect(WITHHELD_QUEUE_LIMIT).toBe(100);
    expect(withheldCapNote(WITHHELD_QUEUE_LIMIT - 1)).toBeNull();
    expect(withheldCapNote(WITHHELD_QUEUE_LIMIT)).toBe(`Showing the first ${WITHHELD_QUEUE_LIMIT} withheld stories.`);
    expect(withheldCapNote(WITHHELD_QUEUE_LIMIT + 1)).toBe(`Showing the first ${WITHHELD_QUEUE_LIMIT} withheld stories.`);
  });
});

describe("afterWithheldSuccess", () => {
  it("updates the list and then refreshes server data", () => {
    const order: string[] = [];
    afterWithheldSuccess(
      () => order.push("done"),
      () => order.push("refresh"),
      "id",
    );
    expect(order).toEqual(["done", "refresh"]);
  });
});

describe("WithheldQueue", () => {
  it("shows the reason, Publish again, and Delete for a moderator", () => {
    const html = renderToStaticMarkup(createElement(WithheldQueue, { stories: [story()], access: moderator }));
    expect(html).toContain("Withheld: Names a minor");
    expect(html).toContain("Publish again");
    expect(html).toContain("Delete");
    expect(html).toContain("min-h-11");
    expect(html).toContain("w-full");
    expect(html).toContain("break-words");
  });

  it("still offers Publish again when a moderator changed the reason (withheld_by_other)", () => {
    const html = renderToStaticMarkup(
      createElement(WithheldQueue, { stories: [story({ withheld_by_other: true })], access: moderator }),
    );
    expect(html).toContain("Publish again");
    expect(html).toContain("Delete");
  });

  it("renders nothing for a non-moderator", () => {
    const html = renderToStaticMarkup(createElement(WithheldQueue, { stories: [story()], access: publisher }));
    expect(html).toBe("");
  });

  it("notes when the withheld list is at the 100-story cap", () => {
    const stories = Array.from({ length: 100 }, (_, i) =>
      story({ id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}` }),
    );
    const atCap = renderToStaticMarkup(createElement(WithheldQueue, { stories, access: moderator }));
    expect(atCap).toContain("Showing the first 100 withheld stories.");
    const under = renderToStaticMarkup(createElement(WithheldQueue, { stories: stories.slice(0, 99), access: moderator }));
    expect(under).not.toContain("Showing the first 100");
  });

  it("hides Publish again when there is no consent, and still offers Delete", () => {
    const html = renderToStaticMarkup(
      createElement(WithheldQueue, { stories: [story({ consent_to_share: false })], access: moderator }),
    );
    expect(html).toContain("No consent");
    expect(html).not.toContain("Publish again");
    expect(html).toContain("Delete");
  });
});
