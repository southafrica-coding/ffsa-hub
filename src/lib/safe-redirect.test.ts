import { describe, expect, it } from "vitest";
import { loginDestination, safeInternalPath } from "./safe-redirect";

describe("safeInternalPath", () => {
  it("accepts an internal department path and its query", () => {
    expect(safeInternalPath("/departments/x?tab=okrs")).toBe("/departments/x?tab=okrs");
    expect(safeInternalPath("/departments/x?tab=budget")).toBe("/departments/x?tab=budget");
  });

  it("rejects open redirects, schemes and encoded protocol-relative paths", () => {
    expect(safeInternalPath("//evil.com")).toBeNull();
    expect(safeInternalPath("/\\evil.com")).toBeNull();
    expect(safeInternalPath("https://evil.com")).toBeNull();
    expect(safeInternalPath("javascript:alert(1)")).toBeNull();
    expect(safeInternalPath("%2F%2Fevil.com")).toBeNull();
    expect(safeInternalPath(decodeURIComponent("%2F%2Fevil.com"))).toBeNull();
  });

  it("falls back to /home only when a redirect value is present and unsafe", () => {
    expect(loginDestination(null)).toBeNull();
    expect(loginDestination("//evil.com")).toBe("/home");
    expect(loginDestination("/departments/x?tab=okrs")).toBe("/departments/x?tab=okrs");
  });
});
