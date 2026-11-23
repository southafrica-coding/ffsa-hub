import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";

// ============================================================
// The calendar's share token
// ============================================================
// Same shape as the weekly feedback links (feedback.ts): 32 random bytes
// of nonce, the token is HMAC-SHA256(secret, "calendar|<id>|<nonce>") as
// base64url (43 characters, 256 bits). The database keeps the nonce and
// the SHA-256 of the token — never the token. Without the server secret
// the nonce is worthless, and the hash is all the feed looks up. Keeping
// the nonce lets a pastor see the same link again; resetting replaces
// both, so the old link stops at once.
// ============================================================

export const CALENDAR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const CALENDAR_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

export function newCalendarNonce(): string {
  return randomBytes(32).toString("base64url");
}

export function deriveCalendarToken(secret: string, calendarId: string, nonce: string): string {
  return createHmac("sha256", secret).update(`calendar|${calendarId}|${nonce}`).digest("base64url");
}

export function hashCalendarToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function calendarTokenPrefix(raw: string): string {
  return raw.slice(0, 6);
}

/** The token from the last path segment: "<token>.ics" or "<token>". Null when it can't be one. */
export function tokenFromSegment(segment: string): string | null {
  const raw = segment.endsWith(".ics") ? segment.slice(0, -4) : segment;
  return CALENDAR_TOKEN_PATTERN.test(raw) ? raw : null;
}
