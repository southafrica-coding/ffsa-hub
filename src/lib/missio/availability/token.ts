import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 bytes, base64url, no padding. The only shape a personal link may carry. */
export const AVAILABILITY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** SHA-256 hex. This is the only form stored in availability_tokens. */
export const AVAILABILITY_TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;

export function hashAvailabilityToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function generateAvailabilityToken(): { raw: string; tokenHash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, tokenHash: hashAvailabilityToken(raw) };
}

/** True only when `raw` hashes to the stored hex digest. The raw value is never the digest. */
export function verifyAvailabilityToken(raw: string, tokenHash: string): boolean {
  if (!AVAILABILITY_TOKEN_PATTERN.test(raw)) return false;
  if (!AVAILABILITY_TOKEN_HASH_PATTERN.test(tokenHash)) return false;
  const computed = hashAvailabilityToken(raw);
  return timingSafeEqual(Buffer.from(computed, "utf8"), Buffer.from(tokenHash, "utf8"));
}

/** Columns written for a new or replaced link. The raw token is not a field. */
export function tokenHashRecord(raw: string, expiresAt: string): { token_hash: string; expires_at: string } {
  return { token_hash: hashAvailabilityToken(raw), expires_at: expiresAt };
}

export function personalAvailabilityUrl(origin: string, raw: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/serve/missio/${raw}`;
}
