import { describe, expect, it } from "vitest";
import { loginErrorFromParam } from "./login-error";

describe("loginErrorFromParam", () => {
  it("explains a failed sign-out without dumping a status code", () => {
    expect(loginErrorFromParam("signout")).toBe("We couldn't sign you out. Please try again.");
  });

  it("keeps the deactivated message and ignores unknown codes", () => {
    expect(loginErrorFromParam("deactivated")).toMatch(/deactivated/i);
    expect(loginErrorFromParam(null)).toBeNull();
    expect(loginErrorFromParam("nope")).toBeNull();
  });

  it("tells a held student when their HUB opens", () => {
    expect(loginErrorFromParam("not_open", "2027-01-15")).toMatch(/opens on 15 January 2027/);
  });

  it("falls back gracefully when the date is missing or junk", () => {
    expect(loginErrorFromParam("not_open", null)).toMatch(/a month before your school starts/);
    expect(loginErrorFromParam("not_open", "<script>")).toMatch(/a month before your school starts/);
  });
});