// Pure sign-in rules, mirroring the website's login page
// (src/app/(auth)/login/page.tsx at the repo root):
//  - a soft client-side speed bump: after 5 failures, wait 30 s between
//    tries. It resets when the app restarts, so it never locks anyone out;
//    Supabase's server-side rate limits are the real backstop.
//  - error messages never reveal whether an email has an account.

export const MAX_FAILURES_BEFORE_COOLDOWN = 5;
export const COOLDOWN_MS = 30_000;

export type CooldownState = { failures: number; cooldownUntil: number };

export const initialCooldown: CooldownState = { failures: 0, cooldownUntil: 0 };

export function recordFailure(state: CooldownState, now: number): CooldownState {
  const failures = state.failures + 1;
  return {
    failures,
    cooldownUntil: failures >= MAX_FAILURES_BEFORE_COOLDOWN ? now + COOLDOWN_MS : state.cooldownUntil,
  };
}

export function recordSuccess(): CooldownState {
  return initialCooldown;
}

/** Whole seconds left to wait, or 0 if the user may try now. */
export function secondsRemaining(state: CooldownState, now: number) {
  return state.cooldownUntil > now ? Math.ceil((state.cooldownUntil - now) / 1000) : 0;
}

export function cooldownMessage(seconds: number) {
  return `Too many attempts. Please wait ${seconds}s and try again.`;
}

// ── Error messages ──────────────────────────────────────────────────────────

export const GENERIC_SIGN_IN_ERROR =
  "We couldn't sign you in. Check your email and password. If you've been accepted but never set a password, or you've forgotten it, use “Forgot password?” below.";

export const NETWORK_SIGN_IN_ERROR = "Couldn't reach FFSA Hub. Check your connection and try again.";

export const RATE_LIMITED_SIGN_IN_ERROR = "Too many sign-in attempts. Wait a few minutes and try again.";

type AuthErrorLike = { name?: string; status?: number; code?: string; message?: string };

/**
 * Map a Supabase auth error to a message that's safe to show. Anything
 * account-specific ("invalid credentials", "email not confirmed", "user
 * banned", …) collapses into one generic message so the screen can't be used
 * to find out which emails have accounts.
 */
export function signInErrorMessage(error: AuthErrorLike): string {
  if (error.name === "AuthRetryableFetchError" || error.status === 0) return NETWORK_SIGN_IN_ERROR;
  if (error.status === 429 || error.code === "over_request_rate_limit") return RATE_LIMITED_SIGN_IN_ERROR;
  return GENERIC_SIGN_IN_ERROR;
}

export function validateSignInForm(email: string, password: string) {
  const errors: { email?: string; password?: string } = {};
  const trimmed = email.trim();
  if (!trimmed) errors.email = "Enter your email address.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) errors.email = "That doesn't look like an email address.";
  if (!password) errors.password = "Enter your password.";
  return errors;
}
