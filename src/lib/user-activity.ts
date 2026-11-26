// ────────────────────────────────────────────────────────────
// Daily activity recorder (DAU / WAU)
// ────────────────────────────────────────────────────────────
// Called from middleware once a user is authenticated. Writes at most one
// row per user per day per platform via the record_user_activity() RPC
// (migration 411), which resolves the user from auth.uid(), so a caller can
// only ever record themselves.
//
// Rules this file keeps:
//  - Never throws and never blocks a request. Callers hand the promise to
//    event.waitUntil(); every failure is swallowed.
//  - Records who and when only. No URL, page, IP or user agent is passed.
//  - Web is throttled with a cookie (one write per browser per day); the
//    phone app has no cookies, so it is throttled in memory per Edge instance.
//
// No next/headers import: the middleware (Edge) uses this file.
// ────────────────────────────────────────────────────────────

export const ACTIVITY_COOKIE = "hub_seen";

/** The call this module needs from a Supabase client. */
export type ActivityClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
};

/** Calendar day in Africa/Johannesburg as YYYY-MM-DD (same boundary as the DB). */
export function activityDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Cookie value for "this browser was recorded for this user today". */
export function activityCookieValue(userId: string, day: string): string {
  return `${day}:${userId}`;
}

/** Requests that are not a person using the Hub: prefetches and HEAD / OPTIONS. */
export function isCountableRequest(request: {
  method: string;
  headers: { get(name: string): string | null };
}): boolean {
  if (request.method === "HEAD" || request.method === "OPTIONS") return false;
  const h = request.headers;
  if (h.get("next-router-prefetch") || h.get("purpose") === "prefetch") return false;
  if (h.get("sec-purpose")?.includes("prefetch")) return false;
  return true;
}

/** Fire-and-forget write. Resolves, never rejects. */
export async function recordUserActivity(
  client: ActivityClient,
  platform: "web" | "mobile"
): Promise<void> {
  try {
    await client.rpc("record_user_activity", { p_platform: platform });
  } catch {
    // Telemetry must never affect a request.
  }
}

// Phone app: one write per user per day per Edge instance. Bounded so a
// long-lived instance cannot grow without limit.
const mobileSeen = new Map<string, string>();
const MOBILE_SEEN_MAX = 5000;

/** True the first time this instance sees the user today (and remembers it). */
export function shouldRecordMobile(userId: string, day: string): boolean {
  if (mobileSeen.get(userId) === day) return false;
  if (mobileSeen.size >= MOBILE_SEEN_MAX) mobileSeen.clear();
  mobileSeen.set(userId, day);
  return true;
}

/** Test helper. */
export function resetMobileSeen(): void {
  mobileSeen.clear();
}
