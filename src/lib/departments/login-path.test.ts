import { describe, expect, it } from "vitest";
import { loginPath } from "./login-path";

describe("loginPath", () => {
  it("keeps a same-origin path on the login redirect", () => {
    expect(loginPath("/departments")).toBe("/login?redirect=" + encodeURIComponent("/departments"));
    expect(loginPath("/departments/finances_legal")).toBe(
      "/login?redirect=" + encodeURIComponent("/departments/finances_legal")
    );
    expect(loginPath("/departments/x?tab=budget")).toBe(
      "/login?redirect=" + encodeURIComponent("/departments/x?tab=budget")
    );
  });

  it("does not emit redirect=/ or an empty or unsafe redirect", () => {
    for (const path of [
      "/",
      "",
      "/login",
      "/login?redirect=/",
      "//evil.com",
      "/\\evil",
      "@evil.com",
      "javascript:alert(1)",
      "http://evil.com",
      "https:",
      "https://evil.com",
    ]) {
      expect(loginPath(path)).toBe("/login");
    }
  });

  it("drops a path that is not a single-slash relative path", () => {
    expect(loginPath("//evil.example")).toBe("/login");
    expect(loginPath("/departments\\finances_legal")).toBe("/login");
    expect(loginPath("https://evil.example")).toBe("/login");
    expect(loginPath("departments")).toBe("/login");
    expect(loginPath("")).toBe("/login");
  });
});
