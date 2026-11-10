import { describe, expect, it } from "vitest";
import {
  OTHERS_STORY_TAKEDOWN,
  canActOnOthersStory,
  classifyPatch,
  decideTakedown,
  reviewedContentStaysLocked,
  statusAfterAuthorEdit,
  takedownFromAttribution,
  visibleTakedownControls,
  type TakedownAccess,
  type TakedownStory,
} from "./takedown";

const publisher: TakedownAccess = { submit: true, publish: true };
const submitter: TakedownAccess = { submit: true, publish: false };
const viewer: TakedownAccess = { submit: false, publish: false };
const moderator: TakedownAccess = { submit: true, publish: true, moderate: true };
const adminOnly: TakedownAccess = { submit: true, publish: true, unscopedAdmin: true };

function story(over: Partial<TakedownStory> = {}): TakedownStory {
  return { isMine: false, status: "published", consentToShare: true, ...over };
}

describe("OTHERS_STORY_TAKEDOWN", () => {
  it("ships migration 311's moderate rule (do not merge before #537 and #539)", () => {
    expect(OTHERS_STORY_TAKEDOWN).toBe("moderate");
    expect(canActOnOthersStory(publisher)).toBe(false);
    expect(canActOnOthersStory(submitter)).toBe(false);
    expect(canActOnOthersStory({ ...submitter, moderate: true })).toBe(true);
    expect(canActOnOthersStory({ submit: false, publish: false, unscopedAdmin: true })).toBe(true);
    expect(canActOnOthersStory(publisher, "publish")).toBe(true);
  });

  it("moderate variant: ministry leaders and unscoped admins, not plain publishers", () => {
    expect(canActOnOthersStory(publisher, "moderate")).toBe(false);
    expect(canActOnOthersStory(moderator, "moderate")).toBe(true);
    expect(canActOnOthersStory(adminOnly, "moderate")).toBe(true);
    expect(canActOnOthersStory({ submit: false, publish: false, unscopedAdmin: true }, "moderate")).toBe(true);
    expect(canActOnOthersStory(submitter, "moderate")).toBe(false);
  });
});

describe("decideTakedown — publish rule (307, not the default here)", () => {
  const decide307: typeof decideTakedown = (action, access, story) =>
    decideTakedown(action, access, story, "publish");
  it("lets a publisher withhold a published story, own or someone else's", () => {
    expect(decide307("withhold", publisher, story())).toEqual({ ok: true });
    expect(decide307("withhold", publisher, story({ isMine: true }))).toEqual({ ok: true });
  });

  it("lets a publisher withhold submitted and withheld stories, not someone else's draft", () => {
    expect(decide307("withhold", publisher, story({ status: "submitted" })).ok).toBe(true);
    expect(decide307("withhold", publisher, story({ status: "withheld" })).ok).toBe(true);
    const draft = decide307("withhold", publisher, story({ status: "draft" }));
    expect(draft.ok).toBe(false);
    if (!draft.ok) expect(draft.status).toBe(409);
  });

  it("lets a publisher withhold their own draft — 307's guard only limits other people's", () => {
    expect(decide307("withhold", publisher, story({ isMine: true, status: "draft" })).ok).toBe(true);
  });

  it("refuses a non-publisher, including the author", () => {
    for (const access of [submitter, viewer]) {
      for (const isMine of [true, false]) {
        const decision = decide307("withhold", access, story({ isMine }));
        expect(decision.ok).toBe(false);
        if (!decision.ok) expect(decision.status).toBe(403);
      }
    }
  });

  it("republishes only from submitted or withheld, and only with consent", () => {
    expect(decide307("republish", publisher, story({ status: "withheld" })).ok).toBe(true);
    expect(decide307("republish", publisher, story({ status: "submitted" })).ok).toBe(true);
    const published = decide307("republish", publisher, story({ status: "published" }));
    expect(published.ok).toBe(false);
    if (!published.ok) expect(published.status).toBe(409);
    const noConsent = decide307("republish", publisher, story({ status: "withheld", consentToShare: false }));
    expect(noConsent.ok).toBe(false);
    if (!noConsent.ok) {
      expect(noConsent.status).toBe(400);
      expect(noConsent.code).toBe("consent_required");
    }
  });

  it("checks permission before consent, so a non-publisher is refused rather than told about consent", () => {
    const decision = decide307("republish", submitter, story({ status: "submitted", consentToShare: false, isMine: true }));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.status).toBe(403);
  });

  it("lets the author delete their own draft, and a publisher delete any story", () => {
    expect(decide307("delete", submitter, story({ isMine: true, status: "draft" })).ok).toBe(true);
    expect(decide307("delete", publisher, story({ status: "published" })).ok).toBe(true);
    expect(decide307("delete", publisher, story({ isMine: true, status: "submitted" })).ok).toBe(true);
    expect(decide307("delete", publisher, story({ isMine: true, status: "withheld" })).ok).toBe(true);
    expect(decide307("delete", publisher, story({ isMine: true, status: "draft", consentToShare: false })).ok).toBe(true);
  });

  it("refuses an author delete of submitted, withheld, or published stories", () => {
    for (const status of ["submitted", "withheld", "published"] as const) {
      const decision = decide307("delete", submitter, story({ isMine: true, status }));
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.status).toBe(403);
    }
  });

  it("refuses a viewer deleting their own draft — submit is required", () => {
    expect(decide307("delete", viewer, story({ isMine: true, status: "draft" })).ok).toBe(false);
  });
});

describe("decideTakedown — moderate variant (311 at 13990826, not active)", () => {
  const moderateOnly: TakedownAccess = { submit: false, publish: false, moderate: true };
  const bareAdmin: TakedownAccess = { submit: false, publish: false, unscopedAdmin: true };

  it("blocks a plain publisher from someone else's story", () => {
    for (const action of ["withhold", "republish", "delete"] as const) {
      const decision = decideTakedown(action, publisher, story({ status: action === "republish" ? "withheld" : "published" }), "moderate");
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.status).toBe(403);
    }
  });

  it("lets a moderator or unscoped admin act on someone else's story", () => {
    const published = story();
    const withheld = story({ status: "withheld" });
    for (const access of [moderator, adminOnly, moderateOnly, bareAdmin]) {
      expect(decideTakedown("withhold", access, published, "moderate").ok).toBe(true);
      expect(decideTakedown("republish", access, withheld, "moderate").ok).toBe(true);
      expect(decideTakedown("delete", access, published, "moderate").ok).toBe(true);
    }
  });

  it("lets an author unpublish and delete their own published or withheld story without moderate", () => {
    expect(decideTakedown("withhold", submitter, story({ isMine: true, status: "published" }), "moderate").ok).toBe(true);
    expect(decideTakedown("withhold", submitter, story({ isMine: true, status: "withheld" }), "moderate").ok).toBe(true);
    expect(decideTakedown("delete", submitter, story({ isMine: true, status: "published" }), "moderate").ok).toBe(true);
    expect(decideTakedown("delete", submitter, story({ isMine: true, status: "withheld" }), "moderate").ok).toBe(true);
    expect(decideTakedown("delete", submitter, story({ isMine: true, status: "draft" }), "moderate").ok).toBe(true);
  });

  it("refuses an author withhold of their own draft or submitted story, even for a moderator", () => {
    for (const status of ["draft", "submitted"] as const) {
      for (const access of [submitter, publisher, moderateOnly]) {
        const decision = decideTakedown("withhold", access, story({ isMine: true, status }), "moderate");
        expect(decision.ok).toBe(false);
        if (!decision.ok) expect(decision.status).toBe(409);
      }
    }
  });

  it("refuses a moderator withhold of someone else's draft", () => {
    const decision = decideTakedown("withhold", moderateOnly, story({ status: "draft" }), "moderate");
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.status).toBe(409);
  });

  it("lets the author republish their own story only with publish and consent", () => {
    expect(decideTakedown("republish", publisher, story({ isMine: true, status: "withheld" }), "moderate").ok).toBe(true);
    expect(decideTakedown("republish", publisher, story({ isMine: true, status: "submitted" }), "moderate").ok).toBe(true);
    const author = decideTakedown("republish", submitter, story({ isMine: true, status: "withheld" }), "moderate");
    expect(author.ok).toBe(false);
    if (!author.ok) expect(author.status).toBe(403);
    // Moderate alone publishes someone else's story, not the moderator's own.
    expect(decideTakedown("republish", moderateOnly, story({ status: "submitted" }), "moderate").ok).toBe(true);
    const own = decideTakedown("republish", moderateOnly, story({ isMine: true, status: "withheld" }), "moderate");
    expect(own.ok).toBe(false);
    if (!own.ok) expect(own.status).toBe(403);
    const noConsent = decideTakedown(
      "republish",
      publisher,
      story({ isMine: true, status: "withheld", consentToShare: false }),
      "moderate",
    );
    expect(noConsent.ok).toBe(false);
    if (!noConsent.ok) expect(noConsent.status).toBe(400);
  });

  it("does not let an author delete their own submitted story unless they moderate", () => {
    const author = decideTakedown("delete", publisher, story({ isMine: true, status: "submitted" }), "moderate");
    expect(author.ok).toBe(false);
    if (!author.ok) expect(author.status).toBe(403);
    expect(decideTakedown("delete", moderateOnly, story({ isMine: true, status: "submitted" }), "moderate").ok).toBe(true);
    expect(decideTakedown("delete", moderateOnly, story({ status: "draft" }), "moderate").ok).toBe(true);
  });

  it("locks the author after a moderator changes the reason on a story the author withheld", () => {
    // 311 sets withheld_by to the moderator when they change withheld_reason
    // on someone else's withheld story, so the author's flag becomes true.
    const after = story({ isMine: true, status: "withheld", withheldByOther: true });
    expect(decideTakedown("republish", publisher, after, "moderate").ok).toBe(false);
    expect(decideTakedown("withhold", publisher, after, "moderate").ok).toBe(false);
    expect(decideTakedown("delete", publisher, after, "moderate").ok).toBe(true);
    expect(reviewedContentStaysLocked("moderate")).toBe(false);
  });

  it("hides republish and reason changes when withheld_by_other is true, and still allows delete", () => {
    const locked = story({ isMine: true, status: "withheld", withheldByOther: true });
    const republish = decideTakedown("republish", publisher, locked, "moderate");
    const reason = decideTakedown("withhold", publisher, locked, "moderate");
    expect(republish.ok).toBe(false);
    expect(reason.ok).toBe(false);
    if (!republish.ok) expect(republish.error).toMatch(/moderator withheld/i);
    expect(decideTakedown("delete", publisher, locked, "moderate").ok).toBe(true);
    expect(reviewedContentStaysLocked("moderate")).toBe(false);
    expect(visibleTakedownControls("mine", publisher, locked, "moderate").republish).toBe(false);
  });

  it("still lets the author republish their own withhold and a null flag", () => {
    const own = story({ isMine: true, status: "withheld", withheldByOther: false });
    expect(decideTakedown("republish", publisher, own, "moderate").ok).toBe(true);
    expect(decideTakedown("withhold", publisher, own, "moderate").ok).toBe(true);
    const absent = story({ isMine: true, status: "withheld" });
    expect(decideTakedown("republish", publisher, absent, "moderate").ok).toBe(true);
  });

  it("does not block a moderator when withheld_by_other is true", () => {
    const locked = story({ isMine: true, status: "withheld", withheldByOther: true });
    expect(decideTakedown("republish", moderator, locked, "moderate").ok).toBe(true);
    expect(decideTakedown("withhold", moderator, locked, "moderate").ok).toBe(true);
    expect(decideTakedown("delete", moderator, locked, "moderate").ok).toBe(true);
  });

  it("treats a missing attribution row as no takedown for a non-moderator", () => {
    expect(takedownFromAttribution(undefined, { moderate: false, status: "withheld" })).toEqual({
      isMine: false,
      withheldByOther: true,
    });
    const subject = story({
      ...takedownFromAttribution(undefined, { moderate: false, status: "withheld" }),
      status: "withheld",
    });
    expect(decideTakedown("republish", publisher, subject, "moderate").ok).toBe(false);
    expect(decideTakedown("withhold", publisher, subject, "moderate").ok).toBe(false);
    expect(decideTakedown("delete", publisher, subject, "moderate").ok).toBe(false);
    expect(visibleTakedownControls("mine", publisher, subject, "moderate")).toEqual({
      withhold: false,
      delete: false,
      republish: false,
    });
    expect(takedownFromAttribution(undefined, { moderate: true, status: "withheld" })).toEqual({
      isMine: false,
      withheldByOther: false,
    });
    expect(takedownFromAttribution(null, { moderate: false, status: "published" }).withheldByOther).toBe(false);
  });

  it("keeps a reviewed story's status when 311 allows the author to edit it", () => {
    expect(statusAfterAuthorEdit("published", true, "moderate")).toBe("published");
    expect(statusAfterAuthorEdit("withheld", false, "moderate")).toBe("withheld");
    expect(statusAfterAuthorEdit("published", true, "publish")).toBe("locked");
    expect(statusAfterAuthorEdit("published", true)).toBe("published");
    expect(statusAfterAuthorEdit("draft", true, "moderate")).toBe("submitted");
    expect(statusAfterAuthorEdit("submitted", false, "moderate")).toBe("draft");
  });

  it("hides Publish again on the active rule when a moderator owns the takedown", () => {
    const locked = story({ isMine: true, status: "withheld", withheldByOther: true });
    expect(decideTakedown("republish", publisher, locked).ok).toBe(false);
    expect(decideTakedown("withhold", publisher, locked).ok).toBe(false);
    expect(decideTakedown("delete", publisher, locked).ok).toBe(true);
    expect(reviewedContentStaysLocked()).toBe(false);
  });

  it("treats an unscoped admin as is_admin(), which implies publish, submit, and moderate", () => {
    expect(decideTakedown("republish", bareAdmin, story({ isMine: true, status: "withheld" }), "moderate").ok).toBe(true);
    expect(decideTakedown("withhold", bareAdmin, story({ isMine: true, status: "published" }), "moderate").ok).toBe(true);
    expect(decideTakedown("delete", bareAdmin, story({ isMine: true, status: "draft" }), "moderate").ok).toBe(true);
  });
});

describe("visibleTakedownControls", () => {
  it("shows Unpublish and Delete on the author's own published story, and on others' only for a moderator", () => {
    expect(visibleTakedownControls("feed", publisher, story())).toEqual({
      withhold: false,
      delete: false,
      republish: false,
    });
    expect(visibleTakedownControls("feed", submitter, story({ isMine: true }))).toEqual({
      withhold: true,
      delete: true,
      republish: false,
    });
    expect(visibleTakedownControls("feed", moderator, story()).withhold).toBe(true);
    expect(visibleTakedownControls("feed", moderator, story()).delete).toBe(true);
  });

  it("shows Delete on My stories for a draft or own withheld story, not a submitted one", () => {
    expect(visibleTakedownControls("mine", submitter, story({ isMine: true, status: "draft" })).delete).toBe(true);
    expect(visibleTakedownControls("mine", submitter, story({ isMine: true, status: "submitted" })).delete).toBe(false);
    expect(visibleTakedownControls("mine", submitter, story({ isMine: true, status: "withheld" })).delete).toBe(true);
    expect(visibleTakedownControls("mine", publisher, story({ isMine: true, status: "submitted" })).delete).toBe(false);
    expect(visibleTakedownControls("mine", publisher, story({ isMine: true, status: "withheld" })).delete).toBe(true);
    expect(visibleTakedownControls("mine", moderator, story({ isMine: true, status: "submitted" })).delete).toBe(true);
  });

  it("does not show Delete on a published story in My stories — that control lives on the feed", () => {
    expect(visibleTakedownControls("mine", publisher, story({ isMine: true, status: "published" })).delete).toBe(false);
  });

  it("does not show Delete on someone else's story in My stories", () => {
    expect(visibleTakedownControls("mine", publisher, story({ isMine: false, status: "draft" })).delete).toBe(false);
  });

  it("shows Publish again on a withheld story the caller may republish", () => {
    expect(visibleTakedownControls("mine", publisher, story({ isMine: true, status: "withheld" })).republish).toBe(true);
    expect(visibleTakedownControls("mine", submitter, story({ isMine: true, status: "withheld" })).republish).toBe(false);
    expect(visibleTakedownControls("mine", publisher, story({ isMine: true, status: "withheld", consentToShare: false })).republish).toBe(
      false,
    );
  });

  it("hides others'-story feed controls under the moderate rule unless they moderate", () => {
    expect(visibleTakedownControls("feed", publisher, story(), "moderate")).toEqual({
      withhold: false,
      delete: false,
      republish: false,
    });
    expect(visibleTakedownControls("feed", moderator, story(), "moderate").withhold).toBe(true);
    expect(visibleTakedownControls("feed", publisher, story({ isMine: true }), "moderate").withhold).toBe(true);
  });
});

describe("classifyPatch", () => {
  it("reads a withhold from status or action, with an optional reason", () => {
    expect(classifyPatch({ status: "withheld", reason: "  Names a minor " })).toEqual({
      kind: "withhold",
      reason: "Names a minor",
    });
    expect(classifyPatch({ status: "withheld" })).toEqual({ kind: "withhold", reason: null });
    expect(classifyPatch({ status: "withheld", reason: "   " })).toEqual({ kind: "withhold", reason: null });
    expect(classifyPatch({ status: "withheld", withheld_reason: "Not this week" })).toEqual({
      kind: "withhold",
      reason: "Not this week",
    });
    expect(classifyPatch({ action: "withhold", reason: "Queue" })).toEqual({ kind: "withhold", reason: "Queue" });
  });

  it("reads republish from status or action", () => {
    expect(classifyPatch({ status: "published" })).toEqual({ kind: "republish" });
    expect(classifyPatch({ action: "publish" })).toEqual({ kind: "republish" });
  });

  it("rejects an oversized or non-text reason", () => {
    expect(classifyPatch({ status: "withheld", reason: "x".repeat(501) })).toEqual({
      kind: "invalid",
      error: "Keep the reason under 500 characters.",
    });
    expect(classifyPatch({ action: "withhold", reason: 12 }).kind).toBe("invalid");
  });

  it("treats content and consent as an edit, and refuses them mixed into a review", () => {
    expect(classifyPatch({ title: "A new title", intent: "draft" }).kind).toBe("edit");
    expect(classifyPatch({ consent_to_share: false }).kind).toBe("edit");
    expect(classifyPatch({ status: "withheld", title: "Sneaky" }).kind).toBe("mixed");
    expect(classifyPatch({ action: "publish", consent_to_share: true }).kind).toBe("mixed");
  });

  it("rejects an unknown action", () => {
    expect(classifyPatch({ action: "delete" }).kind).toBe("invalid");
  });

  it("rejects an action that conflicts with status", () => {
    const conflict = classifyPatch({ action: "withhold", status: "published" });
    expect(conflict.kind).toBe("invalid");
    if (conflict.kind === "invalid") expect(conflict.error).toMatch(/don't match/);
    expect(classifyPatch({ action: "publish", status: "withheld" }).kind).toBe("invalid");
    expect(classifyPatch({ action: "withhold", status: "withheld" }).kind).toBe("withhold");
  });
});
