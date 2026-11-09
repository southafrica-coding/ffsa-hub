import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PresentedTestimony } from "@/services/evangelism";
import { StoryActions } from "./story-actions";

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));

const publisher = { submit: true, publish: true };
const submitter = { submit: true, publish: false };

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
    is_mine: false,
    photo: null,
    ...over,
  };
}

function markup(props: Parameters<typeof StoryActions>[0]) {
  return renderToStaticMarkup(createElement(StoryActions, props));
}

const noop = () => {};

describe("StoryActions", () => {
  it("shows Unpublish and Delete on the author's own published story", () => {
    const html = markup({ story: story({ is_mine: true }), surface: "feed", access: publisher, onResult: noop });
    expect(html).toContain("Unpublish");
    expect(html).toContain("Delete");
    expect(html).toContain("min-h-11");
    expect(html).toContain("w-full");
    expect(html).toContain("sm:w-auto");
    expect(html).not.toContain("Publish again");
  });

  it("shows nothing on someone else's published story without moderate", () => {
    const html = markup({ story: story({ is_mine: false }), surface: "feed", access: publisher, onResult: noop });
    expect(html).toBe("");
  });

  it("shows Delete for the author's draft, and not for their submitted story", () => {
    const draft = markup({
      story: story({ is_mine: true, status: "draft" }),
      surface: "mine",
      access: submitter,
      onResult: noop,
    });
    expect(draft).toContain("Delete");
    expect(draft).not.toContain("Unpublish");

    const submitted = markup({
      story: story({ is_mine: true, status: "submitted" }),
      surface: "mine",
      access: submitter,
      onResult: noop,
    });
    expect(submitted).toBe("");
  });

  it("shows Delete and Publish again on the author's withheld story when they can publish", () => {
    const html = markup({
      story: story({ is_mine: true, status: "withheld" }),
      surface: "mine",
      access: publisher,
      onResult: noop,
    });
    expect(html).toContain("Delete");
    expect(html).toContain("Publish again");
    expect(html).not.toContain("Unpublish");
  });

  it("does not show Delete for the author's own submitted story", () => {
    const html = markup({
      story: story({ is_mine: true, status: "submitted" }),
      surface: "mine",
      access: publisher,
      onResult: noop,
    });
    expect(html).not.toContain("Delete");
  });
});
