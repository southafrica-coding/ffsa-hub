import { describe, it, expect } from "vitest";
import {
  deriveAuthState,
  gateDecision,
  TWO_FACTOR_CHALLENGE_PATH,
  TWO_FACTOR_SETUP_PATH,
} from "./two-factor-state";

describe("deriveAuthState", () => {
  it("is unauthenticated with no user", () => {
    expect(deriveAuthState(false, null, null, true)).toBe("none");
  });

  it("treats a password-only session on a 2FA account as awaiting 2FA", () => {
    expect(deriveAuthState(true, "aal1", "aal2", true)).toBe("awaiting_2fa");
    // ...and does so even when enrolment is not enforced — a user who opted in
    // must still satisfy their own factor.
    expect(deriveAuthState(true, "aal1", "aal2", false)).toBe("awaiting_2fa");
  });

  it("grants full access once the factor is satisfied", () => {
    expect(deriveAuthState(true, "aal2", "aal2", true)).toBe("authenticated");
  });

  it("sends an un-enrolled user to setup only while 2FA is required", () => {
    expect(deriveAuthState(true, "aal1", "aal1", true)).toBe("enrolment_due");
    expect(deriveAuthState(true, "aal1", "aal1", false)).toBe("authenticated");
  });
});

describe("gateDecision", () => {
  const protectedPaths = [
    "/dashboard",
    "/profile",
    "/contacts",
    "/account/security",
    "/bookings/spaces",
  ];
  const protectedApis = [
    "/api/contacts",
    "/api/events/123/orders",
    "/api/account/change-email",
  ];

  it("lets a fully authenticated session through everywhere", () => {
    for (const path of [...protectedPaths, ...protectedApis]) {
      expect(gateDecision("authenticated", path)).toEqual({ kind: "allow" });
    }
  });

  it("keeps an awaiting-2FA session out of every protected page", () => {
    for (const path of protectedPaths) {
      const decision = gateDecision("awaiting_2fa", path);
      expect(decision.kind).toBe("redirect");
      if (decision.kind === "redirect") {
        expect(decision.target).toBe(TWO_FACTOR_CHALLENGE_PATH);
        expect(decision.carryRedirect).toBe(true);
      }
    }
  });

  it("refuses protected API routes outright rather than redirecting them", () => {
    for (const path of protectedApis) {
      const decision = gateDecision("awaiting_2fa", path);
      expect(decision.kind).toBe("forbid");
    }
  });

  it("keeps an un-enrolled session out until it has set 2FA up", () => {
    const decision = gateDecision("enrolment_due", "/dashboard");
    expect(decision).toEqual({
      kind: "redirect",
      target: TWO_FACTOR_SETUP_PATH,
      carryRedirect: false,
    });
    expect(gateDecision("enrolment_due", "/api/contacts").kind).toBe("forbid");
  });

  it("allows exactly the routes each gated screen needs, and no others", () => {
    expect(gateDecision("awaiting_2fa", TWO_FACTOR_CHALLENGE_PATH).kind).toBe("allow");
    expect(gateDecision("awaiting_2fa", "/api/auth/2fa/recovery").kind).toBe("allow");
    expect(gateDecision("awaiting_2fa", "/auth/callback").kind).toBe("allow");
    expect(gateDecision("enrolment_due", TWO_FACTOR_SETUP_PATH).kind).toBe("allow");
    expect(gateDecision("enrolment_due", "/api/account/2fa/recovery-codes").kind).toBe("allow");

    // The setup screen is not a way to skip the challenge, and vice versa.
    expect(gateDecision("awaiting_2fa", TWO_FACTOR_SETUP_PATH).kind).toBe("redirect");
    expect(gateDecision("enrolment_due", TWO_FACTOR_CHALLENGE_PATH).kind).toBe("redirect");
  });

  it("does not bounce a challenge redirect back to /login", () => {
    const decision = gateDecision("awaiting_2fa", "/login");
    expect(decision.kind === "redirect" && decision.carryRedirect).toBe(false);
  });
});
