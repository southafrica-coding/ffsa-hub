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
});