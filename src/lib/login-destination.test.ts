import { describe, expect, it } from "vitest";
import { loginDestination, safeInternalPath } from "./login-destination";

describe("login destination", () => {
  it("rejects raw tab and newline, and the slash-prefixed control encodings", () => {
    expect(safeInternalPath("/%09/evil.com")).toBeNull();
    expect(safeInternalPath("/%0a/evil.com")).toBeNull();
    expect(safeInternalPath("/%0d/evil.com")).toBeNull();
    expect(safeInternalPath("/\t/evil.com")).toBeNull();
    expect(safeInternalPath("/\n/evil.com")).toBeNull();
    expect(safeInternalPath("\t")).toBeNull();
    expect(safeInternalPath("\n")).toBeNull();
  });

  it("rejects an array and a bare at-host, and keeps /@evil.com", () => {
    expect(safeInternalPath(["/departments"])).toBeNull();
    expect(safeInternalPath("@evil.com")).toBeNull();
    expect(safeInternalPath("/@evil.com")).toBe("/@evil.com");
  });

  it("keeps a department return path with ?tab", () => {
    expect(safeInternalPath("/departments/x?tab=okrs")).toBe("/departments/x?tab=okrs");
    expect(safeInternalPath("/departments/x?tab=budget")).toBe("/departments/x?tab=budget");
  });

  it("sends the login page to /home for /%09/evil.com", () => {
    expect(loginDestination("/%09/evil.com")).toBe("/home");
    expect(loginDestination(null)).toBeNull();
    expect(loginDestination("/departments/x?tab=okrs")).toBe("/departments/x?tab=okrs");
  });
});
