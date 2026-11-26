import { describe, expect, it } from "vitest";
import { accessModeOf, formAccessDecision } from "./access";

describe("form access (forms.access_mode)", () => {
  it("reads a missing or unknown mode as public", () => {
    expect(accessModeOf(undefined)).toBe("public");
    expect(accessModeOf(null)).toBe("public");
    expect(accessModeOf("anything")).toBe("public");
    expect(accessModeOf("logged_in")).toBe("logged_in");
    expect(accessModeOf("token")).toBe("token");
  });

  it("public is open, logged_in needs a session, token stays closed", () => {
    expect(formAccessDecision("public", false)).toBe("open");
    expect(formAccessDecision("logged_in", false)).toBe("sign_in");
    expect(formAccessDecision("logged_in", true)).toBe("open");
    // Per-house links are F4; until then nobody gets in, signed in or not.
    expect(formAccessDecision("token", false)).toBe("closed");
    expect(formAccessDecision("token", true)).toBe("closed");
  });
});
