/**
 * Two-factor auth state logic — pure, dependency-free, and safe to import from
 * anywhere including the Edge middleware. Anything that needs the service-role
 * client lives in ./two-factor instead, which must never reach the Edge bundle.
 */

/** Assurance levels as Supabase reports them on the session. */
export type AssuranceLevel = "aal1" | "aal2" | null;

/**
 * The three distinct auth states, derived from the session's assurance level:
 *
 *  - "none"           — no session at all.
 *  - "awaiting_2fa"   — password verified, TOTP still owed. Supabase reports
 *                       currentLevel aal1 with nextLevel aal2, which happens
 *                       exactly when the user has a verified factor they have
 *                       not satisfied on this session.
 *  - "enrolment_due"  — fully signed in, but no verified factor exists yet and
 *                       the Hub requires one.
 *  - "authenticated"  — full access.
 */
export type AuthState =
  | "none"
  | "awaiting_2fa"
  | "enrolment_due"
  | "authenticated";

export function deriveAuthState(
  hasUser: boolean,
  currentLevel: AssuranceLevel,
  nextLevel: AssuranceLevel,
  requireEnrolment: boolean
): AuthState {
  if (!hasUser) return "none";
  if (currentLevel === "aal1" && nextLevel === "aal2") return "awaiting_2fa";
  if (requireEnrolment && nextLevel !== "aal2") return "enrolment_due";
  return "authenticated";
}

/**
 * Whether every user must hold a factor. Defaults to ON — set
 * NEXT_PUBLIC_REQUIRE_2FA=false to fall back to opt-in (useful as an escape
 * hatch during rollout, or if support gets swamped).
 */
export function twoFactorRequired(): boolean {
  return process.env.NEXT_PUBLIC_REQUIRE_2FA !== "false";
}

/** Routes an awaiting-2FA or enrolment-due session may still reach. */
export const TWO_FACTOR_CHALLENGE_PATH = "/login/2fa";
export const TWO_FACTOR_SETUP_PATH = "/account/security/two-factor";

/**
 * What the gate should do with one request from a half-authenticated session.
 * Pure so the guarantee — "an awaiting-2FA session reaches nothing" — is
 * testable without standing up a request.
 */
export type GateDecision =
  | { kind: "allow" }
  | { kind: "redirect"; target: string; carryRedirect: boolean }
  | { kind: "forbid"; reason: string };

export function gateDecision(
  state: AuthState,
  pathname: string
): GateDecision {
  if (state === "authenticated" || state === "none") return { kind: "allow" };

  const target =
    state === "awaiting_2fa"
      ? TWO_FACTOR_CHALLENGE_PATH
      : TWO_FACTOR_SETUP_PATH;

  // The narrow set of routes a half-authenticated session may still reach: the
  // screen it is being sent to, the endpoints that screen calls, and the
  // Supabase auth callbacks. Nothing else — no page, no API route.
  const allowedWhileGated = [
    target,
    "/api/auth/2fa/",
    "/api/account/2fa/",
    "/api/account/security-event",
    "/auth/",
  ];
  if (allowedWhileGated.some((route) => pathname.startsWith(route))) {
    return { kind: "allow" };
  }

  // API routes get a status code rather than a redirect — a fetch that quietly
  // followed a redirect to an HTML page would look like a strange success.
  if (pathname.startsWith("/api/")) {
    return {
      kind: "forbid",
      reason:
        state === "awaiting_2fa"
          ? "Two-factor verification required."
          : "Two-factor setup required.",
    };
  }

  return {
    kind: "redirect",
    target,
    carryRedirect: state === "awaiting_2fa" && pathname !== "/login",
  };
}
