import {
  COOLDOWN_MS,
  GENERIC_SIGN_IN_ERROR,
  initialCooldown,
  NETWORK_SIGN_IN_ERROR,
  RATE_LIMITED_SIGN_IN_ERROR,
  recordFailure,
  recordSuccess,
  secondsRemaining,
  signInErrorMessage,
  validateSignInForm,
} from "../sign-in-logic";

describe("cooldown (mirrors the web: 5 failures -> wait 30 s)", () => {
  it("allows four failures freely and starts a 30 s wait on the fifth", () => {
    let s = initialCooldown;
    const t = 1_000_000;
    for (let i = 0; i < 4; i++) {
      s = recordFailure(s, t);
      expect(secondsRemaining(s, t)).toBe(0);
    }
    s = recordFailure(s, t);
    expect(s.failures).toBe(5);
    expect(secondsRemaining(s, t)).toBe(30);
    expect(secondsRemaining(s, t + 29_001)).toBe(1);
    expect(secondsRemaining(s, t + COOLDOWN_MS)).toBe(0);
  });

  it("re-arms on each further failure, like the web", () => {
    let s = initialCooldown;
    for (let i = 0; i < 5; i++) s = recordFailure(s, 0);
    s = recordFailure(s, 60_000);
    expect(secondsRemaining(s, 60_000)).toBe(30);
  });

  it("resets after a successful sign-in", () => {
    expect(recordSuccess()).toEqual(initialCooldown);
  });
});

describe("signInErrorMessage never reveals whether an account exists", () => {
  it.each([
    [{ status: 400, code: "invalid_credentials", message: "Invalid login credentials" }],
    [{ status: 400, code: "email_not_confirmed", message: "Email not confirmed" }],
    [{ status: 400, code: "user_banned", message: "User is banned" }],
    [{ status: 422, code: "user_not_found", message: "User not found" }],
    [{ status: 500, message: "Database error querying schema" }],
  ])("%o -> generic message", (error) => {
    expect(signInErrorMessage(error)).toBe(GENERIC_SIGN_IN_ERROR);
  });

  it("explains connection problems and rate limits", () => {
    expect(signInErrorMessage({ name: "AuthRetryableFetchError", status: 0 })).toBe(NETWORK_SIGN_IN_ERROR);
    expect(signInErrorMessage({ status: 429, code: "over_request_rate_limit" })).toBe(RATE_LIMITED_SIGN_IN_ERROR);
  });

  it("the generic message points at the forgot-password link", () => {
    expect(GENERIC_SIGN_IN_ERROR).toContain("Forgot password?");
  });
});

describe("validateSignInForm", () => {
  it("requires an email-shaped address and a password", () => {
    expect(validateSignInForm("", "")).toEqual({ email: "Enter your email address.", password: "Enter your password." });
    expect(validateSignInForm("nope", "pw").email).toBe("That doesn't look like an email address.");
    expect(validateSignInForm("  jo@example.org ", "pw")).toEqual({});
  });
});
