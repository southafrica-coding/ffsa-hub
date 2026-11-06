import { describe, expect, it } from "vitest";
import {
  buildMediaPath,
  canDeleteTestimony,
  canEditTestimony,
  isOwnedMediaPath,
  validateSignMedia,
  validateTestimonyWrite,
} from "./contract";

const USER = "11111111-1111-4111-8111-111111111111";
const FILE = "22222222-2222-4222-8222-222222222222";

const story = {
  title: "A conversation at the taxi rank",
  body: "We spoke with a man waiting for the taxi. He asked us to pray, and he gave his life to Jesus before the kombi came.",
  occurred_on: "2026-11-01",
  location_label: "Durban base",
  people_reached: 4,
  decisions: 1,
  outcome: "decision" as const,
  consent_to_share: true,
};

describe("validateTestimonyWrite", () => {
  it("accepts a complete story", () => {
    const result = validateTestimonyWrite(story, { mode: "create", today: "2026-11-06", canPublish: false });
    expect(result.ok).toBe(true);
  });

  it("rejects a future day, too many decisions, and a submit without consent", () => {
    const result = validateTestimonyWrite(
      { ...story, occurred_on: "2026-11-07", decisions: 9, consent_to_share: false, status: "submitted" },
      { mode: "create", today: "2026-11-06", canPublish: false }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.field)).toEqual(
        expect.arrayContaining(["occurred_on", "decisions", "consent_to_share"])
      );
    }
  });

  it("blocks an author from publishing", () => {
    const result = validateTestimonyWrite(
      { ...story, status: "published" },
      { mode: "create", today: "2026-11-06", canPublish: false }
    );
    expect(result.ok).toBe(false);
  });

  it("lets a publisher publish when consent is given", () => {
    const result = validateTestimonyWrite(
      { ...story, status: "published" },
      { mode: "create", today: "2026-11-06", canPublish: true }
    );
    expect(result.ok).toBe(true);
  });
});

describe("testimony media paths", () => {
  it("signs only a photo or video under the caller's prefix", () => {
    expect(validateSignMedia({ kind: "photo", content_type: "image/jpeg", size: 1000 }).ok).toBe(true);
    expect(validateSignMedia({ kind: "photo", content_type: "image/svg+xml", size: 1000 }).ok).toBe(false);
    expect(validateSignMedia({ kind: "video", content_type: "video/mp4", size: 300 * 1024 * 1024 }).ok).toBe(false);

    const path = buildMediaPath(USER, "image/jpeg", FILE);
    expect(path).toBe(`testimonies/${USER}/${FILE}.jpg`);
    expect(isOwnedMediaPath(USER, path!, "image/jpeg")).toBe(true);
    expect(isOwnedMediaPath(USER, `testimonies/someone-else/${FILE}.jpg`, "image/jpeg")).toBe(false);
    expect(isOwnedMediaPath(USER, `testimonies/${USER}/../${FILE}.jpg`, "image/jpeg")).toBe(false);
  });
});

describe("who can edit or delete", () => {
  const row = { author_user_id: USER, status: "submitted" };
  it("lets the author edit a submitted story and only delete a draft", () => {
    expect(canEditTestimony({ publish: false }, row, USER)).toBe(true);
    expect(canDeleteTestimony({ publish: false }, row, USER)).toBe(false);
    expect(canDeleteTestimony({ publish: false }, { ...row, status: "draft" }, USER)).toBe(true);
    expect(canEditTestimony({ publish: false }, { ...row, status: "published" }, USER)).toBe(false);
  });

  it("lets a publisher edit and delete any story", () => {
    expect(canEditTestimony({ publish: true }, { ...row, status: "published" }, "other")).toBe(true);
    expect(canDeleteTestimony({ publish: true }, { ...row, status: "published" }, "other")).toBe(true);
  });
});
