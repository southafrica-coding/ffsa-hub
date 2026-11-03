// Pure push logic (unit-tested in __tests__/logic.test.ts): what the phone
// should do about its registration, when to offer the pre-prompt, and where
// a tapped notification goes. No React, no native modules.

import { resolveTarget, type Target } from "@/features/home/feed-logic";

export type Permission = "granted" | "denied" | "undetermined";

/** What this phone last told the server. */
export type Registration = { token: string; appVersion: string; userId: string };

/**
 * What Me shows:
 *  loading          checking
 *  unsupported      this build can't get a push token (no Expo project id,
 *                   simulator, Expo Go, …) → "not switched on for this build yet"
 *  not_enabled      the server answered 503 push_not_enabled
 *  off              the person hasn't turned push on for this phone
 *  needs_permission turned on, but the phone hasn't been asked yet
 *  blocked          the phone's Settings say no → "Open Settings"
 *  on               registered
 *  error            registering failed (network etc.) → retry
 */
export type PushStatus =
  | "loading"
  | "unsupported"
  | "not_enabled"
  | "off"
  | "needs_permission"
  | "blocked"
  | "on"
  | "error";

export type SyncInput = {
  supported: boolean;
  /** The server said 503 this launch: don't ask again until next launch. */
  serverNotEnabled: boolean;
  /** The person's choice for this phone (undefined = never decided). */
  enabled: boolean | undefined;
  permission: Permission;
  userId: string;
  appVersion: string;
  /** Current Expo push token, when permission is granted and it could be read. */
  token: string | null;
  registered: Registration | null;
};

export type SyncPlan =
  | { action: "none"; status: PushStatus }
  | { action: "register"; token: string }
  | { action: "unregister"; token: string; status: PushStatus };

/**
 * The registration state machine. Re-run whenever an input changes (launch,
 * sign-in, switch flipped, permission changed in Settings, token rotated,
 * app updated).
 */
export function planSync(i: SyncInput): SyncPlan {
  if (!i.supported) return { action: "none", status: "unsupported" };
  if (i.serverNotEnabled) return { action: "none", status: "not_enabled" };

  // Only this person's own registration can be revoked with their session.
  const mine = i.registered && i.registered.userId === i.userId ? i.registered : null;

  if (i.enabled !== true) {
    return mine ? { action: "unregister", token: mine.token, status: "off" } : { action: "none", status: "off" };
  }
  if (i.permission === "denied") {
    return mine
      ? { action: "unregister", token: mine.token, status: "blocked" }
      : { action: "none", status: "blocked" };
  }
  if (i.permission === "undetermined") return { action: "none", status: "needs_permission" };
  if (!i.token) return { action: "none", status: "unsupported" };

  const current =
    mine && mine.token === i.token && mine.appVersion === i.appVersion ? mine : null;
  return current ? { action: "none", status: "on" } : { action: "register", token: i.token };
}

// ── Pre-prompt ──────────────────────────────────────────────────────────────

export const PRE_PROMPT_MIN_LAUNCHES = 3;
export const PRE_PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Offer the friendly "Turn on notifications?" sheet? Never on the first
 * launches, never to someone who already decided, never while the phone or
 * the server can't do push, and at most once a month after "Not now".
 */
export function shouldOfferPrePrompt(i: {
  supported: boolean;
  serverNotEnabled: boolean;
  enabled: boolean | undefined;
  permission: Permission | null;
  launches: number;
  dismissedAt: number | null;
  now: number;
}): boolean {
  if (!i.supported || i.serverNotEnabled) return false;
  if (i.enabled !== undefined) return false;
  if (i.permission !== "undetermined") return false;
  if (i.launches < PRE_PROMPT_MIN_LAUNCHES) return false;
  return i.dismissedAt === null || i.now - i.dismissedAt >= PRE_PROMPT_SNOOZE_MS;
}

// ── Taps ────────────────────────────────────────────────────────────────────

/**
 * Where a tapped notification goes: data.href is a website path; known paths
 * open the app screen (the same table Home uses), the rest open the website
 * in the in-app browser. Junk or missing data opens Home.
 */
export function targetForNotification(data: unknown): Target {
  const href = data && typeof data === "object" ? (data as { href?: unknown }).href : undefined;
  const target = resolveTarget(typeof href === "string" ? href : null);
  return target.kind === "none" ? { kind: "app", path: "/" } : target;
}
