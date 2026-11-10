import { describe, expect, it } from "vitest";
import { previewWritesDisabled } from "./preview-writes";

describe("previewWritesDisabled", () => {
  it("is on for a Vercel preview deployment", () => {
    expect(previewWritesDisabled({ VERCEL_ENV: "preview" })).toBe(true);
  });

  it("is on when the explicit flag is set", () => {
    expect(previewWritesDisabled({ PREVIEW_WRITES_DISABLED: "true" })).toBe(true);
    expect(previewWritesDisabled({ PREVIEW_WRITES_DISABLED: "1" })).toBe(true);
  });

  it("is off in production and when nothing is set", () => {
    expect(previewWritesDisabled({ VERCEL_ENV: "production" })).toBe(false);
    expect(previewWritesDisabled({})).toBe(false);
  });
});
