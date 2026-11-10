import { describe, expect, it } from "vitest";
import { loginDestination, safeInternalPath, safeRedirect } from "./safe-redirect";

describe("safeRedirect", () => {
  it("keeps an internal path, query, and hash", () => {
    expect(safeRedirect("/departments/x?tab=okrs#a")).toBe("/departments/x?tab=okrs#a");
    expect(safeRedirect("/departments/x?tab=okrs")).toBe("/departments/x?tab=okrs");
    expect(safeRedirect("/departments/x?tab=budget")).toBe("/departments/x?tab=budget");
    expect(safeInternalPath("/departments")).toBe("/departments");
  });

  it("keeps /@evil.com as a same-origin path and rejects a bare @", () => {
    expect(safeRedirect("/@evil.com")).toBe("/@evil.com");
    expect(safeRedirect("@evil.com")).toBeNull();
  });

  it("rejects control characters that browsers strip into a protocol-relative URL", () => {
    expect(safeRedirect("/%09/evil.com")).toBeNull();
    expect(safeRedirect("/%0a/evil.com")).toBeNull();
    expect(safeRedirect("/%0d/evil.com")).toBeNull();
    expect(safeRedirect("/%09evil.com")).toBeNull();
    expect(safeRedirect("/%0aevil.com")).toBeNull();
    expect(safeRedirect("/%0devil.com")).toBeNull();
    expect(safeRedirect("/\t/evil.com")).toBeNull();
    expect(safeRedirect("/\n/evil.com")).toBeNull();
    expect(safeRedirect("\t")).toBeNull();
    expect(safeRedirect("\n")).toBeNull();
  });

  it("rejects non-strings, open redirects, schemes, and encoded protocol-relative paths", () => {
    expect(safeRedirect(["/departments"])).toBeNull();
    expect(safeRedirect(undefined)).toBeNull();
    expect(safeRedirect(null)).toBeNull();
    expect(safeRedirect("//evil.com")).toBeNull();
    expect(safeRedirect("/\\evil.com")).toBeNull();
    expect(safeRedirect("https://evil.com")).toBeNull();
    expect(safeRedirect("javascript:alert(1)")).toBeNull();
    expect(safeRedirect("%2F%2Fevil.com")).toBeNull();
    expect(safeRedirect(decodeURIComponent("%2F%2Fevil.com"))).toBeNull();
  });

  it("sends the login page to /home for /%09/evil.com", () => {
    expect(loginDestination("/%09/evil.com")).toBe("/home");
    expect(loginDestination(null)).toBeNull();
    expect(loginDestination("/departments/x?tab=okrs")).toBe("/departments/x?tab=okrs");
  });
});
