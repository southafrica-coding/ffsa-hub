import { describe, expect, it } from "vitest";
import { previewWriteRefusal, previewWritesDisabled } from "./preview-writes";

// Next.js types NODE_ENV as required on ProcessEnv. These helpers never read it.
const baseEnv = { NODE_ENV: "test" } as const;

describe("previewWritesDisabled", () => {
  it("is on for a Vercel preview deployment", () => {
    expect(previewWritesDisabled({ ...baseEnv, VERCEL_ENV: "preview" })).toBe(true);
  });

  it("is on when the explicit flag is set", () => {
    expect(previewWritesDisabled({ ...baseEnv, PREVIEW_WRITES_DISABLED: "true" })).toBe(true);
    expect(previewWritesDisabled({ ...baseEnv, PREVIEW_WRITES_DISABLED: "1" })).toBe(true);
  });

  it("is off in production and when nothing is set", () => {
    expect(previewWritesDisabled({ ...baseEnv, VERCEL_ENV: "production" })).toBe(false);
    expect(previewWritesDisabled({ ...baseEnv })).toBe(false);
  });

  it("refuses a preview write with 403 preview_writes_disabled", () => {
    expect(previewWriteRefusal({ ...baseEnv, VERCEL_ENV: "preview" })).toEqual({
      status: 403,
      body: {
        error: "preview_writes_disabled",
        message: "This preview deployment cannot change school records.",
      },
    });
    expect(previewWriteRefusal({ ...baseEnv, VERCEL_ENV: "production" })).toBeNull();
  });
});
