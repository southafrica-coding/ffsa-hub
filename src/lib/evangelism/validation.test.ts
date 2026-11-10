import { describe, expect, it } from "vitest";
import {
  PHOTO_MAX_BYTES,
  checkPhoto,
  isPhotoPath,
  photoPathFor,
  parsePhoto,
  parseReview,
  parseTestimonyFields,
} from "./validation";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";
const TODAY = "2026-11-09";

const story = {
  title: "A conversation at the taxi rank",
  body: "We spoke with a man waiting for a taxi. He asked us to pray, and he gave his life to Jesus.",
  occurred_on: "2026-11-01",
  location_label: "Durban",
  people_reached: 4,
  decisions: 1,
  outcome: "decision",
  consent_to_share: true,
};

const parse = (over: Record<string, unknown>, submit = true) =>
  parseTestimonyFields({ ...story, ...over }, { submit, today: TODAY });

describe("parseTestimonyFields", () => {
  it("accepts a good story and trims text", () => {
    const r = parse({ title: "  A conversation at the taxi rank  " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.title).toBe("A conversation at the taxi rank");
      expect(r.value.staff_ministry_id).toBeNull();
    }
  });

  it("requires consent to submit, but not to save a draft", () => {
    const submit = parse({ consent_to_share: false }, true);
    expect(submit.ok).toBe(false);
    if (!submit.ok) expect(submit.code).toBe("consent_required");
    expect(parse({ consent_to_share: false }, false).ok).toBe(true);
  });

  it("only treats a literal true as consent", () => {
    expect(parse({ consent_to_share: "true" }).ok).toBe(false);
    expect(parse({ consent_to_share: 1 }).ok).toBe(false);
  });

  it("rejects an outcome outside the enum", () => {
    expect(parse({ outcome: "healing" }).ok).toBe(false);
    expect(parse({ outcome: "" }).ok).toBe(false);
    for (const o of ["conversation", "prayer", "decision", "follow_up", "other"]) {
      expect(parse({ outcome: o }).ok).toBe(true);
    }
  });

  it("refuses more decisions than people reached", () => {
    expect(parse({ people_reached: 2, decisions: 3 }).ok).toBe(false);
    expect(parse({ people_reached: 3, decisions: 3 }).ok).toBe(true);
  });

  it("refuses negative, fractional or non-numeric counts", () => {
    expect(parse({ people_reached: -1 }).ok).toBe(false);
    expect(parse({ people_reached: 1.5 }).ok).toBe(false);
    expect(parse({ people_reached: "lots" }).ok).toBe(false);
    expect(parse({ people_reached: "5", decisions: "2" }).ok).toBe(true);
  });

  it("checks lengths", () => {
    expect(parse({ title: "Hi" }).ok).toBe(false);
    expect(parse({ body: "Too short" }).ok).toBe(false);
    expect(parse({ location_label: "X" }).ok).toBe(false);
  });

  it("refuses impossible or future dates", () => {
    expect(parse({ occurred_on: "2026-02-31" }).ok).toBe(false);
    expect(parse({ occurred_on: "01/11/2026" }).ok).toBe(false);
    expect(parse({ occurred_on: "2026-11-10" }).ok).toBe(false);
    expect(parse({ occurred_on: TODAY }).ok).toBe(true);
  });

  it("accepts a ministry uuid and rejects junk", () => {
    expect(parse({ staff_ministry_id: FILE }).ok).toBe(true);
    expect(parse({ staff_ministry_id: "worship" }).ok).toBe(false);
  });
});

describe("checkPhoto", () => {
  it("accepts the allowed image types and maps the extension", () => {
    expect(checkPhoto("image/png", 10)).toEqual({ ok: true, value: { contentType: "image/png", ext: "png" } });
    expect(checkPhoto("image/heic", 10)).toEqual({ ok: true, value: { contentType: "image/heic", ext: "heic" } });
  });

  it("treats image/jpg as image/jpeg", () => {
    expect(checkPhoto("image/jpg", 10)).toEqual({ ok: true, value: { contentType: "image/jpeg", ext: "jpg" } });
  });

  it("refuses video and other types", () => {
    expect(checkPhoto("video/mp4", 10).ok).toBe(false);
    expect(checkPhoto("image/gif", 10).ok).toBe(false);
    expect(checkPhoto("application/pdf", 10).ok).toBe(false);
  });

  it("caps photos at 15 MB", () => {
    expect(PHOTO_MAX_BYTES).toBe(15728640);
    expect(checkPhoto("image/jpeg", PHOTO_MAX_BYTES).ok).toBe(true);
    expect(checkPhoto("image/jpeg", PHOTO_MAX_BYTES + 1).ok).toBe(false);
    expect(checkPhoto("image/jpeg", 0).ok).toBe(false);
    expect(checkPhoto("image/jpeg", undefined).ok).toBe(false);
  });
});

describe("photo paths", () => {
  it("mints random/random paths with no user id in them", () => {
    const path = photoPathFor(FILE, OTHER, "jpg");
    expect(path).toBe(`testimonies/${FILE}/${OTHER}.jpg`);
    expect(isPhotoPath(path)).toBe(true);
  });

  it("checks the shape only — ownership is the database's job", () => {
    expect(isPhotoPath(`testimonies/${USER}/${FILE}.jpg`)).toBe(true);
    expect(isPhotoPath(`testimonies/${USER}/../${OTHER}/${FILE}.jpg`)).toBe(false);
    expect(isPhotoPath(`testimonies/${USER}/${FILE}.mp4`)).toBe(false);
    expect(isPhotoPath(`other/${USER}/${FILE}.jpg`)).toBe(false);
    expect(isPhotoPath(42)).toBe(false);
  });

  it("parsePhoto checks path shape, type and size together", () => {
    expect(parsePhoto(undefined)).toEqual({ ok: true, value: null });
    expect(parsePhoto({ path: `testimonies/${OTHER}/${FILE}.png`, content_type: "image/png", size: 100 }).ok).toBe(
      true
    );
    // Type says PNG but the path is .jpg
    expect(parsePhoto({ path: `testimonies/${OTHER}/${FILE}.jpg`, content_type: "image/png", size: 100 }).ok).toBe(
      false
    );
    expect(parsePhoto({ path: "testimonies/not-a-uuid/x.png", content_type: "image/png", size: 100 }).ok).toBe(false);
  });
});

describe("parseReview", () => {
  it("accepts publish and withhold", () => {
    expect(parseReview({ action: "publish" })).toEqual({ ok: true, value: { action: "publish" } });
    expect(parseReview({ action: "withhold", reason: "  Names a minor " })).toEqual({
      ok: true,
      value: { action: "withhold", reason: "Names a minor" },
    });
    expect(parseReview({ action: "withhold" })).toEqual({ ok: true, value: { action: "withhold", reason: null } });
  });

  it("refuses unknown actions and long reasons", () => {
    expect(parseReview({ action: "delete" }).ok).toBe(false);
    expect(parseReview({ action: "withhold", reason: "x".repeat(501) }).ok).toBe(false);
  });
});
