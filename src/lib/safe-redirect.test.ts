import { describe, expect, it } from "vitest";
import { safeRedirect } from "./safe-redirect";

describe("safeRedirect", () => {
  it.each([
    "@evil.com",
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "/%09/evil.com",
    "%09",
    "%0a",
    "%0d",
    "/%0a/evil.com",
    "/%2F%2Fevil.com",
    "%2F%2Fevil.com",
    "/%252F%252Fevil.com",
    "javascript:alert(1)",
  ])("rejects %j", (value) => {
    expect(safeRedirect(value)).toBeNull();
  });

  it("rejects an array value", () => {
    expect(safeRedirect(["/profile"])).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(safeRedirect(null)).toBeNull();
    expect(safeRedirect(undefined)).toBeNull();
  });

  it("keeps an internal path and its query", () => {
    expect(safeRedirect("/profile?tab=x")).toBe("/profile?tab=x");
  });

  it("keeps a hash", () => {
    expect(safeRedirect("/profile#a")).toBe("/profile#a");
  });
});
