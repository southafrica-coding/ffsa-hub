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
    expect(loginDestination(undefined)).toBeNull();
    expect(loginDestination("/departments/x?tab=okrs")).toBe("/departments/x?tab=okrs");
  });

  it("treats /, empty, and unsafe values as no return path", () => {
    expect(loginDestination("/")).toBe("/home");
    expect(loginDestination("/?next=/finance")).toBe("/home");
    expect(loginDestination("")).toBe("/home");
    expect(loginDestination("//evil.com")).toBe("/home");
    expect(loginDestination("/\\evil")).toBe("/home");
    expect(loginDestination("https://evil.com")).toBe("/home");
    expect(loginDestination("https://evil")).toBe("/home");
    expect(loginDestination("@evil.com")).toBe("/home");
    expect(loginDestination("javascript:alert(1)")).toBe("/home");
    expect(loginDestination("http://evil.com")).toBe("/home");
    expect(loginDestination("https:")).toBe("/home");
  });

  it("treats /login, including a nested redirect, as no return path", () => {
    expect(loginDestination("/login")).toBe("/home");
    expect(loginDestination("/login/")).toBe("/home");
    expect(loginDestination("/login?redirect=/")).toBe("/home");
    expect(loginDestination("/login?redirect=/login")).toBe("/home");
    expect(loginDestination("/login?redirect=/login?redirect=/finance")).toBe("/home");
    expect(loginDestination("/login?redirect=/finance/projects")).toBe("/home");
  });

  it("keeps a safe internal path and its query string", () => {
    expect(loginDestination("/finance/projects")).toBe("/finance/projects");
    expect(loginDestination("/finance/projects?tab=open")).toBe("/finance/projects?tab=open");
    expect(loginDestination("/profile?tab=x#a")).toBe("/profile?tab=x#a");
    expect(loginDestination("/home")).toBe("/home");
  });
});
