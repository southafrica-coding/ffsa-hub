import { describe, expect, it } from "vitest";
import { MISSIO_PUBLIC_FEEDBACK_PATH, missioPublicFeedbackPath, missioPublicFeedbackUrl, preselectedHouseId } from "./public-feedback-link";

const H4 = "44444444-4444-4444-8444-444444444444";
const H7 = "77777777-7777-4777-8777-777777777777";

describe("missioPublicFeedbackPath / Url", () => {
  it("is the plain form with no house, and ?house= with one", () => {
    expect(missioPublicFeedbackPath()).toBe(MISSIO_PUBLIC_FEEDBACK_PATH);
    expect(missioPublicFeedbackPath("")).toBe(MISSIO_PUBLIC_FEEDBACK_PATH);
    expect(missioPublicFeedbackPath(null)).toBe(MISSIO_PUBLIC_FEEDBACK_PATH);
    expect(missioPublicFeedbackPath(H4)).toBe(`/f/missio-weekly-feedback?house=${H4}`);
    expect(missioPublicFeedbackPath("a b&c")).toBe("/f/missio-weekly-feedback?house=a%20b%26c");
    expect(missioPublicFeedbackUrl("https://hub.example/")).toBe("https://hub.example/f/missio-weekly-feedback");
    expect(missioPublicFeedbackUrl("https://hub.example", H7)).toBe(`https://hub.example/f/missio-weekly-feedback?house=${H7}`);
  });
});

describe("preselectedHouseId", () => {
  const houses = [{ id: H4 }, { id: H7 }];
  it("keeps an id that is in the picker's list", () => {
    expect(preselectedHouseId(H7, houses)).toBe(H7);
    expect(preselectedHouseId([H4, H7], houses)).toBe(H4);
  });
  it("drops anything else", () => {
    for (const raw of [undefined, null, "", "  ", "nope", "88888888-8888-4888-8888-888888888888", 7, {}, [], ["x"]]) {
      expect(preselectedHouseId(raw, houses)).toBeNull();
    }
    expect(preselectedHouseId(H4, [])).toBeNull();
  });
});
